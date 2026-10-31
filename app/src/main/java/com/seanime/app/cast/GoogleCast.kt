package com.seanime.app.cast

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.SessionProvider
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.images.WebImage

/**
 * Google TV and Chromecast through Google Cast, with Google's default receiver (no own receiver app).
 * Everything here runs on the main thread, as the Cast SDK wants; it needs Google Play services and Android 6+.
 */
object GoogleCast {
    private val main = Handler(Looper.getMainLooper())
    private val selector by lazy {
        MediaRouteSelector.Builder().addControlCategory(CastMediaControlIntent.categoryForCast(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)).build()
    }

    @Suppress("DEPRECATION")
    fun available(context: Context): Boolean = Build.VERSION.SDK_INT >= 23 &&
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS &&
        try {
            CastContext.getSharedInstance(context)
            true
        } catch (_: Exception) {
            false
        }

    // Cast routes vanish once nobody scans, and selecting a vanished one does nothing: the scan runs until a session starts
    private var scan: MediaRouter.Callback? = null

    /** Cast devices seen within [timeoutMs]; [done] runs on the main thread. The scan goes on until [play] or [cancel]. */
    fun discover(context: Context, timeoutMs: Long, done: (List<MediaRouter.RouteInfo>) -> Unit) {
        if (!available(context)) return done(emptyList())
        val router = MediaRouter.getInstance(context)
        val callback = scan ?: object : MediaRouter.Callback() {}.also { scan = it }
        router.addCallback(selector, callback, MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN)
        main.postDelayed({ done(router.routes.filter { !it.isDefault && it.isEnabled && it.matchesSelector(selector) }) }, timeoutMs)
    }

    /** Gives up connecting: ends the scan and the half-made selection. */
    fun cancel(context: Context) {
        endScan(context)
        MediaRouter.getInstance(context).unselect(MediaRouter.UNSELECT_REASON_STOPPED)
    }

    private fun endScan(context: Context) {
        scan?.let { MediaRouter.getInstance(context).removeCallback(it) }
        scan = null
    }

    /** Connects to [route] and starts [url]; [done] gets null or an error, on the main thread. */
    @Suppress("DEPRECATION")
    fun play(context: Context, route: MediaRouter.RouteInfo, url: String, title: String, artworkUrl: String, startMs: Long, done: (Exception?) -> Unit) {
        val router = MediaRouter.getInstance(context)
        val fresh = router.routes.firstOrNull { it.id == route.id } ?: return done(IllegalStateException("route gone"))
        val sessions = CastContext.getSharedInstance(context).sessionManager
        val listener = object : SessionManagerListener<CastSession> {
            override fun onSessionStarted(session: CastSession, sessionId: String) {
                sessions.removeSessionManagerListener(this, CastSession::class.java)
                endScan(context)
                load(session, url, title, artworkUrl, startMs, done)
            }
            override fun onSessionStartFailed(session: CastSession, error: Int) {
                sessions.removeSessionManagerListener(this, CastSession::class.java)
                endScan(context)
                done(IllegalStateException("cast session failed: $error"))
            }
            override fun onSessionStarting(session: CastSession) {}
            override fun onSessionEnding(session: CastSession) {}
            override fun onSessionEnded(session: CastSession, error: Int) {}
            override fun onSessionResuming(session: CastSession, sessionId: String) {}
            override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {}
            override fun onSessionResumeFailed(session: CastSession, error: Int) {}
            override fun onSessionSuspended(session: CastSession, reason: Int) {}
        }
        sessions.addSessionManagerListener(listener, CastSession::class.java)
        router.selectRoute(fresh)
    }

    /** Plays [url] in the running session instead, from [startMs]; [done] as in [play]. */
    fun replace(context: Context, url: String, title: String, artworkUrl: String, startMs: Long, done: (Exception?) -> Unit) {
        val session = session(context) ?: return done(IllegalStateException("no cast session"))
        load(session, url, title, artworkUrl, startMs, done)
    }

    @Suppress("DEPRECATION")
    private fun load(session: CastSession, url: String, title: String, artworkUrl: String, startMs: Long, done: (Exception?) -> Unit) {
        val client = session.remoteMediaClient ?: return done(IllegalStateException("no media client"))
        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
            putString(MediaMetadata.KEY_TITLE, title)
            if (artworkUrl.isNotBlank()) addImage(WebImage(Uri.parse(artworkUrl)))
        }
        // Matroska: the receiver plays it like Chrome does (H.264/HEVC/VP9/AV1 with AAC/Opus/…)
        val media = MediaInfo.Builder(url).setStreamType(MediaInfo.STREAM_TYPE_BUFFERED).setContentType("video/x-matroska").setMetadata(metadata).build()
        client.load(MediaLoadRequestData.Builder().setMediaInfo(media).setAutoplay(true).setCurrentTime(startMs).build())
            .setResultCallback { result -> done(if (result.status.isSuccess) null else IllegalStateException("load failed: ${result.status.statusCode}")) }
    }

    @Suppress("DEPRECATION")
    private fun session(context: Context): CastSession? = CastContext.getSharedInstance(context).sessionManager.currentCastSession

    fun play(context: Context) { session(context)?.remoteMediaClient?.play() }
    fun pause(context: Context) { session(context)?.remoteMediaClient?.pause() }
    fun seek(context: Context, ms: Long) { session(context)?.remoteMediaClient?.seek(MediaSeekOptions.Builder().setPosition(ms).build()) }
    fun setVolume(context: Context, percent: Int) { session(context)?.volume = percent.coerceIn(0, 100) / 100.0 }

    fun status(context: Context): CastStatus? {
        val session = session(context) ?: return null
        val client = session.remoteMediaClient ?: return null
        val ended = client.playerState == MediaStatus.PLAYER_STATE_IDLE && client.idleReason == MediaStatus.IDLE_REASON_FINISHED
        return CastStatus(client.isPlaying, client.approximateStreamPosition, client.streamDuration, (session.volume * 100).toInt(), ended)
    }

    @Suppress("DEPRECATION")
    fun stop(context: Context) {
        session(context)?.remoteMediaClient?.stop()
        CastContext.getSharedInstance(context).sessionManager.endCurrentSession(true)
    }
}

/** Cast SDK setup: Google's default media receiver, nothing of our own runs on the TV. */
class CastOptionsProvider : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions =
        CastOptions.Builder().setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID).build()

    override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}
