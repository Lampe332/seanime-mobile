package com.seanime.app.offline

import com.seanime.app.AppLanguage.tr
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.exoplayer.offline.Download
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Persistent, sequential source resolution. Resolve only when a download slot is free. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class EpisodeBatchQueue private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences("episode-batch-queue", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val running = AtomicBoolean(false)
    init { synchronized(this) {
        prefs.all.forEach { (id, value) ->
            val job = try { JSONObject(value.toString()) } catch (_: Exception) { null }
            if (job?.optString("status") == "resolving") save(id, job.put("status", "queued"))
        }
    } }
    @Synchronized private fun save(id: String, value: JSONObject) { prefs.edit().putString(id, value.toString()).commit() }
    @Synchronized private fun get(id: String): JSONObject? = prefs.getString(id, null)?.let { JSONObject(it) }
    @Synchronized private fun remove(id: String) { prefs.edit().remove(id).commit() }
    fun snapshot(): List<JSONObject> = prefs.all.values.mapNotNull {
        try { JSONObject(it.toString()) } catch (_: Exception) { null }
    }.sortedBy { it.optLong("order") }
    fun submit(payload: JSONObject): Int {
        val mediaId = payload.optInt("mediaId")
        val provider = payload.optString("provider")
        val episodes = payload.optJSONArray("episodes") ?: error(tr("No episodes selected", "Keine Folgen ausgewählt"))
        require(mediaId > 0 && provider.isNotBlank() && episodes.length() in 1..2000)
        val store = EpisodeDownloads.get(context)
        val existing = store.all().associateBy { it.request.id }
        var added = 0
        for (index in 0 until episodes.length()) {
            val item = episodes.optJSONObject(index) ?: continue
            val number = item.optDouble("number", -1.0)
            if (number < 0 || number.isInfinite() || number.isNaN()) continue
            val episode = if (number % 1 == 0.0) number.toLong().toString() else number.toString()
            val quality = payload.optString("quality", "Auto").ifBlank { "Auto" }
            val key = "$mediaId:$episode:$provider:${payload.optBoolean("dubbed")}:$quality"
            val id = idFor(key)
            val audio = if (payload.optBoolean("dubbed")) "de" else "ja"
            if (existing.values.any { download ->
                val metadata = store.metadata(download)
                download.state != Download.STATE_FAILED && metadata.optInt("mediaId") == mediaId &&
                    metadata.optString("episode") == episode && metadata.optString("audioLanguage", audio) == audio
            }) continue
            synchronized(this) {
                if (get(id) != null) return@synchronized
                val job = JSONObject(payload.toString()).apply {
                    remove("episodes"); put("id", id); put("key", key); put("episode", episode)
                    put("episodeTitle", item.optString("title")); put("episodeImageUrl", item.optString("image"))
                    put("episodeDescription", item.optString("description")); put("status", "queued")
                    put("progress", 0); put("position", 0); put("bytes", 0); put("ready", false)
                    put("order", System.currentTimeMillis() + index)
                }
                save(id, job); added++
            }
        }
        start()
        return added
    }
    @Synchronized fun action(id: String, action: String): Boolean {
        val job = get(id) ?: return false
        when (action) {
            "remove" -> remove(id)
            "pause" -> save(id, job.put("status", "paused"))
            "resume" -> { save(id, job.put("status", "queued").put("error", "")); start() }
        }
        return true
    }
    fun start() {
        if (!running.compareAndSet(false, true)) return
        worker.execute {
            try {
                while (true) {
                    val job = snapshot().firstOrNull { it.optString("status") == "queued" } ?: break
                    // also waits for Wi-Fi when downloads are limited to it: resolved source links expire
                    val online = EpisodeDownloads.networkAllowed(context)
                    val store = EpisodeDownloads.get(context)
                    val active = store.all().count { !it.request.id.contains(":sub:") && it.state in listOf(Download.STATE_QUEUED, Download.STATE_DOWNLOADING) }
                    if (!online || active >= 2) { Thread.sleep(1500); continue }
                    val id = job.getString("id")
                    synchronized(this) {
                        val latest = get(id)
                        if (latest?.optString("status") == "queued") save(id, latest.put("status", "resolving"))
                    }
                    if (get(id)?.optString("status") != "resolving") continue
                    try {
                        val resolved = resolve(job)
                        if (get(id)?.optString("status") != "resolving") continue
                        val done = CountDownLatch(1)
                        var failure: String? = null
                        main.post {
                            if (get(id)?.optString("status") != "resolving") { done.countDown(); return@post }
                            store.enqueue(resolved) { failure = it; done.countDown() }
                        }
                        check(done.await(90, TimeUnit.SECONDS)) { tr("Source could not be prepared", "Quelle konnte nicht vorbereitet werden") }
                        if (failure != null) error(failure!!)
                        // Keep the virtual row until Media3 has persisted the real request.
                        val deadline = System.currentTimeMillis() + 10000
                        while (store.all().none { it.request.id == id } && System.currentTimeMillis() < deadline) Thread.sleep(100)
                        check(store.all().any { it.request.id == id }) { tr("Download was not accepted", "Download wurde nicht übernommen") }
                        main.post {
                            val latest = get(id)
                            if (latest == null) store.remove(id)
                            else if (latest.optString("status") == "paused") store.pause(id, true)
                            remove(id)
                        }
                    } catch (_: Exception) {
                        synchronized(this) {
                            get(id)?.takeIf { it.optString("status") == "resolving" }?.let {
                                save(id, it.put("status", "failed").put("error", tr("Source unavailable. Try again or pick another provider.", "Quelle nicht verfügbar. Erneut versuchen oder einen anderen Anbieter wählen.")))
                            }
                        }
                    }
                }
            } finally {
                running.set(false)
                if (snapshot().any { it.optString("status") == "queued" }) start()
            }
        }
    }
    internal fun resolve(job: JSONObject): JSONObject {
        val response = requestSource(job)
        val sources = response.optJSONArray("videoSources") ?: JSONArray()
        val candidates = (0 until sources.length()).mapNotNull { sources.optJSONObject(it) }
            .filter { EpisodeDownloads.validUri(it.optString("url")) }
        val quality = job.optString("quality", "Auto")
        val preferredServer = job.optString("server")
        val source = candidates.sortedByDescending {
            (if (it.optString("server").equals(preferredServer, true)) 100 else 0) +
                (if (it.optString("quality").equals(quality, true)) 20 else 0) +
                (if (it.optString("quality").equals("auto", true)) 10 else 0)
        }.firstOrNull() ?: error(tr("No downloadable source", "Keine herunterladbare Quelle"))
        val headers = source.optJSONObject("headers")
        fun url(raw: String): String = if (headers != null && headers.length() > 0)
            "http://127.0.0.1:43211/api/v1/proxy?url=${Uri.encode(raw)}&headers=${Uri.encode(headers.toString())}" else raw
        val subtitles = source.optJSONArray("subtitles") ?: JSONArray()
        val subs = JSONArray()
        for (i in 0 until subtitles.length()) {
            val sub = subtitles.optJSONObject(i) ?: continue
            val raw = sub.optString("url")
            if (!EpisodeDownloads.validUri(raw)) continue
            val ext = Uri.parse(raw).path.orEmpty().lowercase()
            subs.put(JSONObject().put("url", url(raw)).put("language", sub.optString("language"))
                .put("label", sub.optString("language").ifBlank { tr("Subtitles", "Untertitel") }).put("default", sub.optBoolean("isDefault"))
                .put("mime", when { ext.endsWith(".ass") || ext.endsWith(".ssa") -> "text/x-ssa"; ext.endsWith(".srt") -> "application/x-subrip"; else -> "text/vtt" }))
        }
        return JSONObject(job.toString()).put("url", url(source.getString("url")))
            .put("type", if (source.optString("type") == "m3u8" || source.optString("url").contains(".m3u8")) "m3u8" else "mp4")
            .put("subtitles", subs).put("audioLanguage", if (job.optBoolean("dubbed")) "de" else "ja")
    }
    private fun requestSource(job: JSONObject): JSONObject {
        val connection = URL("http://127.0.0.1:43211/api/v1/onlinestream/episode-source").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"; connection.doOutput = true
        connection.connectTimeout = 10000; connection.readTimeout = 120000
        connection.setRequestProperty("Content-Type", "application/json")
        try {
            val data = JSONObject().put("mediaId", job.getInt("mediaId")).put("provider", job.getString("provider"))
                .put("episodeNumber", job.getString("episode").toDouble()).put("dubbed", job.optBoolean("dubbed"))
            connection.outputStream.use { it.write(data.toString().toByteArray(Charsets.UTF_8)) }
            check(connection.responseCode in 200..299)
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).getJSONObject("data")
        } finally { connection.disconnect() }
    }
    companion object {
        fun sha256(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
        /** Download id of a job key; [EpisodeDownloads.enqueue] derives the same id, which links a job to its download. */
        fun idFor(key: String) = sha256(key).take(32)
        @Volatile private var instance: EpisodeBatchQueue? = null
        fun get(context: Context): EpisodeBatchQueue = instance ?: synchronized(this) {
            instance ?: EpisodeBatchQueue(context.applicationContext).also { instance = it }
        }
    }
}
