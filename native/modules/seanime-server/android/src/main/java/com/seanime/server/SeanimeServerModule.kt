package com.seanime.server

import android.content.Intent
import android.os.Build
import android.os.Bundle
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS API for the local Go server: start(), getStatus(), setLanguage(), events onStatusChange / onReady. */
class SeanimeServerModule : Module() {

    private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    private val listener: (ServerStatus) -> Unit = { status ->
        sendEvent("onStatusChange", status.toBundle())
        if (status.state == "ready") sendEvent("onReady", status.toBundle())
    }

    override fun definition() = ModuleDefinition {
        Name("SeanimeServer")

        Constant("port") { SeanimeServerService.PORT }

        Events("onStatusChange", "onReady")

        OnStartObserving { ServerState.addListener(listener) }
        OnStopObserving { ServerState.removeListener(listener) }
        OnDestroy { ServerState.removeListener(listener) }

        // Starts the foreground service; a running server is left alone (the service checks its process).
        Function("start") {
            val intent = Intent(context, SeanimeServerService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }

        Function("getStatus") { ServerState.current.toMap() }

        Function("setLanguage") { language: String -> ServerLanguage.set(context, language) }

        // Settings the old app (Seanime Mobile 2.0.33, same package after the update) kept in its SharedPreferences
        // instead of the Go data folder: AppLanguage.kt, Feedback.kt, notify/AiringNotifier.kt. Only keys that exist;
        // lib/legacy-preferences.ts copies them once into MMKV (docs/NATIVE-UMBAU.md §9 E6).
        Function("legacyPreferences") {
            val app = context.getSharedPreferences("seanime_app", android.content.Context.MODE_PRIVATE)
            val airing = context.getSharedPreferences("airing_notifier", android.content.Context.MODE_PRIVATE)
            buildMap<String, Any> {
                app.getString("language", null)?.let { put("language", it) }
                if (app.contains("feedback_haptics")) put("feedbackHaptics", app.getBoolean("feedback_haptics", true))
                if (app.contains("feedback_sounds")) put("feedbackSounds", app.getBoolean("feedback_sounds", true))
                if (airing.contains("enabled")) put("airingEnabled", airing.getBoolean("enabled", true))
                airing.getString("announced", null)?.let { put("airingAnnounced", it) }
            }
        }

        // Touch feedback (lib/feedback.ts) needs three device facts no Expo library reports: the Pixel Tablet has no
        // vibration motor (its Vibration switch is hidden), and the success sound plays only with the ringer on and while
        // nothing else is audible (Feedback.kt).
        Function("feedbackState") {
            @Suppress("DEPRECATION")
            val vibrator = context.getSystemService(android.content.Context.VIBRATOR_SERVICE) as? android.os.Vibrator
            val audio = context.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
            mapOf(
                "hasVibrator" to (vibrator?.hasVibrator() == true),
                "ringerMode" to audio.ringerMode,
                "musicActive" to audio.isMusicActive,
            )
        }
    }

    private fun ServerStatus.toMap() = mapOf("state" to state, "message" to message, "port" to port)
    private fun ServerStatus.toBundle() = Bundle().apply {
        putString("state", state)
        putString("message", message)
        putInt("port", port)
    }
}
