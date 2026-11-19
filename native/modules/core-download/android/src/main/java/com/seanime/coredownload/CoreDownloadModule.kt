// geschrieben nach: Expo Modules API (Module, ModuleDefinition, Record, Events) nach dem Muster des früheren Server-Moduls (bis Stufe 8a-1); docs/EIGENER-KERN.md §4o; kein Server-Quelltext
package com.seanime.coredownload

import android.os.Bundle
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.security.MessageDigest

class EnqueueOptions : Record {
    @Field
    var id: String = ""

    @Field
    var url: String = ""

    @Field
    var headers: Map<String, String> = emptyMap()

    @Field
    var path: String = ""

    @Field
    var title: String = ""

    /** Bytes of an earlier run to keep, 0: from the start */
    @Field
    var resumeFrom: Double = 0.0

    /** The source's mark of the file from the earlier run, "": none */
    @Field
    var ifRange: String = ""

    /** 0: not known */
    @Field
    var expectedBytes: Double = 0.0

    /** JSON list of the parts of a request of several parts (LoaderParts), "": one file from url */
    @Field
    var parts: String = ""

    /** With parts: keep what an earlier request of this id finished, when it had as many parts */
    @Field
    var continueParts: Boolean = false

    /** "work": WorkManager also on Android 14 and later (self test) */
    @Field
    var way: String = ""
}

/**
 * JS API of the device's loader: enqueue(), cancel(), status(), forget(), removeFolder(), has(), sha256(), wakeIn(),
 * notice(); events progress / done / failed / wake.
 * Thin on purpose: queue, HLS and joining of files are the core's work (TypeScript), this only loads one file while the
 * app is not in front, and helps the core's queue to go on then without timers of the app: its waits and its notices.
 */
class CoreDownloadModule : Module() {

    private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    private val listener: (String, Bundle) -> Unit = { name, body -> sendEvent(name, body) }

    override fun definition() = ModuleDefinition {
        Name("SeanimeCoreDownload")

        Events("progress", "done", "failed", "wake")

        OnStartObserving { Loader.listener = listener }
        OnStopObserving { if (Loader.listener === listener) Loader.listener = null }
        OnDestroy { if (Loader.listener === listener) Loader.listener = null }

        AsyncFunction("enqueue") { options: EnqueueOptions -> LoaderWays.enqueue(context, options) }

        AsyncFunction("cancel") { id: String -> LoaderWays.cancel(context, id) }

        AsyncFunction("status") { id: String -> LoaderWays.status(context, id) }

        AsyncFunction("forget") { id: String -> LoaderWays.forget(context, id) }

        // on the module's thread: a saved episode is hundreds of megabytes, removing it must not hold the app's thread
        AsyncFunction("removeFolder") { path: String -> LoaderWays.ownFile(context, path).deleteRecursively() }

        // on the module's thread: a file check on the app's thread held it in the piece of an episode's end (4b-C1K)
        AsyncFunction("has") { path: String -> LoaderWays.ownFile(context, path).isFile }

        /*
         * The notice at the end of an episode ("Download finished", "Download failed"), shown by the device: the app's
         * timers stand still while it is not in front, a notice of JavaScript only came when the app was opened.
         */
        AsyncFunction("notice") { id: String, title: String, text: String, channel: String, link: String ->
            LoaderNotice.end(context.applicationContext, id, title, text, channel, link)
        }

        // the event `wake` after about so many milliseconds, also when the process rests by then; below 0: not any more
        AsyncFunction("wakeIn") { ms: Double -> WakeWorker.plan(context, ms.toLong()) }

        // phase 6f: holds the process in front while the core's torrent client downloads (TorrentKeep.kt)
        AsyncFunction("keepTorrents") { on: Boolean, title: String -> TorrentKeepService.keep(context.applicationContext, on, title) }

        // 4.2.0: that service's notice with the torrents' progress, about once a second; never starts the service
        AsyncFunction("updateTorrentNotice") { title: String, text: String, done: Double, total: Double, link: String ->
            TorrentKeepService.update(context.applicationContext, title, text, done.toLong(), total.toLong(), link)
        }

        AsyncFunction("sha256") { path: String ->
            val file = LoaderWays.ownFile(context, path)
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        }

        // Moved here from the server module when it left the app (stage 8a-1, docs/EIGENER-KERN.md §4s); neither needs
        // the server. Settings the old app (Seanime Mobile 2.0.33, same package after the update) kept in its
        // SharedPreferences instead of the Go data folder: AppLanguage.kt, Feedback.kt, notify/AiringNotifier.kt. Only
        // keys that exist; lib/legacy-preferences.ts copies them once into MMKV (docs/NATIVE-UMBAU.md §9 E6).
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
}
