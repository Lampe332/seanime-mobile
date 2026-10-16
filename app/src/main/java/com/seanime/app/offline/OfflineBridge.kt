package com.seanime.app.offline

import com.seanime.app.AppLanguage.tr
import android.app.Activity
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONObject
import org.json.JSONArray
import androidx.media3.exoplayer.offline.Download
import java.util.UUID

/** Token is injected into the trusted main document only, never into provider iframes. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class OfflineBridge(private val activity: Activity) {
    private var mainView: WebView? = null
    @Volatile private var token: String? = null
    fun invalidate() { token = null }
    fun inject(view: WebView) {
        val uri = android.net.Uri.parse(view.url ?: "")
        if (uri.scheme != "http" || uri.host != "127.0.0.1" || uri.port != 43211) return
        val next = UUID.randomUUID().toString()
        mainView = view
        EpisodeDownloads.get(activity)
        EpisodeBatchQueue.get(activity).start()
        token = next
        view.evaluateJavascript("window.__seanimeOfflineToken = ${JSONObject.quote(next)};", null)
    }
    @JavascriptInterface fun open(value: String) {
        if (value != token) return
        activity.runOnUiThread { if (value == token && !activity.isDestroyed) mainView?.evaluateJavascript("window.dispatchEvent(new Event('seanime-open-downloads'));", null) }
    }
    @JavascriptInterface fun snapshot(value: String): String {
        if (value != token) return "[]"
        val store = EpisodeDownloads.get(activity)
        val all = store.all()
        OfflineLibrary.get(activity).ensure(all)
        val list = JSONArray()
        all.filter { !it.request.id.contains(":sub:") }.forEach { download ->
            val id = download.request.id
            val group = all.filter { it.request.id == id || it.request.id.startsWith("$id:sub:") }
            val metadata = store.metadata(download)
            val ready = group.size == (metadata.optJSONArray("subtitles")?.length() ?: 0) + 1 && group.all { it.state == Download.STATE_COMPLETED }
            val status = when {
                download.state == Download.STATE_REMOVING -> "removing"
                ready -> "ready"
                group.any { it.state == Download.STATE_FAILED } -> "failed"
                group.any { it.stopReason != 0 } -> "paused"
                else -> "downloading"
            }
            list.put(metadata.put("id", id).put("status", status).put("ready", ready)
                .put("bytes", group.sumOf { it.bytesDownloaded }).put("progress", download.percentDownloaded.toInt().coerceIn(0, 100))
                .put("position", activity.getSharedPreferences("offline-playback", Activity.MODE_PRIVATE).getLong(id, 0)))
        }
        val realIds = all.map { it.request.id }.toSet()
        EpisodeBatchQueue.get(activity).snapshot().filter { it.optString("id") !in realIds }.forEach {
            list.put(OfflineLibrary.get(activity).merge(it.optString("id"), it))
        }
        return list.toString()
    }
    @JavascriptInterface fun action(value: String, id: String, action: String) {
        if (value != token || !Regex("[a-f0-9]{32}").matches(id)) return
        activity.runOnUiThread {
            if (value != token || activity.isDestroyed) return@runOnUiThread
            val store = EpisodeDownloads.get(activity)
            if (action != "play" && EpisodeBatchQueue.get(activity).action(id, action)) return@runOnUiThread
            when (action) {
                "play" -> if (store.ready(id)) activity.startActivity(Intent(activity, OfflineActivity::class.java).putExtra("downloadId", id))
                "pause" -> store.pause(id, true)
                "resume" -> store.pause(id, false)
                "remove" -> store.remove(id)
            }
        }
    }
    @JavascriptInterface fun batch(value: String, data: String): String {
        if (value != token || data.length > 600000) return "{\"error\":\"${tr("Invalid request", "Ungültige Anfrage")}\"}"
        // Submit runs on main because Media3's manager is main-thread owned.
        val done = java.util.concurrent.CountDownLatch(1)
        var response = "{\"error\":\"${tr("App not ready", "App nicht bereit")}\"}"
        activity.runOnUiThread {
            try {
                if (value == token && !activity.isDestroyed) response = JSONObject().put("added", EpisodeBatchQueue.get(activity).submit(JSONObject(data))).toString()
            } catch (_: Exception) { response = "{\"error\":\"${tr("Episodes could not be queued", "Folgen konnten nicht eingeplant werden")}\"}" }
            finally { done.countDown() }
        }
        done.await(20, java.util.concurrent.TimeUnit.SECONDS)
        return response
    }
    @JavascriptInterface fun cacheManga(value: String, data: String): String {
        if (value != token || data.length > 100000) return "{}"
        return try {
            val payload = JSONObject(data)
            val mediaId = payload.getInt("mediaId")
            require(mediaId > 0)
            val id = EpisodeBatchQueue.idFor("manga:$mediaId")
            val library = OfflineLibrary.get(activity)
            library.captureManga(id, payload)
            library.details(id).toString()
        } catch (_: Exception) { "{}" }
    }
    @JavascriptInterface fun download(value: String, data: String) {
        if (value != token || data.length > 100000) return
        activity.runOnUiThread {
            if (value != token || activity.isDestroyed) return@runOnUiThread
            try {
                Toast.makeText(activity, tr("Preparing download …", "Download wird vorbereitet …"), Toast.LENGTH_SHORT).show()
                EpisodeDownloads.get(activity).enqueue(JSONObject(data)) { error ->
                    if (!activity.isDestroyed) Toast.makeText(activity, error ?: "Download gestartet. Fortschritt unter Downloads.", Toast.LENGTH_LONG).show()
                }
            } catch (_: Exception) { Toast.makeText(activity, tr("Invalid download source", "Ungültige Download-Quelle"), Toast.LENGTH_LONG).show() }
        }
    }
}
