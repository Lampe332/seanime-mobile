package com.seanime.app

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/** The existing web update modal uses this bridge; no desktop version or DOM-button patching is involved. */
object AppUpdater {
    private const val PERMISSION_REQUEST_CODE = 1001
    private lateinit var activity: Activity
    private lateinit var webView: WebView
    private val handler = Handler(Looper.getMainLooper())
    private val downloading = AtomicBoolean(false)
    private var pendingRequest: String? = null

    fun init(activity: Activity, webView: WebView) {
        this.activity = activity
        this.webView = webView
        webView.addJavascriptInterface(Bridge, "AppUpdater")
    }

    @Suppress("UNUSED_PARAMETER")
    fun inject(webView: WebView) = Unit

    private fun emit(event: String, requestId: String, data: JSONObject) {
        data.put("requestId", requestId)
        handler.post {
            if (!activity.isFinishing && !activity.isDestroyed) {
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('$event',{detail:$data}));", null)
            }
        }
    }

    private fun currentVersion(): String = activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "0.0.0"

    private fun connection(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000
        readTimeout = 30_000
        setRequestProperty("Accept", "application/vnd.github+json")
        setRequestProperty("User-Agent", "Seanime-Mobile-Updater")
    }

    private fun fetchUpdate(): AppReleasePolicy.Update? {
        val conn = connection(AppReleasePolicy.RELEASES_URL)
        val releases = try {
            check(conn.responseCode in 200..299) { "GitHub HTTP ${conn.responseCode}" }
            JSONArray(conn.inputStream.bufferedReader().use { it.readText() })
        } finally { conn.disconnect() }
        return AppReleasePolicy.select(currentVersion(), (0 until releases.length()).map { index ->
            val release = releases.getJSONObject(index)
            val assets = release.optJSONArray("assets") ?: JSONArray()
            AppReleasePolicy.Release(
                release.optString("tag_name"), release.optString("body"),
                (0 until assets.length()).map { i -> assets.getJSONObject(i).let { AppReleasePolicy.Asset(it.optString("name"), it.optString("browser_download_url")) } },
                release.optBoolean("draft", true), release.optBoolean("prerelease", true),
            )
        })
    }

    object Bridge {
        @JavascriptInterface
        fun checkForUpdates(requestId: String) {
            thread(name = "app-update-check") {
                try {
                    val update = fetchUpdate()
                    val data = JSONObject().put("type", "app").put("current_version", currentVersion())
                    if (update != null) {
                        data.put("release", JSONObject()
                            .put("version", update.version).put("tag_name", update.release.tag)
                            .put("name", "Seanime Mobile ${update.version}").put("body", update.release.body)
                            .put("html_url", "https://github.com/${AppReleasePolicy.REPOSITORY}/releases/tag/${update.release.tag}")
                            .put("released", true))
                    }
                    emit("seanime-app-update", requestId, JSONObject().put("update", data))
                } catch (e: Exception) {
                    emit("seanime-app-update", requestId, JSONObject().put("error", e.message ?: "Update check failed"))
                }
            }
        }

        @JavascriptInterface
        fun downloadUpdate(requestId: String) {
            handler.post {
                if (Build.VERSION.SDK_INT in 23..28 && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    if (pendingRequest != null) {
                        emit("seanime-app-download", requestId, JSONObject().put("error", "A download is already pending"))
                        return@post
                    }
                    pendingRequest = requestId
                    activity.requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), PERMISSION_REQUEST_CODE)
                } else download(requestId)
            }
        }
    }

    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray) {
        if (requestCode != PERMISSION_REQUEST_CODE) return
        val requestId = pendingRequest ?: return
        pendingRequest = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) download(requestId)
        else emit("seanime-app-download", requestId, JSONObject().put("error", AppLanguage.tr("Storage permission denied", "Speicherzugriff verweigert")))
    }

    private fun download(requestId: String) {
        if (!downloading.compareAndSet(false, true)) {
            emit("seanime-app-download", requestId, JSONObject().put("error", "A download is already running"))
            return
        }
        thread(name = "app-update-download") {
            try {
                val update = fetchUpdate() ?: error(AppLanguage.tr("No newer app APK is available", "Keine neuere App-APK verfügbar"))
                val conn = connection(update.asset.url)
                try {
                    conn.setRequestProperty("Accept", "application/octet-stream")
                    check(conn.responseCode in 200..299) { "Download HTTP ${conn.responseCode}" }
                    conn.inputStream.use { input ->
                        if (Build.VERSION.SDK_INT >= 29) {
                            val resolver = activity.contentResolver
                            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, ContentValues().apply {
                                put(MediaStore.MediaColumns.DISPLAY_NAME, update.asset.name)
                                put(MediaStore.MediaColumns.MIME_TYPE, "application/vnd.android.package-archive")
                                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                                put(MediaStore.MediaColumns.IS_PENDING, 1)
                            }) ?: error("Cannot create download")
                            try {
                                (resolver.openOutputStream(uri) ?: error("Cannot open download")).use { input.copyTo(it) }
                                resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                            } catch (e: Exception) { resolver.delete(uri, null, null); throw e }
                        } else {
                            val file = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), update.asset.name)
                            file.parentFile?.mkdirs()
                            try { file.outputStream().use { input.copyTo(it) } }
                            catch (e: Exception) { file.delete(); throw e }
                        }
                    }
                } finally { conn.disconnect() }
                emit("seanime-app-download", requestId, JSONObject().put("fileName", update.asset.name))
            } catch (e: Exception) {
                emit("seanime-app-download", requestId, JSONObject().put("error", e.message ?: "Download failed"))
            } finally { downloading.set(false) }
        }
    }
}
