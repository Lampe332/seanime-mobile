package com.seanime.app

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Lock-screen, notification and headset controls for the WebView player; Android shows none for a WebView page itself.
 * The page reports what plays (SeanimeMedia.update) and gets the controls back as "seanime-media-action" window events.
 */
class MediaSessionBridge(private val activity: Activity, private val webView: WebView, private val pip: PiPManager) {
    private val session = MediaSession(activity, "SeanimePlayer")
    private var artworkUrl = ""
    private var artwork: Bitmap? = null
    private var last: Playing? = null
    private var rate = 1f
    private var hasNext = false
    private var hasPrevious = false

    private data class Playing(val title: String, val artist: String, val playing: Boolean, val positionMs: Long, val durationMs: Long)

    init {
        session.setCallback(object : MediaSession.Callback() {
            override fun onPlay() = send("play")
            override fun onPause() = send("pause")
            override fun onSeekTo(pos: Long) = send("seekto", pos / 1000.0)
            override fun onFastForward() = send("seekforward")
            override fun onRewind() = send("seekbackward")
            override fun onSkipToNext() = send("nexttrack")
            override fun onSkipToPrevious() = send("previoustrack")
        })
        current = this
    }

    @JavascriptInterface
    fun update(title: String, artist: String, artworkUrl: String, playing: Boolean, positionMs: Double, durationMs: Double) {
        val state = Playing(title, artist, playing, positionMs.toLong().coerceAtLeast(0), durationMs.toLong().coerceAtLeast(0))
        activity.runOnUiThread {
            if (artworkUrl != this.artworkUrl) {
                this.artworkUrl = artworkUrl
                artwork = null
                loadArtwork(artworkUrl)
            }
            show(state)
            pip.onMediaState(playing)
        }
    }

    @JavascriptInterface
    fun clear() = activity.runOnUiThread {
        hide()
        hasNext = false
        hasPrevious = false
        pip.onMediaState(false)
    }

    /** Video size for the picture-in-picture shape. */
    @JavascriptInterface
    fun setVideoSize(width: Int, height: Int) = activity.runOnUiThread { pip.setVideoSize(width, height) }

    /** Lock screen and notification progress run at the player's speed. */
    @JavascriptInterface
    fun setPlaybackRate(rate: Double) = activity.runOnUiThread {
        val value = rate.toFloat().takeIf { it > 0f && it.isFinite() } ?: 1f
        if (value == this.rate) return@runOnUiThread
        this.rate = value
        last?.let { show(it) }
    }

    /** Next/previous episode buttons; they answer with "nexttrack"/"previoustrack" actions. */
    @JavascriptInterface
    fun setQueue(hasNext: Boolean, hasPrevious: Boolean) = activity.runOnUiThread {
        if (hasNext == this.hasNext && hasPrevious == this.hasPrevious) return@runOnUiThread
        this.hasNext = hasNext
        this.hasPrevious = hasPrevious
        last?.let { show(it) }
    }

    fun release() {
        hide()
        session.release()
        if (current === this) current = null
    }

    fun send(action: String, seekTime: Double? = null) {
        val detail = JSONObject().put("action", action)
        if (seekTime != null) detail.put("seekTime", seekTime)
        webView.post { webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('seanime-media-action',{detail:$detail}))", null) }
    }

    private fun show(state: Playing) {
        last = state
        session.setMetadata(MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, state.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, state.artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, state.durationMs)
            .apply { artwork?.let { putBitmap(MediaMetadata.METADATA_KEY_ART, it) } }
            .build())
        session.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND or
                (if (hasNext) PlaybackState.ACTION_SKIP_TO_NEXT else 0L) or (if (hasPrevious) PlaybackState.ACTION_SKIP_TO_PREVIOUS else 0L))
            .setState(if (state.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, state.positionMs, if (state.playing) rate else 0f)
            .build())
        session.isActive = true

        val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, AppLanguage.tr("Playback", "Wiedergabe"), NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(activity, 0, Intent(activity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        // previous, back 10 s, play/pause, forward 10 s, next; the small view shows the episode buttons when there are any
        val buttons = listOfNotNull(
            if (hasPrevious) action(android.R.drawable.ic_media_previous, AppLanguage.tr("Previous episode", "Vorherige Folge"), "previoustrack") else null,
            action(android.R.drawable.ic_media_rew, AppLanguage.tr("Back 10 seconds", "10 Sekunden zurück"), "seekbackward"),
            if (state.playing) action(android.R.drawable.ic_media_pause, AppLanguage.tr("Pause", "Pause"), "pause")
                else action(android.R.drawable.ic_media_play, AppLanguage.tr("Play", "Abspielen"), "play"),
            action(android.R.drawable.ic_media_ff, AppLanguage.tr("Forward 10 seconds", "10 Sekunden vor"), "seekforward"),
            if (hasNext) action(android.R.drawable.ic_media_next, AppLanguage.tr("Next episode", "Nächste Folge"), "nexttrack") else null,
        )
        val toggle = if (hasPrevious) 2 else 1
        val compact = if (hasNext || hasPrevious) listOfNotNull(if (hasPrevious) 0 else toggle - 1, toggle, if (hasNext) buttons.lastIndex else toggle + 1)
            else listOf(toggle - 1, toggle, toggle + 1)
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(activity, CHANNEL) else Notification.Builder(activity)
        buttons.forEach { builder.addAction(it) }
        manager.notify(NOTIFICATION, builder
            .setSmallIcon(R.drawable.ic_stat_seanime)
            .setContentTitle(state.title)
            .setContentText(state.artist)
            .setLargeIcon(artwork)
            .setContentIntent(open)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(state.playing)
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(*compact.toIntArray()))
            .build())
    }

    private fun hide() {
        last = null
        session.isActive = false
        (activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION)
    }

    @Suppress("DEPRECATION")
    private fun action(icon: Int, title: String, action: String) = Notification.Action.Builder(icon, title,
        PendingIntent.getBroadcast(activity, action.hashCode(), Intent(activity, MediaActionReceiver::class.java).putExtra(EXTRA_ACTION, action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build()

    private fun loadArtwork(url: String) {
        if (url.isBlank()) return
        Thread {
            val bitmap = try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                try { conn.inputStream.use { BitmapFactory.decodeStream(it) } } finally { conn.disconnect() }
            } catch (_: Exception) {
                null
            }
            activity.runOnUiThread {
                if (url != artworkUrl || bitmap == null) return@runOnUiThread
                artwork = bitmap
                last?.let { show(it) }
            }
        }.start()
    }

    /** Buttons of the media notification. */
    class MediaActionReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            intent.getStringExtra(EXTRA_ACTION)?.let { current?.send(it) }
        }
    }

    companion object {
        private const val CHANNEL = "playback"
        private const val NOTIFICATION = 4711
        private const val EXTRA_ACTION = "action"
        @Volatile private var current: MediaSessionBridge? = null
    }
}
