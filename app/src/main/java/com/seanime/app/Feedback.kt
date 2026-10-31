package com.seanime.app

import android.app.Activity
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import android.os.Build
import android.os.Vibrator
import android.util.Log
import android.view.HapticFeedbackConstants

/**
 * Touch feedback for the web UI (SeanimeAndroid.haptic / playSound): a haptic tick through the window, which follows the
 * system's touch-feedback setting and needs no vibrate permission, and one quiet sound for success moments. Both have a
 * switch in Settings → App → Feedback; the sound stays off while the phone is silent or anything plays audio (a video).
 */
class Feedback(private val activity: Activity) {

    companion object {
        private const val TAG = "SeanimeFeedback"
        private const val PREFS = "seanime_app"
        private const val KEY_HAPTICS = "feedback_haptics"
        private const val KEY_SOUNDS = "feedback_sounds"
        private const val VOLUME = 0.45f

        /** The HapticFeedbackConstants value for a kind of the web UI, or null for an unknown kind; [sdk] guards the API 30 ones. */
        @android.annotation.SuppressLint("InlinedApi")
        fun hapticConstant(kind: String, sdk: Int): Int? = when (kind) {
            "tick" -> HapticFeedbackConstants.CLOCK_TICK
            "long" -> HapticFeedbackConstants.LONG_PRESS
            "confirm" -> if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            "reject" -> if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            else -> null
        }

        /** Sounds only when the ringer is on and nothing else (the player, music) is audible. */
        fun soundAllowed(enabled: Boolean, ringerMode: Int, musicActive: Boolean): Boolean =
            enabled && ringerMode == AudioManager.RINGER_MODE_NORMAL && !musicActive
    }

    private val prefs get() = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val audio by lazy { activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private var pool: SoundPool? = null
    private var successId = 0
    private var successLoaded = false
    private var playWhenLoaded = false

    var hapticsEnabled: Boolean
        get() = prefs.getBoolean(KEY_HAPTICS, true)
        set(value) { prefs.edit().putBoolean(KEY_HAPTICS, value).apply() }

    var soundsEnabled: Boolean
        get() = prefs.getBoolean(KEY_SOUNDS, true)
        set(value) { prefs.edit().putBoolean(KEY_SOUNDS, value).apply() }

    @Suppress("DEPRECATION")
    fun hasVibrator(): Boolean = (activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)?.hasVibrator() == true

    fun haptic(kind: String) {
        val constant = hapticConstant(kind, Build.VERSION.SDK_INT) ?: return
        if (!hapticsEnabled) return
        activity.runOnUiThread {
            val done = activity.window?.decorView?.performHapticFeedback(constant) == true
            Log.d(TAG, "haptic $kind -> $done")
        }
    }

    /** "success" is the only sound; it is short and quiet. */
    fun playSound(name: String) {
        if (name != "success") return
        if (!soundAllowed(soundsEnabled, audio.ringerMode, audio.isMusicActive)) {
            Log.d(TAG, "sound $name skipped")
            return
        }
        activity.runOnUiThread {
            val sounds = pool ?: load()
            if (successLoaded) sounds.play(successId, VOLUME, VOLUME, 1, 0, 1f) else playWhenLoaded = true
            Log.d(TAG, "sound $name played")
        }
    }

    private fun load(): SoundPool = SoundPool.Builder()
        .setMaxStreams(1)
        .setAudioAttributes(AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build())
        .build().also { sounds ->
            pool = sounds
            sounds.setOnLoadCompleteListener { _, id, status ->
                if (status != 0 || id != successId) return@setOnLoadCompleteListener
                successLoaded = true
                if (playWhenLoaded) sounds.play(id, VOLUME, VOLUME, 1, 0, 1f)
                playWhenLoaded = false
            }
            successId = sounds.load(activity, R.raw.feedback_success, 1)
        }

    fun release() {
        pool?.release()
        pool = null
        successLoaded = false
    }
}
