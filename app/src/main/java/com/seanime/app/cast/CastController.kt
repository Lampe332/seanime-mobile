package com.seanime.app.cast

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.mediarouter.media.MediaRouter
import com.seanime.app.AppLanguage
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The cast session behind the player's cast panel: finds TVs (DLNA such as LG webOS, and Google TV/Chromecast),
 * starts, controls and ends casting. The page gets everything as "seanime-cast" events through [emit]:
 * searching, devices, connecting, started, status, stopped, error.
 */
class CastController(private val context: Context, private val emit: (JSONObject) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val dlna = mutableMapOf<String, Renderer>()
    private val google = mutableMapOf<String, MediaRouter.RouteInfo>()
    @Volatile private var current: Current? = null

    private class Current(val id: String, val name: String, val kind: String, val renderer: Renderer?, val proxy: CastProxy, val title: String, val artworkUrl: String)

    private companion object {
        // LG answers Play only once the video is open, then the start position is sought
        const val CONNECT_TIMEOUT_MS = 50_000L

        /** "[LG] webOS TV OLED65B59LA" → "webOS TV OLED65B59LA"; LG lists its TVs with this prefix over DLNA and Google Cast. */
        fun displayName(name: String) = name.removePrefix("[LG]").trim()

        fun isWebOs(name: String) = name.contains("[LG]") || name.contains("webOS", ignoreCase = true)
    }

    fun discover() {
        emit(JSONObject().put("state", "searching"))
        var dlnaFound: List<Renderer>? = null
        var googleFound: List<MediaRouter.RouteInfo>? = null
        fun finish() {
            val renderers = dlnaFound ?: return
            val routes = googleFound ?: return
            dlna.clear()
            google.clear()
            val devices = JSONArray()
            renderers.forEach { renderer ->
                val id = "dlna:" + renderer.avTransportUrl
                dlna[id] = renderer
                devices.put(JSONObject().put("id", id).put("name", displayName(renderer.name)).put("kind", if (isWebOs(renderer.name)) "webos" else "dlna"))
            }
            // LG TVs also answer over Google Cast, but their Cast receiver shows no picture for AV1 and no subtitles: DLNA only
            val webOs = renderers.filter { isWebOs(it.name) }.map { displayName(it.name) }.toSet()
            routes.filterNot { displayName(it.name) in webOs }.forEach { route ->
                val id = "cast:" + route.id
                google[id] = route
                devices.put(JSONObject().put("id", id).put("name", displayName(route.name)).put("kind", "googlecast"))
            }
            emit(JSONObject().put("state", "devices").put("devices", devices))
        }
        Thread {
            val found = try { DlnaCast.discover(context) } catch (_: Exception) { emptyList() }
            main.post { dlnaFound = found; finish() }
        }.start()
        main.post {
            try {
                GoogleCast.discover(context, 3000) { googleFound = it; finish() }
            } catch (_: Exception) {
                googleFound = emptyList()
                finish()
            }
        }
    }

    fun start(id: String, url: String, title: String, positionMs: Long, artworkUrl: String) {
        val renderer = dlna[id]
        val route = google[id]
        if (renderer == null && route == null) return error(AppLanguage.tr("This TV is gone, search again.", "Dieser Fernseher ist weg, bitte neu suchen."))
        val name = displayName(renderer?.name ?: route!!.name)
        val kind = if (route != null) "googlecast" else if (isWebOs(renderer!!.name)) "webos" else "dlna"
        current?.let { stopNow(it) }
        emit(JSONObject().put("state", "connecting").put("device", name).put("kind", kind))
        val proxy = CastProxy(url)
        Thread {
            val castUrl = try { proxy.start() } catch (_: Exception) { null }
            if (castUrl == null) return@Thread error(AppLanguage.tr("No Wi-Fi: the TV can only be reached in the same Wi-Fi.", "Kein WLAN: Der Fernseher ist nur im selben WLAN erreichbar."))
            // the first answer wins: started, failed or the timeout
            var settled = false
            fun settle(e: Exception?) = synchronized(this) {
                if (settled) return@synchronized
                settled = true
                if (e == null) {
                    current = Current(id, name, kind, renderer, proxy, title, artworkUrl)
                    emit(JSONObject().put("state", "started").put("device", name).put("kind", kind))
                    return@synchronized
                }
                proxy.stop()
                if (route != null) main.post { GoogleCast.cancel(context) }
                error(when {
                    e is UpnpException && e.code == 701 -> AppLanguage.tr("The TV is off or in standby. Turn it on and try again.",
                        "Der Fernseher ist aus oder im Standby. Bitte einschalten und nochmal versuchen.")
                    e is java.util.concurrent.TimeoutException -> AppLanguage.tr("The TV does not answer. Is it on?", "Der Fernseher antwortet nicht. Ist er eingeschaltet?")
                    else -> AppLanguage.tr("The TV did not take the video.", "Der Fernseher hat das Video nicht angenommen.")
                })
            }
            main.postDelayed({ settle(java.util.concurrent.TimeoutException()) }, CONNECT_TIMEOUT_MS)
            if (renderer != null) {
                try {
                    DlnaCast.play(renderer, castUrl, title, positionMs / 1000, artworkUrl)
                    settle(null)
                } catch (e: Exception) {
                    settle(e)
                }
            } else {
                main.post { GoogleCast.play(context, route!!, castUrl, title, artworkUrl, positionMs) { e -> settle(e) } }
            }
        }.start()
    }

    /** play, pause, seek (to [value] ms), skip (by [value] ms), volume (to [value] percent); answers with a status. */
    fun control(action: String, value: Long) {
        val session = current ?: return
        Thread {
            try {
                if (session.renderer != null) {
                    val renderer = session.renderer
                    when (action) {
                        "play" -> DlnaCast.resume(renderer)
                        "pause" -> DlnaCast.pause(renderer)
                        "seek" -> DlnaCast.seek(renderer, value.coerceAtLeast(0))
                        "skip" -> DlnaCast.seek(renderer, (DlnaCast.position(renderer) * 1000 + value).coerceAtLeast(0))
                        "volume" -> DlnaCast.setVolume(renderer, value.toInt())
                    }
                } else onMain {
                    when (action) {
                        "play" -> GoogleCast.play(context)
                        "pause" -> GoogleCast.pause(context)
                        "seek" -> GoogleCast.seek(context, value.coerceAtLeast(0))
                        "skip" -> GoogleCast.status(context)?.let { GoogleCast.seek(context, (it.positionMs + value).coerceAtLeast(0)) }
                        "volume" -> GoogleCast.setVolume(context, value.toInt())
                    }
                }
            } catch (_: Exception) {
                error(AppLanguage.tr("The TV did not answer.", "Der Fernseher hat nicht geantwortet."))
                return@Thread
            }
            Thread.sleep(400)
            statusNow()
        }.start()
    }

    /** Plays [url] on the TV instead, from where it is now: another audio or subtitle track picked on the phone. */
    fun switchStream(url: String) {
        val session = current ?: return
        Thread {
            val proxy = CastProxy(url)
            try {
                val castUrl = proxy.start() ?: throw IllegalStateException("no Wi-Fi")
                if (session.renderer != null) {
                    DlnaCast.play(session.renderer, castUrl, session.title, DlnaCast.position(session.renderer), session.artworkUrl)
                } else {
                    val positionMs = onMain { GoogleCast.status(context)?.positionMs } ?: 0L
                    var failed: Exception? = null
                    val done = CountDownLatch(1)
                    main.post {
                        GoogleCast.replace(context, castUrl, session.title, session.artworkUrl, positionMs) { e ->
                            failed = e
                            done.countDown()
                        }
                    }
                    if (!done.await(30, TimeUnit.SECONDS)) throw java.util.concurrent.TimeoutException()
                    failed?.let { throw it }
                }
            } catch (_: Exception) {
                proxy.stop()
                error(AppLanguage.tr("The TV did not take the other track.", "Der Fernseher hat die andere Spur nicht übernommen."))
                return@Thread
            }
            synchronized(this) {
                // ended while switching
                if (current !== session) return@Thread proxy.stop()
                current = Current(session.id, session.name, session.kind, session.renderer, proxy, session.title, session.artworkUrl)
            }
            session.proxy.stop()
            statusNow()
        }.start()
    }

    /** Plays another video (the next episode) on the TV in use from [positionMs], without a new search; the events of [start]. */
    fun load(url: String, title: String, positionMs: Long, artworkUrl: String) {
        val session = current ?: return error(AppLanguage.tr("No TV is connected.", "Es ist kein Fernseher verbunden."))
        emit(JSONObject().put("state", "connecting").put("device", session.name).put("kind", session.kind))
        Thread {
            val proxy = CastProxy(url)
            try {
                val castUrl = proxy.start() ?: throw IllegalStateException("no Wi-Fi")
                if (session.renderer != null) {
                    DlnaCast.play(session.renderer, castUrl, title, positionMs / 1000, artworkUrl)
                } else {
                    var failed: Exception? = null
                    val done = CountDownLatch(1)
                    main.post {
                        GoogleCast.replace(context, castUrl, title, artworkUrl, positionMs) { e ->
                            failed = e
                            done.countDown()
                        }
                    }
                    if (!done.await(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)) throw java.util.concurrent.TimeoutException()
                    failed?.let { throw it }
                }
            } catch (e: Exception) {
                proxy.stop()
                error(if (e is UpnpException && e.code == 701) AppLanguage.tr("The TV is off or in standby. Turn it on and try again.",
                    "Der Fernseher ist aus oder im Standby. Bitte einschalten und nochmal versuchen.")
                    else AppLanguage.tr("The TV did not take the video.", "Der Fernseher hat das Video nicht angenommen."))
                return@Thread
            }
            synchronized(this) {
                // ended while loading
                if (current !== session) return@Thread proxy.stop()
                current = Current(session.id, session.name, session.kind, session.renderer, proxy, title, artworkUrl)
            }
            session.proxy.stop()
            emit(JSONObject().put("state", "started").put("device", session.name).put("kind", session.kind))
            statusNow()
        }.start()
    }

    fun status() = Thread { statusNow() }.start()

    private fun statusNow() {
        val session = current ?: return emit(JSONObject().put("state", "idle"))
        val status = try {
            if (session.renderer != null) DlnaCast.status(session.renderer) else onMain { GoogleCast.status(context) }
        } catch (_: Exception) {
            null
        } ?: return
        // LG reports the volume last set over DLNA (0 at first), not the one of its remote: unknown, so the page shows no volume buttons
        val volume = if (session.kind == "webos") -1 else status.volume
        emit(JSONObject().put("state", "status").put("device", session.name).put("kind", session.kind).put("playing", status.playing)
            .put("positionMs", status.positionMs).put("durationMs", status.durationMs).put("volume", volume).put("ended", status.ended))
    }

    /** Ends casting; with [resume] the phone continues where the TV was. */
    fun stop(resume: Boolean) {
        val session = current ?: return
        current = null
        Thread {
            val positionMs = try {
                if (session.renderer != null) DlnaCast.position(session.renderer) * 1000 else onMain { GoogleCast.status(context)?.positionMs } ?: 0
            } catch (_: Exception) {
                0L
            }
            stopNow(session)
            emit(JSONObject().put("state", "stopped").put("positionMs", positionMs).put("resume", resume))
        }.start()
    }

    /** The casting device as {device, kind}, or "" when nothing casts (the page asks after reloads). */
    fun current(): String = current?.let { JSONObject().put("device", it.name).put("kind", it.kind).toString() } ?: ""

    fun release() {
        current?.proxy?.stop()
        current = null
    }

    private fun stopNow(session: Current) {
        try {
            if (session.renderer != null) DlnaCast.stop(session.renderer) else onMain { GoogleCast.stop(context) }
        } catch (_: Exception) {
        }
        session.proxy.stop()
    }

    private fun error(message: String) = emit(JSONObject().put("state", "error").put("message", message))

    /** Runs [block] on the main thread (Cast SDK) and waits for it. */
    private fun <T> onMain(block: () -> T): T? {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        var value: T? = null
        val done = CountDownLatch(1)
        main.post {
            try {
                value = block()
            } finally {
                done.countDown()
            }
        }
        done.await(3, TimeUnit.SECONDS)
        return value
    }
}
