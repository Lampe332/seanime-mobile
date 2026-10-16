package com.seanime.app.offline

import com.seanime.app.AppLanguage.tr
import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadHelper
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Requirements
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.Executors

/** Persistent download index and non-evicting media cache, shared by service and player. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class EpisodeDownloads private constructor(private val context: Context) {
    private val database = StandaloneDatabaseProvider(context)
    val cache = SimpleCache(File(context.filesDir, "offline-video"), NoOpCacheEvictor(), database)
    val http = DefaultHttpDataSource.Factory().setUserAgent("Mozilla/5.0 SeanimeMobile/1.4")
        .setConnectTimeoutMs(20000).setReadTimeoutMs(30000).setAllowCrossProtocolRedirects(true)
    val manager = DownloadManager(context, database, cache, http, Executors.newFixedThreadPool(3)).apply {
        maxParallelDownloads = 2
        requirements = Requirements(Requirements.NETWORK)
    }
    private val preparing = mutableSetOf<String>()

    fun all(): List<Download> = manager.downloadIndex.getDownloads().use { cursor ->
        buildList { while (cursor.moveToNext()) add(cursor.download) }
    }

    fun group(id: String): List<Download> = all().filter { it.request.id == id || it.request.id.startsWith("$id:sub:") }

    fun ready(id: String): Boolean {
        val rows = group(id)
        val main = rows.find { it.request.id == id } ?: return false
        val expected = metadata(main).optJSONArray("subtitles")?.length() ?: 0
        return rows.size == expected + 1 && rows.all { it.state == Download.STATE_COMPLETED }
    }

    fun metadata(download: Download): JSONObject = try { OfflineLibrary.get(context).merge(download.request.id, JSONObject(String(download.request.data, Charsets.UTF_8))) }
        catch (_: Exception) { JSONObject() }

    fun enqueue(payload: JSONObject, result: (String?) -> Unit) {
        val url = payload.optString("url")
        if (!validUri(url)) { result(tr("This source cannot be downloaded.", "Diese Quelle kann nicht heruntergeladen werden.")); return }
        val id = MessageDigest.getInstance("SHA-256").digest(payload.getString("key").toByteArray())
            .joinToString("") { "%02x".format(it) }.take(32)
        if (preparing.contains(id) || ready(id)) { result(tr("This episode is already saved or being prepared.", "Diese Folge ist bereits gespeichert oder wird vorbereitet.")); return }
        if (context.filesDir.usableSpace < 256L * 1024 * 1024) {
            result(tr("Less than 256 MB free. Please free up storage first.", "Weniger als 256 MB frei. Bitte zuerst Speicher freigeben.")); return
        }
        preparing.add(id)
        val mime = if (payload.optString("type") == "m3u8") MimeTypes.APPLICATION_M3U8 else MimeTypes.VIDEO_MP4
        val item = MediaItem.Builder().setUri(url).setMimeType(mime).build()
        val height = Regex("(\\d{3,4})p", RegexOption.IGNORE_CASE).find(payload.optString("quality"))
            ?.groupValues?.get(1)?.toIntOrNull() ?: 1080
        val parameters = DownloadHelper.DEFAULT_TRACK_SELECTOR_PARAMETERS.buildUpon()
            .setMaxVideoSize(1920, height).setPreferredAudioLanguage(payload.optString("audioLanguage", "ja"))
            .setPreferredTextLanguage("de").build()
        val helper = DownloadHelper.Factory().setRenderersFactory(DefaultRenderersFactory(context))
            .setDataSourceFactory(http).setTrackSelectionParameters(parameters).create(item)
        helper.prepare(object : DownloadHelper.Callback {
            override fun onPrepared(helper: DownloadHelper, tracksInfoAvailable: Boolean) {
                try {
                    // A single unusable subtitle must not abort the whole episode, and only the
                    // subtitles that really get a request may remain in the stored metadata,
                    // otherwise `ready()` would wait forever for downloads that never exist.
                    val subtitles = payload.optJSONArray("subtitles") ?: JSONArray()
                    val accepted = JSONArray()
                    val requests = mutableListOf<DownloadRequest>()
                    for (n in 0 until subtitles.length()) {
                        if (accepted.length() >= 20) break
                        val sub = subtitles.optJSONObject(n) ?: continue
                        val subUrl = sub.optString("url")
                        if (!validUri(subUrl)) continue
                        requests += DownloadRequest.Builder("$id:sub:${accepted.length()}", Uri.parse(subUrl))
                            .setMimeType(sub.optString("mime", MimeTypes.TEXT_VTT)).build()
                        accepted.put(sub)
                    }
                    payload.put("subtitles", accepted)
                    val request = helper.getDownloadRequest(id, payload.toString().toByteArray(Charsets.UTF_8))
                    DownloadService.sendAddDownload(context, EpisodeDownloadService::class.java, request, false)
                    requests.forEach { DownloadService.sendAddDownload(context, EpisodeDownloadService::class.java, it, false) }
                    OfflineLibrary.get(context).capture(id, payload)
                    DownloadService.sendResumeDownloads(context, EpisodeDownloadService::class.java, false)
                    result(null)
                } catch (_: Exception) { result(tr("Download could not start. Please reload the source.", "Download konnte nicht gestartet werden. Quelle bitte erneut laden.")) }
                finally { helper.release(); preparing.remove(id) }
            }
            override fun onPrepareError(helper: DownloadHelper, e: IOException) {
                helper.release(); preparing.remove(id)
                result(tr("Source not downloadable or expired. Please pick another server.", "Quelle nicht herunterladbar oder abgelaufen. Bitte einen anderen Server wählen."))
            }
        })
    }

    fun pause(id: String, paused: Boolean) {
        group(id).forEach { DownloadService.sendSetStopReason(context, EpisodeDownloadService::class.java,
            it.request.id, if (paused) 1 else Download.STOP_REASON_NONE, false) }
        if (!paused) {
            group(id).filter { it.state == Download.STATE_FAILED }.forEach {
                DownloadService.sendAddDownload(context, EpisodeDownloadService::class.java, it.request, false)
            }
            DownloadService.sendResumeDownloads(context, EpisodeDownloadService::class.java, false)
        }
    }

    fun remove(id: String) {
        OfflineLibrary.get(context).remove(id)
        group(id).forEach { DownloadService.sendRemoveDownload(context, EpisodeDownloadService::class.java, it.request.id, false) }
        context.getSharedPreferences("offline-playback", Context.MODE_PRIVATE).edit().remove(id).apply()
    }

    /** No upstream: a missing cache range must fail rather than silently use mobile data. */
    fun offlineDataSource() = CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(null)
        .setCacheWriteDataSinkFactory(null)

    fun mediaItem(download: Download): MediaItem {
        val subs = metadata(download).optJSONArray("subtitles") ?: JSONArray()
        return download.request.toMediaItem().buildUpon().setSubtitleConfigurations((0 until subs.length()).map { n ->
            val sub = subs.getJSONObject(n)
            MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub.getString("url")))
                .setMimeType(sub.optString("mime", MimeTypes.TEXT_VTT))
                .setLanguage(sub.optString("language", "de"))
                .setLabel(sub.optString("label", sub.optString("language")))
                .setSelectionFlags(if (sub.optBoolean("default")) C.SELECTION_FLAG_DEFAULT else 0).build()
        }).build()
    }

    companion object {
        @Volatile private var instance: EpisodeDownloads? = null
        fun get(context: Context): EpisodeDownloads = instance ?: synchronized(this) {
            instance ?: EpisodeDownloads(context.applicationContext).also { instance = it }
        }
        fun validUri(url: String): Boolean = try {
            val uri = Uri.parse(url)
            uri.scheme in setOf("http", "https") && !uri.host.isNullOrBlank()
        } catch (_: Exception) { false }
    }
}
