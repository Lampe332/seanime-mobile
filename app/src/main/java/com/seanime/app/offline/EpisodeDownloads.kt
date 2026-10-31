package com.seanime.app.offline

import com.seanime.app.AppLanguage
import com.seanime.app.AppLanguage.tr
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
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
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Persistent download index and non-evicting media cache, shared by service and player. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class EpisodeDownloads private constructor(private val context: Context) {
    private val database = StandaloneDatabaseProvider(context)
    val cache = SimpleCache(File(context.filesDir, "offline-video"), NoOpCacheEvictor(), database)
    val http = DefaultHttpDataSource.Factory().setUserAgent("Mozilla/5.0 SeanimeMobile/1.4")
        .setConnectTimeoutMs(20000).setReadTimeoutMs(30000).setAllowCrossProtocolRedirects(true)
    private val failures = context.getSharedPreferences("download-failures", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private var waitingForServer = false
    val manager = DownloadManager(context, database, cache, http, Executors.newFixedThreadPool(3)).apply {
        maxParallelDownloads = 2
        requirements = requirementsFor(wifiOnly(context))
        addListener(object : DownloadManager.Listener {
            override fun onDownloadChanged(manager: DownloadManager, download: Download, finalException: Exception?) {
                val id = download.request.id.substringBefore(":sub:")
                when (download.state) {
                    Download.STATE_FAILED -> {
                        val failure = OfflinePolicy.failure(finalException, isProxy(download))
                        failures.edit().putString(id, failure.name).apply()
                        notifyResult(id, failure)
                    }
                    Download.STATE_COMPLETED -> if (ready(id)) notifyResult(id, null)
                    Download.STATE_DOWNLOADING -> cancelWaitingNotice()
                }
            }
            override fun onDownloadRemoved(manager: DownloadManager, download: Download) {
                notifications().cancel(TAG_RESULT + download.request.id.substringBefore(":sub:"), NOTICE_RESULT)
            }
            override fun onWaitingForRequirementsChanged(manager: DownloadManager, waitingForRequirements: Boolean) = updateWaitingNotice()
            override fun onRequirementsStateChanged(manager: DownloadManager, requirements: Requirements, notMetRequirements: Int) = updateWaitingNotice()
        })
    }
    private val preparing = mutableSetOf<String>()

    fun all(): List<Download> = manager.downloadIndex.getDownloads().use { cursor ->
        buildList { while (cursor.moveToNext()) add(cursor.download) }
    }

    /** Pass [all] when checking many ids: every [all] call reads the whole download index. */
    fun group(id: String, all: List<Download> = all()): List<Download> =
        all.filter { it.request.id == id || it.request.id.startsWith("$id:sub:") }

    fun ready(id: String, all: List<Download> = all()): Boolean {
        val rows = group(id, all)
        val main = rows.find { it.request.id == id } ?: return false
        val expected = metadata(main).optJSONArray("subtitles")?.length() ?: 0
        return rows.size == expected + 1 && rows.all { it.state == Download.STATE_COMPLETED }
    }

    fun metadata(download: Download): JSONObject = try { OfflineLibrary.get(context).merge(download.request.id, JSONObject(String(download.request.data, Charsets.UTF_8))) }
        catch (_: Exception) { JSONObject() }

    fun enqueue(payload: JSONObject, result: (String?) -> Unit) {
        val url = payload.optString("url")
        if (!validUri(url)) { result(tr("This source cannot be downloaded.", "Diese Quelle kann nicht heruntergeladen werden.")); return }
        val id = EpisodeBatchQueue.idFor(payload.getString("key"))
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
            // subtitles inside the stream: the ones in the app's language
            .setPreferredTextLanguage(AppLanguage.locale.language).build()
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
        val rows = group(id)
        rows.forEach { DownloadService.sendSetStopReason(context, EpisodeDownloadService::class.java,
            it.request.id, if (paused) 1 else Download.STOP_REASON_NONE, false) }
        if (!paused) {
            rows.filter { it.state == Download.STATE_FAILED }.forEach {
                DownloadService.sendAddDownload(context, EpisodeDownloadService::class.java, it.request, false)
            }
            // while the local server boots, [ensureServer] resumes all downloads
            if (!waitingForServer) DownloadService.sendResumeDownloads(context, EpisodeDownloadService::class.java, false)
        }
    }

    /** Continues a failed or paused episode; downloads through the local server start it first. */
    fun retry(id: String) {
        failures.edit().remove(id).apply()
        notifications().cancel(TAG_RESULT + id, NOTICE_RESULT)
        ensureServer(includeFailed = true)
        pause(id, false)
    }

    /** Why the episode's last attempt failed, if it did. */
    fun failure(id: String): OfflinePolicy.Failure? =
        failures.getString(id, null)?.let { name -> OfflinePolicy.Failure.entries.firstOrNull { it.name == name } }

    /**
     * Downloads through the local server's proxy (sources that need headers) fail while it is not running, e.g. after a
     * reboot or "Exit": start it and hold all downloads until it answers. Main thread.
     */
    fun ensureServer(includeFailed: Boolean) {
        // the download service resumes everything when it starts; keep holding until the server answers
        if (waitingForServer) { manager.pauseDownloads(); return }
        val states = if (includeFailed) PENDING_STATES + Download.STATE_FAILED else PENDING_STATES
        if (all().none { it.state in states && isProxy(it) }) return
        waitingForServer = true
        manager.pauseDownloads()
        try {
            val intent = Intent(context, com.seanime.app.SeanimeService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        } catch (_: IllegalStateException) {
            // Android does not allow it from the background; the downloads fail and can be retried from the app.
        }
        Thread {
            val deadline = System.currentTimeMillis() + 60_000
            while (!serverAnswers() && System.currentTimeMillis() < deadline) Thread.sleep(1000)
            main.post { waitingForServer = false; manager.resumeDownloads() }
        }.start()
    }

    private fun serverAnswers(): Boolean = try {
        val connection = URL("http://127.0.0.1:43211/api/v1/status").openConnection() as HttpURLConnection
        connection.connectTimeout = 2000; connection.readTimeout = 5000
        try { connection.responseCode in 200..299 } finally { connection.disconnect() }
    } catch (_: IOException) { false }

    private fun isProxy(download: Download) = download.request.uri.host == "127.0.0.1" && download.request.uri.port == 43211

    private fun notifications() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    /** Finished ([failure] null) or failed episode; tapping opens the downloads. */
    private fun notifyResult(id: String, failure: OfflinePolicy.Failure?) {
        AppLanguage.init(context)
        val download = all().find { it.request.id == id } ?: return
        val metadata = metadata(download)
        val episode = metadata.optString("episode").takeIf { it.isNotBlank() }
        val name = listOfNotNull(metadata.optString("title").takeIf { it.isNotBlank() } ?: tr("Anime episode", "Anime-Folge"),
            episode?.let { tr("Episode $it", "Folge $it") }).joinToString(" · ")
        if (failure == null) notify(TAG_RESULT + id, NOTICE_RESULT, tr("Download finished", "Download fertig"), name, true)
        else notify(TAG_RESULT + id, NOTICE_RESULT, tr("Download failed", "Download fehlgeschlagen"), name + "\n" + OfflinePolicy.failureText(failure), false)
    }

    /** Downloads waiting for Wi-Fi stop the download service, and its notice with it; this one stays until they run. */
    private fun updateWaitingNotice() {
        if (manager.isWaitingForRequirements && (manager.notMetRequirements and Requirements.NETWORK_UNMETERED) != 0) {
            AppLanguage.init(context)
            notify(TAG_WAITING, NOTICE_WAITING, tr("Waiting for Wi-Fi", "Wartet auf WLAN"),
                tr("Episode downloads continue on Wi-Fi.", "Die Folgen werden im WLAN weiter heruntergeladen."), false)
        } else cancelWaitingNotice()
    }

    private fun cancelWaitingNotice() = notifications().cancel(TAG_WAITING, NOTICE_WAITING)

    private fun notify(tag: String, id: Int, title: String, text: String, done: Boolean) {
        val notifications = notifications()
        if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(channel())
        val open = PendingIntent.getActivity(context, id, Intent(context, OfflineActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
        notifications.notify(tag, id, builder
            .setSmallIcon(if (done) android.R.drawable.stat_sys_download_done else android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .build())
    }

    fun remove(id: String) {
        failures.edit().remove(id).apply()
        notifications().cancel(TAG_RESULT + id, NOTICE_RESULT)
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
                .setLanguage(OfflinePolicy.subtitleLanguage(sub.optString("language")))
                .setLabel(sub.optString("label", sub.optString("language")))
                .setSelectionFlags(if (sub.optBoolean("default")) C.SELECTION_FLAG_DEFAULT else 0).build()
        }).build()
    }

    companion object {
        const val CHANNEL = "episode-downloads"
        private const val TAG_RESULT = "episode-download:"
        private const val TAG_WAITING = "episode-downloads-waiting"
        private const val NOTICE_RESULT = 7003
        private const val NOTICE_WAITING = 7004
        private val PENDING_STATES = listOf(Download.STATE_QUEUED, Download.STATE_DOWNLOADING, Download.STATE_RESTARTING)
        private const val PREFS = "episode-downloads"

        /** The download notices' channel, named in the app's language. */
        @androidx.annotation.RequiresApi(26)
        fun channel() = NotificationChannel(CHANNEL, tr("Episode downloads", "Folgen-Downloads"), NotificationManager.IMPORTANCE_LOW)

        /** Off by default: downloads use any connection, as before the setting existed. */
        fun wifiOnly(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("wifiOnly", false)

        /** Main thread. Running downloads stop at once on mobile data and continue on Wi-Fi. */
        fun setWifiOnly(context: Context, enabled: Boolean) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("wifiOnly", enabled).apply()
            get(context).manager.requirements = requirementsFor(enabled)
        }

        fun metered(context: Context) = (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered

        /** Whether downloads may use the current connection (the queue resolves sources only then). */
        fun networkAllowed(context: Context): Boolean {
            val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            @Suppress("DEPRECATION")
            val online = connectivity.activeNetworkInfo?.isConnected == true
            return online && (!wifiOnly(context) || !connectivity.isActiveNetworkMetered)
        }

        private fun requirementsFor(wifiOnly: Boolean) = Requirements(if (wifiOnly) Requirements.NETWORK_UNMETERED else Requirements.NETWORK)

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
