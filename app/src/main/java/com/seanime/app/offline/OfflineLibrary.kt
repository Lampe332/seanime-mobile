package com.seanime.app.offline

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.webkit.WebResourceResponse
import androidx.media3.exoplayer.offline.Download
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Durable descriptions and locally served artwork, independent of WebView's HTTP cache. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class OfflineLibrary private constructor(private val context: Context) {
    private val preferences = context.getSharedPreferences("offline-library-v1", Context.MODE_PRIVATE)
    private val directory = File(context.filesDir, "offline-artwork").apply { mkdirs() }
    private val worker = Executors.newSingleThreadExecutor()
    private val attempts = ConcurrentHashMap<String, Long>()
    private val removed = java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    private val fields = listOf("description", "genres", "year", "format", "totalEpisodes", "duration", "score",
        "coverUrl", "bannerUrl", "episodeImageUrl", "episodeTitle", "episodeDescription", "airDate")

    fun details(id: String): JSONObject = try { JSONObject(preferences.getString(id, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
    fun captureManga(id: String, payload: JSONObject) {
        if (details(id).optString("coverAsset").isNotBlank() || System.currentTimeMillis() - (attempts[id] ?: 0) < 60000) return
        // Manga metadata comes from the existing manga backend, never the anime endpoint.
        val copy = JSONObject(payload.toString()).put("mediaId", 0).put("metadataSaved", true)
        capture(id, copy)
    }
    fun merge(id: String, original: JSONObject): JSONObject = original.apply {
        val extra = details(id)
        (fields + listOf("coverAsset", "bannerAsset", "episodeImageAsset", "metadataSaved")).forEach { key ->
            if (extra.has(key)) put(key, extra.get(key))
        }
    }
    fun ensure(downloads: List<Download>) {
        downloads.filter { !it.request.id.contains(":sub:") && it.state != Download.STATE_REMOVING && !removed.contains(it.request.id) }.forEach { download ->
            val id = download.request.id
            val meta = try { JSONObject(String(download.request.data, Charsets.UTF_8)) } catch (_: Exception) { JSONObject() }
            val stored = details(id)
            val complete = stored.optBoolean("metadataSaved") && listOf("cover", "banner", "episodeImage").all {
                stored.optString("${it}Url").isBlank() || artworkFile(stored.optString("${it}Asset")) != null
            }
            if (!complete && System.currentTimeMillis() - (attempts[id] ?: 0) > 60000) capture(id, meta)
        }
    }
    fun capture(id: String, payload: JSONObject) {
        attempts[id] = System.currentTimeMillis(); removed.remove(id)
        val copy = JSONObject(payload.toString())
        worker.execute {
            val result = details(id)
            fields.forEach { key -> if (copy.has(key) && !copy.isNull(key)) result.put(key, copy.get(key)) }
            val mediaId = copy.optInt("mediaId")
            if (mediaId > 0 && !result.optBoolean("metadataSaved")) {
                try {
                    val entry = json("http://127.0.0.1:43211/api/v1/library/anime-entry/$mediaId").optJSONObject("data")
                    entry?.optJSONObject("media")?.let { media ->
                        result.put("description", media.optString("description"))
                        result.put("genres", media.optJSONArray("genres") ?: JSONArray())
                        result.put("year", media.optInt("seasonYear")); result.put("format", media.optString("format"))
                        result.put("totalEpisodes", media.optInt("episodes")); result.put("duration", media.optInt("duration"))
                        result.put("score", media.optInt("meanScore"))
                        result.put("coverUrl", media.optJSONObject("coverImage")?.let { it.optString("extraLarge", it.optString("large")) } ?: "")
                        result.put("bannerUrl", media.optString("bannerImage"))
                    }
                    val episodes = json("http://127.0.0.1:43211/api/v1/anime/episode-collection/$mediaId")
                        .optJSONObject("data")?.optJSONArray("episodes") ?: JSONArray()
                    for (n in 0 until episodes.length()) {
                        val episode = episodes.optJSONObject(n) ?: continue
                        if (episode.optString("episodeNumber") != copy.optString("episode")) continue
                        val info = episode.optJSONObject("episodeMetadata") ?: JSONObject()
                        result.put("episodeTitle", episode.optString("episodeTitle"))
                        result.put("episodeImageUrl", info.optString("image"))
                        result.put("episodeDescription", info.optString("summary", info.optString("overview")))
                        result.put("airDate", info.optString("airDate"))
                    }
                    if (entry?.optJSONObject("media") != null) result.put("metadataSaved", true)
                } catch (_: Exception) { /* Text supplied with the download remains available offline. */ }
            }
            if (copy.optString("description").isNotBlank() && copy.optString("coverUrl").isNotBlank()) result.put("metadataSaved", true)
            listOf("cover", "banner", "episodeImage").forEach { kind ->
                val source = result.optString("${kind}Url")
                if (source.isNotBlank() && artworkFile(result.optString("${kind}Asset")) == null) {
                    try { result.put("${kind}Asset", saveArtwork(source)) } catch (_: Exception) { }
                }
            }
            if (!removed.contains(id)) preferences.edit().putString(id, result.toString()).apply()
        }
    }
    fun remove(id: String) {
        removed.add(id); attempts.remove(id)
        preferences.edit().remove(id).apply()
        worker.execute {
            val used = preferences.all.values.filterIsInstance<String>().flatMap { value ->
                try { val obj = JSONObject(value); listOf("coverAsset", "bannerAsset", "episodeImageAsset").map { obj.optString(it) } }
                catch (_: Exception) { emptyList() }
            }.toSet()
            directory.listFiles()?.filter { it.name !in used }?.forEach { it.delete() }
        }
    }
    fun artworkFile(name: String): File? = if (Regex("[a-f0-9]{64}\\.jpg").matches(name))
        File(directory, name).takeIf { it.isFile } else null
    fun intercept(uri: Uri): WebResourceResponse? {
        if (uri.scheme != "http" || uri.host != "127.0.0.1" || uri.port != 43211 || !uri.path.orEmpty().startsWith("/__android_offline/")) return null
        val file = artworkFile(uri.lastPathSegment.orEmpty())
        return if (file != null) WebResourceResponse("image/jpeg", null, file.inputStream())
        else WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), java.io.ByteArrayInputStream(byteArrayOf()))
    }
    private fun bytes(source: String, limit: Int): ByteArray {
        val address = if (source.startsWith('/')) "http://127.0.0.1:43211$source" else source
        require(EpisodeDownloads.validUri(address))
        val connection = URL(address).openConnection() as HttpURLConnection
        connection.connectTimeout = 8000; connection.readTimeout = 10000
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 SeanimeMobile")
        try {
            require(connection.responseCode in 200..299)
            return connection.inputStream.use { stream ->
                val buffer = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                while (true) { val count = stream.read(chunk); if (count < 0) break
                    require(buffer.size() + count <= limit); buffer.write(chunk, 0, count) }
                buffer.toByteArray()
            }
        } finally { connection.disconnect() }
    }
    private fun json(url: String) = JSONObject(String(bytes(url, 4 * 1024 * 1024), Charsets.UTF_8))
    private fun saveArtwork(url: String): String {
        val name = EpisodeBatchQueue.sha256(url) + ".jpg"
        artworkFile(name)?.let { return name }
        val raw = bytes(url, 8 * 1024 * 1024)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
        val bitmap = BitmapFactory.decodeByteArray(raw, 0, raw.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: error("Invalid image")
        try {
            val pending = File(directory, "$name.tmp")
            pending.outputStream().use { require(bitmap.compress(Bitmap.CompressFormat.JPEG, 88, it)) }
            check(pending.renameTo(File(directory, name)))
        } finally { bitmap.recycle() }
        return name
    }
    companion object {
        @Volatile private var instance: OfflineLibrary? = null
        fun get(context: Context): OfflineLibrary = instance ?: synchronized(this) {
            instance ?: OfflineLibrary(context.applicationContext).also { instance = it }
        }
    }
}
