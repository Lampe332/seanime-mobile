package com.seanime.app.audit

import android.app.Instrumentation
import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.webkit.WebView
import android.graphics.Bitmap
import java.io.File
import com.seanime.app.MainActivity
import com.seanime.app.AppUpdater
import com.seanime.app.AppReleasePolicy
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Runs explicit audit probes in the installed release, without enabling WebView debugging. */
class SourceRemovalInstrumentation : Instrumentation() {
    private lateinit var args: Bundle
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        args = arguments ?: Bundle()
        start()
    }
    override fun onStart() {
        val result = Bundle()
        try {
            val activity = startActivitySync(Intent(targetContext, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val field = MainActivity::class.java.getDeclaredField("webView").apply { isAccessible = true }
            val view = field.get(activity) as WebView
            if (args.getString("auditDebug") == "true") runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
            if (args.getString("discardLocalTestDownload") == "true") {
                val preferences = targetContext.getSharedPreferences("app_updater", android.content.Context.MODE_PRIVATE)
                val id = preferences.getLong("id", -1)
                val manager = targetContext.getSystemService(android.content.Context.DOWNLOAD_SERVICE) as android.app.DownloadManager
                manager.query(android.app.DownloadManager.Query().setFilterById(id)).use { cursor ->
                    check(cursor.moveToFirst())
                    val source = cursor.getString(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_URI))
                    check(source.startsWith("http://127.0.0.1:18787/")) { "Refusing to remove a non-test download" }
                }
                manager.remove(id)
                preferences.edit().remove("id").commit()
            }
            args.getString("offer")?.let { encoded ->
                val offer = JSONObject(String(Base64.decode(encoded, Base64.DEFAULT), Charsets.UTF_8))
                val asset = AppReleasePolicy.Asset(offer.getString("name"), offer.getString("url"), offer.getLong("size"), offer.optString("digest"))
                val release = AppReleasePolicy.Release("v" + offer.getString("version"), "Controlled local device test; no public release.", listOf(asset), false, false)
                val provider: () -> AppReleasePolicy.Update? = { AppReleasePolicy.Update(offer.getString("version"), release, asset) }
                AppUpdater::class.java.getDeclaredField("instrumentationOffer").apply { isAccessible = true }.set(null, provider)
            }
            if (args.getString("requireAction") == "true") {
                com.seanime.app.UpdateInstaller::class.java.getDeclaredField("instrumentationUserActionRequired")
                    .apply { isAccessible = true }.setBoolean(null, true)
            }
            if (args.getString("inspectUpdate") == "true") {
                val preferences = targetContext.getSharedPreferences("app_updater", android.content.Context.MODE_PRIVATE)
                val state = JSONObject()
                listOf("install_status", "from_code", "target_code", "session_id", "success_unread", "auto_install", "sha256", "bytes", "confirmation_intent").forEach { key -> state.put(key, preferences.all[key]) }
                result.putString("transaction", state.toString())
            }
            Thread.sleep(args.getString("waitMs", "8000").toLong())
            args.getString("setup")?.let { encoded ->
                val setup = String(Base64.decode(encoded, Base64.DEFAULT), Charsets.UTF_8)
                runOnMainSync { view.evaluateJavascript(setup, null) }
                Thread.sleep(args.getString("settleMs", "5000").toLong())
            }
            val script = String(Base64.decode(args.getString("script", ""), Base64.DEFAULT), Charsets.UTF_8)
            val done = CountDownLatch(1)
            runOnMainSync {
                view.evaluateJavascript(script) { value -> result.putString("stream", value + "\n"); done.countDown() }
            }
            check(done.await(20, TimeUnit.SECONDS)) { "WebView probe timed out" }
            args.getString("expectedDownload")?.let { expected ->
                check(JSONObject(AppUpdater.Bridge.getDownloadState()).getString("status") == expected)
            }
            if (args.getString("auditDownloads") == "true") {
                val manager = targetContext.getSystemService(android.content.Context.DOWNLOAD_SERVICE) as android.app.DownloadManager
                var count = 0
                manager.query(android.app.DownloadManager.Query()).use { cursor ->
                    while (cursor.moveToNext()) {
                        val source = cursor.getString(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_URI))
                        if (source.startsWith("http://127.0.0.1:18787/")) count++
                    }
                }
                check(count == 1) { "Expected one local test download, found $count" }
                result.putString("stream", result.getString("stream") + "PASS: exactly one Android DownloadManager record; expected download state verified.\n")
            }
            args.getString("retention")?.let { name ->
                check(name.matches(Regex("[a-zA-Z0-9_-]+")))
                val files = org.json.JSONArray()
                listOf("offline-video", "offline-artwork").forEach { directory ->
                    File(targetContext.filesDir, directory).walkTopDown().filter { it.isFile }.sortedBy { it.path }.forEach { file ->
                        val digest = java.security.MessageDigest.getInstance("SHA-256")
                        file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) } }
                        files.put(JSONObject().put("file", file.relativeTo(targetContext.filesDir).path).put("size", file.length())
                            .put("sha256", digest.digest().joinToString("") { "%02x".format(it) }))
                    }
                }
                File(targetContext.getExternalFilesDir(null), "$name.json").writeText(files.toString())
            }
            args.getString("screenshot")?.let { name ->
                check(name.matches(Regex("[a-zA-Z0-9_-]+")))
                val bitmap = uiAutomation.takeScreenshot()
                File(targetContext.getExternalFilesDir(null), "$name.png").outputStream().use {
                    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
                }
                bitmap.recycle()
            }
            Thread.sleep(args.getString("holdMs", "0").toLong())
            if (args.getString("auditDebug") == "true") runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
            finish(-1, result)
        } catch (failure: Throwable) {
            result.putString("stream", "FAIL: $failure\n")
            finish(0, result)
        }
    }
}
