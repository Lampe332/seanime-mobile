package com.seanime.app.audit

import android.app.Instrumentation
import android.content.Intent
import android.os.Bundle
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import androidx.media3.common.text.CueGroup
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.seanime.app.MainActivity
import com.seanime.app.offline.EpisodeDownloads
import com.seanime.app.offline.OfflineActivity
import com.seanime.app.offline.OfflinePlayerView
import com.seanime.app.offline.OfflineLibrary
import com.seanime.app.offline.EpisodeBatchQueue
import android.app.Activity
import android.app.AlertDialog
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.SeekBar
import org.json.JSONArray
import org.json.JSONObject
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Device checks against deterministic MP4/HLS fixtures; playback runs after origin shutdown. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class OfflineInstrumentation : Instrumentation() {
    private var mode = "download"
    private val pauseKey = "offline-test-pause"
    private val pauseTitle = "Offline-Test pause"
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); mode = arguments?.getString("mode") ?: mode; start() }
    private fun main(action: () -> Unit) {
        var failure: Throwable? = null
        runOnMainSync { try { action() } catch (error: Throwable) { failure = error } }
        failure?.let { throw it }
    }
    private fun until(message: String, timeout: Long = 45000, check: () -> Boolean) {
        val end = System.currentTimeMillis() + timeout
        while (System.currentTimeMillis() < end) { if (check()) return; Thread.sleep(200) }
        error(message)
    }

    /** Serves the fixture assets. `throttleMs` delays every chunk so a download stays observable. */
    private fun startFixtureServer(throttleMs: Long): ServerSocket {
        val server = ServerSocket(0)
        thread(isDaemon = true) {
            try { while (!server.isClosed) {
                val socket = server.accept()
                thread(isDaemon = true) { socket.use {
                    val reader = it.getInputStream().bufferedReader()
                    val request = reader.readLine() ?: return@use
                    var range: String? = null
                    while (true) { val line = reader.readLine() ?: break; if (line.isEmpty()) break
                        if (line.startsWith("Range:", true)) range = line.substringAfter(':').trim() }
                    val path = request.split(' ')[1].substringBefore('?').substringAfterLast('/')
                    val bytes = context.assets.open("offline/$path").use { stream -> stream.readBytes() }
                    val start = range?.substringAfter("bytes=")?.substringBefore('-')?.toIntOrNull() ?: 0
                    val body = bytes.copyOfRange(start, bytes.size)
                    val mime = when { path.endsWith("m3u8") -> "application/vnd.apple.mpegurl"; path.endsWith("mp4") -> "video/mp4"; path.endsWith("vtt") -> "text/vtt"; else -> "video/mp2t" }
                    val partial = if (start > 0) "Content-Range: bytes $start-${bytes.size-1}/${bytes.size}\r\n" else ""
                    val header = "HTTP/1.1 ${if (start > 0) "206 Partial Content" else "200 OK"}\r\nContent-Type: $mime\r\nContent-Length: ${body.size}\r\nAccept-Ranges: bytes\r\n${partial}Connection: close\r\n\r\n"
                    val out = it.getOutputStream()
                    // A paused or cancelled download closes the socket mid-body; that is expected
                    // and must not kill the server thread with an unhandled Broken pipe.
                    try {
                        out.write(header.toByteArray())
                        var sent = 0
                        val chunk = 32 * 1024
                        while (sent < body.size) {
                            val end = minOf(sent + chunk, body.size)
                            out.write(body, sent, end - sent)
                            out.flush()
                            sent = end
                            if (throttleMs > 0) Thread.sleep(throttleMs)
                        }
                    } catch (_: Exception) {
                    }
                } }
            } } catch (_: Exception) {}
        }
        return server
    }

    private fun fixturePayload(key: String, title: String, file: String, type: String, port: Int) =
        JSONObject().put("key", key).put("title", title)
            .put("episode", 1).put("quality", "360p").put("provider", "Lokale Testquelle")
            .put("type", type).put("url", "http://127.0.0.1:$port/$file")
            .put("subtitles", JSONArray().put(JSONObject().put("url", "http://127.0.0.1:$port/sub.vtt")
                .put("mime", "text/vtt").put("language", "de").put("label", "Deutsch").put("default", true)))

    private fun findByTitle(store: EpisodeDownloads, title: String): Download? =
        store.all().find { it.request.data.isNotEmpty() && store.metadata(it).optString("title") == title }

    private fun descendants(view: View): List<View> = listOf(view) +
        if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
    private fun field(instance: Any, name: String): Any? = instance.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(instance)
    private fun javascript(activity: Activity, source: String): String {
        val finished = CountDownLatch(1)
        var result = "null"
        main { (field(activity, "webView") as android.webkit.WebView).evaluateJavascript("(function(){ $source })()") {
            result = it; finished.countDown()
        } }
        check(finished.await(10, TimeUnit.SECONDS)) { "WebView JavaScript timed out" }
        return result
    }
    private fun libraryChecks(activity: Activity, store: EpisodeDownloads, offline: Boolean): String {
        until("Trusted main WebView did not initialize", 60000) { javascript(activity, "return !!window.__seanimeOfflineToken;") == "true" }
        if (!offline) {
            val fixture = startFixtureServer(0)
            try {
                for (number in 1..2) {
                    val payload = fixturePayload("offline-library-$number", "Offline-Test Bibliothek", "sample.mp4", "mp4", fixture.localPort)
                        .put("episode", number).put("description", "Gespeicherte Anime-Information")
                        .put("coverUrl", "http://127.0.0.1:${fixture.localPort}/test-cover.png")
                        .put("bannerUrl", "http://127.0.0.1:${fixture.localPort}/test-cover.png")
                        .put("episodeImageUrl", "http://127.0.0.1:${fixture.localPort}/test-cover.png")
                        .put("episodeTitle", "Testfolge $number").put("episodeDescription", "Gespeicherte Folgenbeschreibung")
                    enqueueAndWait(store, payload)
                }
                until("Library fixtures did not finish") { store.all().filter { store.metadata(it).optString("title") == "Offline-Test Bibliothek" }.let { it.size == 2 && it.all { store.ready(it.request.id) } } }
                until("Artwork did not persist") { store.all().filter { store.metadata(it).optString("title") == "Offline-Test Bibliothek" }.all {
                    OfflineLibrary.get(targetContext).artworkFile(store.metadata(it).optString("episodeImageAsset")) != null
                } }
            } finally { fixture.close() }
        }
        until("Main navigation did not initialize", 60000) { javascript(activity, "var nav=document.getElementById('__seanime_bottom_nav');return !!document.querySelector('[data-main-layout-container]') && !!nav && getComputedStyle(nav).visibility==='visible' && !!nav.querySelector('[data-nav-id=android-downloads]');") == "true" }
        javascript(activity, "document.querySelector('#__seanime_bottom_nav [data-nav-id=android-downloads]').click(); return true;")
        until("Downloads route did not render") { javascript(activity, "return !!document.querySelector('[data-downloaded-anime]');") == "true" }
        val overview = JSONObject(javascript(activity, """
            var nav = document.getElementById('__seanime_bottom_nav');
            var back = document.querySelector('[aria-label="Back to Seanime"]');
            var r = back.getBoundingClientRect(); var svg = back.querySelector('svg').getBoundingClientRect();
            return {route:location.pathname, nav:!!nav && nav.getBoundingClientRect().height > 0 && getComputedStyle(nav).visibility !== 'hidden',
                labels:nav ? nav.innerText : '', cards:document.querySelectorAll('[data-downloaded-anime]').length,
                centered:Math.abs((r.left+r.width/2)-(svg.left+svg.width/2))<1 && Math.abs((r.top+r.height/2)-(svg.top+svg.height/2))<1};
        """))
        check(overview.getString("route").contains("android-downloads")) { "Incorrect route: $overview" }
        check(overview.getBoolean("nav")) { "Navigation hidden: $overview" }
        check(overview.getBoolean("centered")) { "Back icon not centered: $overview" }
        listOf("Home", "My Lists", "Discover", "Search", "Menu", "Downloads").forEach { check(overview.getString("labels").contains(it)) { "Navigation item missing: $it" } }
        javascript(activity, "Array.from(document.querySelectorAll('[data-downloaded-anime]')).find(x=>x.innerText.includes('Offline-Test Bibliothek')).click();return true;")
        until("Anime detail did not render") { javascript(activity, "return document.querySelectorAll('[data-downloaded-episode]').length===2;") == "true" }
        until("Offline episode artwork failed") { javascript(activity, "return Array.from(document.querySelectorAll('[data-downloaded-episode] img')).every(x=>x.complete && x.naturalWidth>0) && document.querySelectorAll('[data-downloaded-episode] img').length===2;") == "true" }
        check(javascript(activity, "return document.body.innerText.includes('Testfolge 1') && document.body.innerText.includes('Testfolge 2') && document.body.innerText.includes('About this anime');") == "true")
        javascript(activity, "document.querySelector('[aria-label=\"Delete episode 1\"]').click();return true;")
        until("Delete confirmation missing") { javascript(activity, "return !!document.querySelector('[data-download-delete-dialog]');") == "true" }
        javascript(activity, "window.dispatchEvent(new Event('seanime:android-back',{cancelable:true}));return true;")
        until("Back did not cancel deletion while retaining the episodes") { javascript(activity, "return !document.querySelector('[data-download-delete-dialog]') && document.querySelectorAll('[data-downloaded-episode]').length===2;") == "true" }
        javascript(activity, "document.querySelector('[aria-label=\"Back to anime overview\"]').click();return true;")
        until("Back did not return to anime overview") { javascript(activity, "return !!document.querySelector('[data-downloaded-anime]') && !document.querySelector('[data-downloaded-episode]');") == "true" }
        // Check the real existing episode was enriched without downloading its video again.
        if (!offline && store.all().any { store.metadata(it).optInt("mediaId") == 21087 }) until("Existing anime metadata was not supplemented", 90000) {
            javascript(activity, "return true;")
            store.all().find { store.metadata(it).optInt("mediaId") == 21087 }?.let {
                val data = store.metadata(it)
                data.optString("episodeTitle").isNotBlank() && listOf("coverAsset", "bannerAsset", "episodeImageAsset").all { field -> OfflineLibrary.get(targetContext).artworkFile(data.optString(field)) != null }
            } == true
        }
        if (offline) {
            javascript(activity, "Array.from(document.querySelectorAll('[data-downloaded-anime]')).find(x=>x.innerText.includes('Offline-Test Bibliothek')).click();return true;")
            until("Fixture details missing") { javascript(activity, "return document.querySelectorAll('[data-downloaded-episode]').length===2;") == "true" }
            val fixtures = store.all().filter { store.metadata(it).optString("title") == "Offline-Test Bibliothek" }
            val sharedArtwork = store.metadata(fixtures.first()).optString("coverAsset")
            for ((index, number) in listOf(2, 1).withIndex()) {
                javascript(activity, "document.querySelector('[aria-label=\"Delete episode $number\"]').click();return true;")
                until("Delete dialog missing") { javascript(activity, "return !!document.querySelector('[data-download-delete-dialog]');") == "true" }
                javascript(activity, "Array.from(document.querySelectorAll('[data-download-delete-dialog] button')).find(x=>x.textContent.trim()==='Delete').click();return true;")
                until("Episode deletion did not settle") {
                    store.all().count { store.metadata(it).optString("title") == "Offline-Test Bibliothek" } == 1 - index
                }
                if (index == 0) check(OfflineLibrary.get(targetContext).artworkFile(sharedArtwork) != null) { "Deleting one episode removed shared artwork" }
            }
            until("Unreferenced artwork was not removed") { OfflineLibrary.get(targetContext).artworkFile(sharedArtwork) == null }
            fixtures.forEach { check(OfflineLibrary.get(targetContext).details(it.request.id).length() == 0) { "Deleted episode metadata retained" } }
            javascript(activity, "document.querySelector('[aria-label=\"Back to anime overview\"]').click();return true;")
            until("Deleted anime still shown") { javascript(activity, "return !!document.querySelector('[data-downloaded-anime]') && !Array.from(document.querySelectorAll('[data-downloaded-anime]')).some(x=>x.innerText.includes('Offline-Test Bibliothek'));") == "true" }
        }
        return "PASS [library${if (offline) "-offline" else ""}]: real main route, original six navigation tabs, centered back icon, anime grouping, two sorted episodes, local cover/episode artwork, saved facts, delete cancel, back to overview.\n"
    }
    private fun playerEntryChecks(activity: Activity): String {
        until("Main navigation did not initialize", 60000) { javascript(activity, "var nav=document.getElementById('__seanime_bottom_nav');return !!document.querySelector('[data-main-layout-container]') && !!nav && getComputedStyle(nav).visibility==='visible' && !!nav.querySelector('[data-nav-id=android-downloads]');") == "true" }
        javascript(activity, "document.querySelector('#__seanime_bottom_nav [data-nav-id=android-downloads]').click();return true;")
        until("Anime card missing") { javascript(activity, "return !!document.querySelector('[data-downloaded-anime]');") == "true" }
        javascript(activity, "document.querySelector('[data-downloaded-anime]').click();return true;")
        until("Episode missing") { javascript(activity, "return !!document.querySelector('[data-downloaded-episode]');") == "true" }
        val monitor = addMonitor(OfflineActivity::class.java.name, null, false)
        try {
            javascript(activity, "document.querySelector('[data-downloaded-episode] button').click();return true;")
            val playback = waitForMonitorWithTimeout(monitor, 15000) ?: error("Playback activity did not open from the real downloads route")
            var original: ExoPlayer? = null
            until("Direct offline player did not prepare") {
                var ready = false
                main { original = field(playback, "player") as ExoPlayer?; ready = original?.playbackState == Player.STATE_READY }
                ready
            }
            var before = 0L
            main { before = original!!.currentPosition }
            Thread.sleep(1200)
            main { check(original!!.currentPosition > before + 500) { "Offline playback did not advance" }; original!!.pause() }
            click(playback, "Vollbild umschalten")
            until("Fullscreen did not enter landscape") { playback.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE }
            main { check(field(playback, "player") === original); @Suppress("DEPRECATION") playback.onBackPressed() }
            until("Fullscreen did not restore portrait") { playback.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT }
            click(playback, "Alle Downloads")
            until("Player did not close back to the app") { playback.isFinishing || playback.isDestroyed }
            Thread.sleep(2000)
            until("Episode list and original navigation were not restored") { javascript(activity, "return !!document.querySelector('[data-downloaded-episode]') && !!document.querySelector('#__seanime_bottom_nav');") == "true" }
        } finally { removeMonitor(monitor) }
        return "PASS [player-entry]: actual Downloads > anime > episode launched native playback, video advanced offline, same decoder in fullscreen, portrait restored, back returned to the episode list and main navigation.\n"
    }
    private fun click(activity: Activity, description: String) {
        main {
            descendants(activity.window.decorView).first { it.contentDescription?.toString() == description && it.isShown }.performClick()
        }
        waitForIdleSync()
    }
    private fun uiChecks(store: EpisodeDownloads): String {
        val activity = startActivitySync(Intent(targetContext, OfflineActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        waitForIdleSync()
        Thread.sleep(1200)
        fun current() = field(activity, "player") as ExoPlayer?
        fun ready(): Boolean { var value = false; main { value = current()?.playbackState == Player.STATE_READY }; return value }
        click(activity, "Ready")
        main { descendants(activity.window.decorView).first { it is TextView && it.isShown && it.text.toString().contains("Watch") }.performClick() }
        until("UI player did not prepare") { ready() }
        lateinit var original: ExoPlayer
        main {
            original = current()!!
            val host = field(activity, "playerHost") as View
            check(kotlin.math.abs(host.width.toFloat() / host.height - 16f / 9) < .03f) { "Portrait video is not 16:9: ${host.width}x${host.height}" }
            original.pause(); original.seekTo(6000)
        }
        click(activity, "Forward 10 seconds")
        main { check(kotlin.math.abs(original.currentPosition - minOf(16000L, original.duration)) < 300) { "Forward seek failed: ${original.currentPosition}/${original.duration}" } }
        click(activity, "Back 5 seconds")
        main { check(kotlin.math.abs(original.currentPosition - (minOf(16000L, original.duration) - 5000).coerceAtLeast(0)) < 300) { "Backward seek failed: ${original.currentPosition}" } }
        // Exercise scrubbing through the real SeekBar listener.
        val location = IntArray(2)
        var seekX = 0f; var seekY = 0f
        main {
            val bar = descendants(activity.window.decorView).filterIsInstance<SeekBar>().single()
            bar.getLocationOnScreen(location)
            seekX = location[0] + bar.width * .4f; seekY = location[1] + bar.height / 2f
        }
        val now = android.os.SystemClock.uptimeMillis()
        sendPointerSync(android.view.MotionEvent.obtain(now, now, android.view.MotionEvent.ACTION_DOWN, seekX, seekY, 0))
        sendPointerSync(android.view.MotionEvent.obtain(now, now + 100, android.view.MotionEvent.ACTION_UP, seekX, seekY, 0))
        waitForIdleSync()
        main { check(kotlin.math.abs(original.currentPosition - original.duration * .4) < original.duration * .1) { "Scrubbing failed" } }
        click(activity, "Playback speed")
        main {
            val pv = descendants(activity.window.decorView).filterIsInstance<OfflinePlayerView>().single()
            val dialog = field(pv, "dialog") as AlertDialog
            dialog.listView.performItemClick(dialog.listView.getChildAt(4), 4, 4)
            check(original.playbackParameters.speed == 1.5f) { "Speed selection failed" }
        }
        click(activity, "Subtitles")
        main {
            val pv = descendants(activity.window.decorView).filterIsInstance<OfflinePlayerView>().single()
            val dialog = field(pv, "dialog") as AlertDialog
            dialog.listView.performItemClick(dialog.listView.getChildAt(0), 0, 0)
            check(original.trackSelectionParameters.disabledTrackTypes.contains(androidx.media3.common.C.TRACK_TYPE_TEXT))
        }
        click(activity, "Toggle fullscreen")
        until("Landscape not reached") { activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE }
        Thread.sleep(600)
        main {
            check(current() === original) { "Fullscreen replaced the decoder" }
            check(!(field(activity, "playerDetails") as View).isShown) { "Details still shown in fullscreen" }
            @Suppress("DEPRECATION") activity.onBackPressed()
        }
        until("Fullscreen exit did not restore portrait") { activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT }
        Thread.sleep(800)
        main { check(current() === original); @Suppress("DEPRECATION") activity.onBackPressed() }
        Thread.sleep(800)
        main { check(current() == null) { "Back did not release player" } }
        click(activity, "Ready")
        main { descendants(activity.window.decorView).first { it is TextView && it.isShown && it.text.toString().contains("Continue") }.performClick() }
        until("Resume did not prepare") { ready() }
        main {
            check(current()!!.currentPosition > 1000) { "Playback position not restored" }
            current()!!.pause()
            @Suppress("DEPRECATION") activity.onBackPressed()
            activity.finish()
        }
        return "PASS [ui]: ready filter, 16:9, -5/+10, scrubbing, 1.5x, subtitles off, same decoder in landscape, back, position restored.\n"
    }

    private fun enqueueAndWait(store: EpisodeDownloads, payload: JSONObject) {
        val done = CountDownLatch(1)
        var failure: String? = null
        main { store.enqueue(payload) { failure = it; done.countDown() } }
        check(done.await(30, TimeUnit.SECONDS)) { "Prepare timeout: ${payload.optString("title")}" }
        check(failure == null) { failure ?: "Unknown prepare error" }
    }

    private fun capture(name: String) {
        // DOM readiness precedes WebView compositing and drawer transitions.
        Thread.sleep(1000)
        waitForIdleSync()
        val bitmap = uiAutomation.takeScreenshot()
        java.io.File(targetContext.getExternalFilesDir(null), "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    private fun mangaChecks(activity: Activity): String {
        until("Main navigation missing", 60000) { javascript(activity, "return !!document.querySelector('[data-main-layout-container]') && !!document.querySelector('#__seanime_bottom_nav [data-nav-id=android-downloads]');") == "true" }
        javascript(activity, "document.querySelector('#__seanime_bottom_nav [data-nav-id=android-downloads]').click();return true;")
        until("Download type tabs missing") { javascript(activity, "return !!document.querySelector('[role=tablist][aria-label=\"Download-Typ\"]');") == "true" }
        javascript(activity, "Array.from(document.querySelectorAll('[role=tab]')).find(x=>x.textContent==='Manga').click();return true;")
        until("Overgeared manga card missing") { javascript(activity, "return Array.from(document.querySelectorAll('[data-downloaded-manga]')).some(x=>/overgear/i.test(x.innerText));") == "true" }
        until("Local manga cover missing") { javascript(activity, "return Array.from(document.querySelectorAll('[data-downloaded-manga] img')).some(x=>x.src.includes('/__android_offline/')&&x.complete&&x.naturalWidth>0);") == "true" }
        capture("manga-library")
        javascript(activity, "Array.from(document.querySelectorAll('[data-downloaded-manga]')).find(x=>/overgear/i.test(x.innerText)).click();return true;")
        until("Chapter 2 not available") { javascript(activity, "return !!document.querySelector('[aria-label=\"Read chapter 2\"]:not(:disabled)');") == "true" }
        capture("manga-chapters")
        javascript(activity, "document.querySelector('[aria-label=\"Read chapter 2\"]').click();return true;")
        until("Downloaded manga page did not decode", 60000) { javascript(activity, "return Array.from(document.querySelectorAll('[data-chapter-reader-drawer-content] img')).some(x=>x.src.includes('/manga-downloads/')&&x.complete&&x.naturalWidth>0);") == "true" }
        capture("manga-reader")
        javascript(activity, "window.dispatchEvent(new Event('seanime:android-back',{cancelable:true}));return true;")
        until("Reader back lost chapter list") { javascript(activity, "return !!document.querySelector('[aria-label=\"Read chapter 2\"]')&&!document.querySelector('[data-chapter-reader-drawer-content]');") == "true" }
        return "PASS [manga]: Downloads > Manga > Overgeared > Chapter 2; local cover and local-page image decoded; back preserved chapter list.\n"
    }
    private fun batchChecks(activity: Activity, store: EpisodeDownloads): String {
        val queue = EpisodeBatchQueue.get(targetContext)
        if (mode == "batch-real") {
            val payload = JSONObject().put("mediaId", 21087).put("title", "One-Punch Man").put("provider", "animetoast").put("quality", "Auto").put("dubbed", false)
                .put("episodes", JSONArray().put(JSONObject().put("number", 9)).put(JSONObject().put("number", 10)))
            var added = -1
            main { added = queue.submit(payload); check(queue.submit(payload) == 0) { "Duplicate accepted" } }
            check(added == 2) { "Expected 2 new episodes; got $added" }
            until("Batch source resolution or download failed", 300000) {
                val jobs = queue.snapshot()
                check(jobs.none { it.optString("status") == "failed" }) { jobs.filter { it.optString("status") == "failed" }.map { "Episode ${it.optString("episode")}: ${it.optString("error")}" }.toString() }
                val episodes = store.all().filter { store.metadata(it).optInt("mediaId") == 21087 && store.metadata(it).optString("episode") in listOf("9", "10") }
                check(episodes.none { it.state == Download.STATE_FAILED }) { "Media3 episode download failed" }
                episodes.size == 2 && episodes.all { store.ready(it.request.id) }
            }
            return "PASS [batch-real]: one submission queued episodes 9+10; duplicate added zero; both real episodes downloaded completely.\n"
        }
        if (mode == "batch-pending") {
            val payload = JSONObject().put("mediaId", 9999999).put("title", "Offline-Test Warteschlange").put("provider", "offline-test")
                .put("episodes", JSONArray().put(JSONObject().put("number", 1)).put(JSONObject().put("number", 2)))
            main { check(queue.submit(payload) == 2); check(queue.submit(payload) == 0) }
            val jobs = queue.snapshot().filter { it.optInt("mediaId") == 9999999 }
            check(jobs.size == 2 && jobs.all { it.optString("status") == "queued" })
            main { queue.action(jobs[0].getString("id"), "pause") }
        } else {
            val jobs = queue.snapshot().filter { it.optInt("mediaId") == 9999999 }
            check(jobs.size == 2 && jobs.count { it.optString("status") == "paused" } == 1 && jobs.count { it.optString("status") == "queued" } == 1) { "Queue did not survive restart" }
            main { jobs.forEach { queue.action(it.getString("id"), "remove") } }
            check(queue.snapshot().none { it.optInt("mediaId") == 9999999 })
        }
        return "PASS [$mode]: persistent multi-episode queue, duplicate prevention, pause and removal.\n"
    }
    private fun bulkChecks(activity: Activity, store: EpisodeDownloads): String {
        libraryChecks(activity, store, false)
        val fixtures = store.all().filter { store.metadata(it).optString("title") == "Offline-Test Bibliothek" }
        check(fixtures.size == 2)
        javascript(activity, "Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='Select').click();return true;")
        until("Selection toolbar missing") { javascript(activity, "return !!document.querySelector('[data-anime-selection]');") == "true" }
        javascript(activity, "Array.from(document.querySelectorAll('[data-downloaded-anime]')).find(x=>x.innerText.includes('Offline-Test Bibliothek')).click();return true;")
        until("Anime was not selected") { javascript(activity, "return !!document.querySelector('[data-downloaded-anime][aria-pressed=true]');") == "true" }
        capture("anime-selection")
        javascript(activity, "Array.from(document.querySelectorAll('[data-anime-selection] button')).find(x=>x.textContent.includes('Delete selected')).click();return true;")
        until("Anime delete confirmation missing") { javascript(activity, "return !!document.querySelector('[data-anime-delete-dialog]');") == "true" }
        javascript(activity, "Array.from(document.querySelectorAll('[data-anime-delete-dialog] button')).find(x=>x.textContent==='Cancel').click();return true;")
        until("Cancel failed") { javascript(activity, "return !document.querySelector('[data-anime-delete-dialog]');") == "true" }
        check(fixtures.all { store.ready(it.request.id) })
        javascript(activity, "Array.from(document.querySelectorAll('[data-anime-selection] button')).find(x=>x.textContent.includes('Delete selected')).click();return true;")
        until("Second delete dialog missing") { javascript(activity, "return !!document.querySelector('[data-anime-delete-dialog]');") == "true" }
        javascript(activity, "Array.from(document.querySelectorAll('[data-anime-delete-dialog] button')).find(x=>x.textContent==='Delete anime').click();return true;")
        until("Whole-anime deletion failed") { store.all().none { store.metadata(it).optString("title") == "Offline-Test Bibliothek" } }
        fixtures.forEach { check(OfflineLibrary.get(targetContext).details(it.request.id).length() == 0) }
        return "PASS [bulk]: selected fixture anime, cancelled deletion preserving two videos, confirmed deletion removed both videos and metadata.\n"
    }
    private fun pickerChecks(activity: Activity): String {
        until("WebView token missing", 60000) { javascript(activity, "return !!window.__seanimeOfflineToken;") == "true" }
        main { (field(activity, "webView") as android.webkit.WebView).loadUrl("http://127.0.0.1:43211/entry?id=21087&tab=onlinestream") }
        until("Season button missing", 90000) { javascript(activity, "return !!document.querySelector('[data-download-season]:not(:disabled)');") == "true" }
        javascript(activity, "document.querySelector('[data-download-season]').click();return true;")
        until("Season picker missing") { javascript(activity, "return !!document.querySelector('[data-episode-download-picker]');") == "true" }
        val count = javascript(activity, "return document.querySelectorAll('[data-episode-download-picker] input[type=checkbox]').length;").toInt()
        check(count >= 12) { "Season episode list incomplete: $count" }
        javascript(activity, "Array.from(document.querySelectorAll('[data-episode-download-picker] button')).find(x=>x.textContent==='None').click();return true;")
        until("Clear selection failed") { javascript(activity, "return document.querySelectorAll('[data-episode-download-picker] input:checked').length===0;") == "true" }
        javascript(activity, "Array.from(document.querySelectorAll('[data-episode-download-picker] button')).find(x=>x.textContent==='Whole season').click();return true;")
        until("Select whole season failed") { javascript(activity, "var e=document.querySelectorAll('[data-episode-download-picker] input:not(:disabled)');return e.length>0&&Array.from(e).every(x=>x.checked);") == "true" }
        capture("season-picker")
        return "PASS [picker]: actual streaming page, full episode list, clear selection, whole-season selection.\n"
    }
    override fun onStart() {
        val result = Bundle()
        var server: ServerSocket? = null
        try {
            val mainActivity = startActivitySync(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            lateinit var store: EpisodeDownloads
            main { store = EpisodeDownloads.get(targetContext) }

            if (mode == "manga" || mode == "bulk" || mode == "picker" || mode.startsWith("batch-")) {
                result.putString("stream", when (mode) {
                    "manga" -> mangaChecks(mainActivity)
                    "bulk" -> bulkChecks(mainActivity, store)
                    "picker" -> pickerChecks(mainActivity)
                    else -> batchChecks(mainActivity, store)
                }); result.putBoolean("passed", true)
            } else if (mode == "player-entry") {
                result.putString("stream", playerEntryChecks(mainActivity))
                result.putBoolean("passed", true)
            } else if (mode == "library" || mode == "library-offline") {
                result.putString("stream", libraryChecks(mainActivity, store, mode == "library-offline"))
                result.putBoolean("passed", true)
            } else if (mode == "ui") {
                result.putString("stream", uiChecks(store))
                result.putBoolean("passed", true)
            } else if (mode == "pause") {
                server = startFixtureServer(120L)
                val port = server.localPort
                enqueueAndWait(store, fixturePayload(pauseKey, pauseTitle, "sample.mp4", "mp4", port))
                until("Throttled download never started") { (findByTitle(store, pauseTitle)?.bytesDownloaded ?: 0L) > 0L }
                val id = findByTitle(store, pauseTitle)!!.request.id
                main { store.pause(id, true) }
                Thread.sleep(4000)                                  // let in-flight chunks settle
                val a = store.all().find { it.request.id == id }!!
                check(a.stopReason != Download.STOP_REASON_NONE) { "Pause did not set a stop reason" }
                Thread.sleep(4000)
                val b = store.all().find { it.request.id == id }!!
                check(b.state != Download.STATE_COMPLETED) { "Download completed even though it was paused" }
                check(b.bytesDownloaded - a.bytesDownloaded < 128L * 1024) {
                    "Download kept running while paused (+${b.bytesDownloaded - a.bytesDownloaded} bytes)"
                }
                main { store.pause(id, false) }
                until("Download did not resume after pause", 30000) {
                    (store.all().find { it.request.id == id }?.bytesDownloaded ?: 0L) > b.bytesDownloaded
                }
                until("Resumed download never finished") { store.ready(id) }
                check(store.ready(id)) { "Episode not offline-ready after resume" }
                result.putString("origin", "PASS: paused at ${a.bytesDownloaded} bytes, resumed, finished at ${store.all().find { it.request.id == id }!!.bytesDownloaded} bytes")
                // Deleting must remove the whole group from the persisted index.
                main { store.remove(id) }
                until("Delete did not remove the episode") { findByTitle(store, pauseTitle) == null && store.all().none { it.request.id.startsWith(id) } }
                result.putString("stream", "PASS [pause]: pause froze progress, resume finished the download, delete removed the episode.\n")
                result.putBoolean("passed", true)
            } else {
                if (mode == "download") {
                    server = startFixtureServer(0L)
                    val port = server.localPort
                    for ((key, file, type) in listOf(Triple("offline-test-mp4", "sample.mp4", "mp4"), Triple("offline-test-hls", "master.m3u8", "m3u8"))) {
                        val title = "Offline-Test $type"
                        enqueueAndWait(store, fixturePayload(key, title, file, type, port))
                        until("Download did not complete: $type") { findByTitle(store, title)?.let { store.ready(it.request.id) } == true }
                    }
                    server.close()
                    result.putString("origin", "PASS: MP4 + HLS + external German subtitles downloaded; origin stopped")
                }
                val tests = store.all().filter { it.request.data.isNotEmpty() && store.metadata(it).optString("title").startsWith("Offline-Test") && store.metadata(it).optString("title") != pauseTitle }
                check(tests.size >= 2) { "Expected at least 2 persisted test episodes, got ${tests.size}" }
                if (mode == "cleanup") {
                    main { tests.forEach { store.remove(it.request.id) } }
                    until("Test downloads not removed") { store.all().none { d -> tests.any { d.request.id.startsWith(it.request.id) } } }
                } else {
                    tests.forEach { download ->
                        check(store.ready(download.request.id))
                        if (store.metadata(download).optString("title").contains("m3u8")) {
                            check(download.request.streamKeys.count { it.groupIndex == 0 } == 1) { "HLS downloaded multiple video renditions" }
                        }
                        val played = CountDownLatch(1)
                        val cues = CountDownLatch(1)
                        var failure: String? = null
                        lateinit var player: ExoPlayer
                        main {
                            player = ExoPlayer.Builder(targetContext)
                                .setMediaSourceFactory(DefaultMediaSourceFactory(store.offlineDataSource())).build()
                            player.addListener(object : Player.Listener {
                                override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_READY) played.countDown() }
                                override fun onPlayerError(error: PlaybackException) { failure = error.errorCodeName; played.countDown() }
                                override fun onCues(cueGroup: CueGroup) { if (cueGroup.cues.any { it.text?.contains("Offline") == true }) cues.countDown() }
                            })
                            player.setMediaItem(store.mediaItem(download)); player.prepare(); player.playWhenReady = true
                        }
                        try {
                            check(played.await(20, TimeUnit.SECONDS)) { "Offline playback timeout" }
                            check(failure == null) { "Offline playback failed: $failure" }
                            check(cues.await(10, TimeUnit.SECONDS)) { "German subtitle not rendered offline" }
                            var position = 0L
                            Thread.sleep(1000)
                            main { position = player.currentPosition }
                            check(position > 500) { "Playback did not advance" }
                        } finally { main { player.release() } }
                    }
                }
                result.putString("stream", "PASS [$mode]: MP4/HLS cache-only playback, German subtitles, one HLS rendition, persistent index.\n")
                result.putBoolean("passed", true)
            }
        } catch (e: Throwable) { result.putString("stream", "FAIL [$mode]: ${e.stackTraceToString()}\n"); result.putBoolean("passed", false) }
        finally { server?.close() }
        finish(if (result.getBoolean("passed")) -1 else 0, result)
    }
}
