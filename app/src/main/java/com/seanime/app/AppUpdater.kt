package com.seanime.app

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
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
    // In-process device instrumentation only. No bridge, preferences, intent or build-config override.
    internal var instrumentationOffer: (() -> AppReleasePolicy.Update?)? = null

    fun init(activity: Activity, webView: WebView) {
        this.activity = activity
        this.webView = webView
        webView.addJavascriptInterface(Bridge, "AppUpdater")
        UpdateInstaller.init(activity)
        monitor()
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
        instrumentationOffer?.let { return it() }
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
                (0 until assets.length()).map { i -> assets.getJSONObject(i).let { AppReleasePolicy.Asset(it.optString("name"), it.optString("browser_download_url"), it.optLong("size"), it.optString("digest", "")) } },
                release.optBoolean("draft", true), release.optBoolean("prerelease", true),
            )
        })
    }

    object Bridge {
        @JavascriptInterface
        fun getKnownUpdate(): String {
            val saved = prefs.getString("known_update", null) ?: return "null"
            return try {
                val data = JSONObject(saved)
                if (data.optString("current_version") == currentVersion() &&
                    AppReleasePolicy.compare(data.optJSONObject("release")?.optString("version") ?: "", currentVersion()) > 0) saved else "null"
            } catch (_: Exception) { "null" }
        }

        @JavascriptInterface
        fun getDownloadState(): String = publicState.toString()

        @JavascriptInterface
        fun openDownloadedApk() = UpdateInstaller.requestRetry()

        @JavascriptInterface
        fun acknowledgeInstalledUpdate() = UpdateInstaller.acknowledge()

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
                    if (instrumentationOffer == null) prefs.edit().putString("known_update", data.toString()).apply()
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
                } else beginUpdate(requestId)
            }
        }
    }

    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray) {
        if (requestCode != PERMISSION_REQUEST_CODE) return
        val requestId = pendingRequest ?: return
        pendingRequest = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) beginUpdate(requestId)
        else emit("seanime-app-download", requestId, JSONObject().put("error", AppLanguage.tr("Storage permission denied", "Speicherzugriff verweigert")))
    }

    private val prefs get() = activity.getSharedPreferences("app_updater", android.content.Context.MODE_PRIVATE)
    private val manager get() = activity.getSystemService(android.content.Context.DOWNLOAD_SERVICE) as android.app.DownloadManager
    private var validatedId = -1L

    private fun installedCode(): Long {
        val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    }

    private fun certificates(info: android.content.pm.PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return signatures?.map { it.toCharsString() }?.toSet() ?: emptySet()
    }

    /** Validate the actual downloaded archive, not the enqueue result or its filename. */
    private fun validate(id: Long): String {
        val uri = manager.getUriForDownloadedFile(id) ?: error("Downloaded APK is missing")
        val file = File(activity.filesDir, "app-update/pending.apk").apply { parentFile!!.mkdirs() }
        try {
            val hash = java.security.MessageDigest.getInstance("SHA-256")
            var count = 0L
            (activity.contentResolver.openInputStream(uri) ?: error("Cannot read downloaded APK")).use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n); hash.update(buffer, 0, n); count += n
                    }
                }
            }
            val expected = prefs.getLong("size", 0)
            check(count > 0 && (expected <= 0 || count == expected)) { "Incomplete APK: $count / $expected bytes" }
            val digest = hash.digest().joinToString("") { "%02x".format(it) }
            val expectedHash = prefs.getString("digest", "") ?: ""
            check(expectedHash.isEmpty() || expectedHash == "sha256:$digest") { "APK checksum mismatch" }
            val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            val archive = activity.packageManager.getPackageArchiveInfo(file.path, flags) ?: error("Download is not a valid APK")
            val installed = activity.packageManager.getPackageInfo(activity.packageName, flags)
            if (Build.VERSION.SDK_INT >= 24) check(archive.applicationInfo!!.minSdkVersion <= Build.VERSION.SDK_INT) { "APK requires a newer Android version" }
            check(archive.packageName == activity.packageName) { "APK belongs to another app" }
            check(archive.versionName == prefs.getString("version", "")) { "APK version does not match release" }
            val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
            check(code > installedCode() && AppReleasePolicy.compare(archive.versionName ?: "", currentVersion()) > 0) { "APK is not newer than installed app" }
            check(certificates(archive).isNotEmpty() && certificates(archive) == certificates(installed)) { "APK signing certificate mismatch" }
            java.util.zip.ZipFile(file).use { zip ->
                check(Build.SUPPORTED_ABIS.any { zip.getEntry("lib/$it/libseanime.so") != null }) { "APK does not support this device" }
            }
            check(prefs.edit().putString("sha256", digest).putLong("bytes", count).putLong("target_code", code).commit()) { "Cannot save validated update" }
            return digest
        } catch (e: Exception) { file.delete(); throw e }
    }

    @Synchronized
    private fun downloadState(): JSONObject {
        val id = prefs.getLong("id", -1)
        val state = JSONObject().put("status", "idle")
        if (id < 0) return state
        val version = prefs.getString("version", "") ?: ""
        if (AppReleasePolicy.compare(version, currentVersion()) <= 0) return state
        state.put("version", version).put("fileName", prefs.getString("name", ""))
            .put("location", "Downloads/" + prefs.getString("name", ""))
        try {
            manager.query(android.app.DownloadManager.Query().setFilterById(id)).use { cursor ->
                check(cursor.moveToFirst()) { "Download no longer exists. Please retry." }
                fun number(column: String) = cursor.getLong(cursor.getColumnIndexOrThrow(column))
                val bytes = number(android.app.DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                val total = number(android.app.DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
                state.put("bytes", bytes).put("total", total)
                when (number(android.app.DownloadManager.COLUMN_STATUS).toInt()) {
                    android.app.DownloadManager.STATUS_SUCCESSFUL -> {
                        // Recheck existence on every query; full archive validation once per process.
                        val uri = manager.getUriForDownloadedFile(id) ?: error("Downloaded APK is missing")
                        activity.contentResolver.openFileDescriptor(uri, "r").use { fd ->
                            check(fd != null && fd.statSize == prefs.getLong("size", 0).takeIf { it > 0 }.let { it ?: bytes }) { "Downloaded APK is missing or incomplete" }
                        }
                        if (validatedId != id) {
                            publicState = JSONObject(state.toString()).put("status", "verifying")
                            validate(id); validatedId = id
                        }
                        state.put("status", "complete").put("sha256", prefs.getString("sha256", ""))
                    }
                    android.app.DownloadManager.STATUS_FAILED -> error("Download failed (Android ${number(android.app.DownloadManager.COLUMN_REASON)}). Please retry.")
                    android.app.DownloadManager.STATUS_PAUSED -> state.put("status", "downloading").put("message", "Waiting for network / Android download service")
                    else -> state.put("status", "downloading")
                }
            }
        } catch (e: Exception) {
            state.put("status", "error").put("error", e.message ?: "Cannot read download")
        }
        return state
    }

    @Volatile private var publicState = JSONObject().put("status", "idle")
    private var monitorStarted = false
    private fun monitor() {
        if (monitorStarted) return
        monitorStarted = true
        thread(name = "app-update-monitor", isDaemon = true) {
            while (true) {
                try {
                    val state = downloadState()
                    publicState = UpdateInstaller.state(state)
                    if (state.optString("status") == "complete") UpdateInstaller.onVerified()
                } catch (_: Exception) { /* Next poll retries querying the platform service. */ }
                Thread.sleep(1000)
            }
        }
    }

    private fun beginUpdate(requestId: String) {
        // The visible action explicitly authorizes download and installation; the UI warns first.
        UpdateInstaller.authorize()
        download(requestId)
    }

    private fun download(requestId: String) {
        if (!downloading.compareAndSet(false, true)) {
            emit("seanime-app-download", requestId, JSONObject().put("state", JSONObject().put("status", "downloading")))
            return
        }
        thread(name = "app-update-download") {
            try {
                val previous = downloadState()
                if (previous.optString("status") == "downloading" || UpdateInstaller.isInstalling()) {
                    emit("seanime-app-download", requestId, JSONObject().put("state", previous))
                    return@thread
                }
                val update = fetchUpdate() ?: error("No newer app APK is available")
                if (previous.optString("status") == "complete" && previous.optString("version") == update.version) {
                    emit("seanime-app-download", requestId, JSONObject().put("state", previous))
                    return@thread
                }
                UpdateInstaller.newDownload()
                val old = prefs.getLong("id", -1)
                if (old >= 0 && previous.optString("status") != "complete") manager.remove(old)
                val request = android.app.DownloadManager.Request(android.net.Uri.parse(update.asset.url))
                    .setTitle("Seanime Mobile ${update.version}")
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, update.asset.name)
                val id = manager.enqueue(request)
                validatedId = -1
                prefs.edit().putLong("id", id).putString("version", update.version)
                    .putString("name", update.asset.name).putLong("size", update.asset.size)
                    .putString("digest", update.asset.digest).remove("sha256").commit()
                emit("seanime-app-download", requestId, JSONObject().put("state", downloadState()))
            } catch (e: Exception) {
                UpdateInstaller.fail(e.message ?: "Download failed")
                emit("seanime-app-download", requestId, JSONObject().put("error", e.message ?: "Download failed"))
            } finally { downloading.set(false) }
        }
    }
}
