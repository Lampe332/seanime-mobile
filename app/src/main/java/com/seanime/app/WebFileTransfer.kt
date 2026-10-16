package com.seanime.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import kotlin.concurrent.thread

/** Android document pickers for the existing web import/export controls. */
class WebFileTransfer(private val activity: Activity) {
    private val openRequest = 201
    private val saveRequest = 202
    private val maxBlobBytes = 25 * 1024 * 1024
    private var chooser: ValueCallback<Array<Uri>>? = null
    private var pendingSave: ((Uri) -> Unit)? = null
    @Volatile private var exportToken: String? = null
    @Volatile private var destroyed = false

    fun attach(webView: WebView) {
        webView.addJavascriptInterface(ExportBridge(), "SeanimeFileExport")
        webView.setDownloadListener { url, userAgent, disposition, mime, _ ->
            if (Uri.parse(url).scheme !in setOf("http", "https")) return@setDownloadListener
            val cookies = CookieManager.getInstance().getCookie(url)
            askSave(URLUtil.guessFileName(url, disposition, mime), mime ?: "application/octet-stream") { destination ->
                thread(name = "SeanimeDownload") {
                    try {
                        val connection = URL(url).openConnection() as HttpURLConnection
                        connection.connectTimeout = 15000
                        connection.readTimeout = 30000
                        connection.setRequestProperty("User-Agent", userAgent)
                        if (!cookies.isNullOrBlank()) connection.setRequestProperty("Cookie", cookies)
                        try {
                            connection.inputStream.use { input ->
                                activity.contentResolver.openOutputStream(destination)?.use { input.copyTo(it) }
                                    ?: error("Could not open the selected file")
                            }
                        } finally { connection.disconnect() }
                        message("File saved")
                    } catch (_: Exception) { message("Download failed. Please try again.") }
                }
            }
        }
    }

    fun invalidateExport() { exportToken = null }

    fun injectExports(webView: WebView) {
        val token = UUID.randomUUID().toString()
        exportToken = token
        val js = """
            (function() {
                if (window.__seanimeExportListener) document.removeEventListener('click', window.__seanimeExportListener, true);
                var token = ${JSONObject.quote(token)};
                window.__seanimeExportListener = function(event) {
                    var link = event.target.closest && event.target.closest('a[download]');
                    if (!link || !link.href.startsWith('blob:' + location.origin + '/')) return;
                    event.preventDefault();
                    // Start fetching during the click, before the app revokes its blob URL.
                    fetch(link.href).then(function(response) { return response.blob(); }).then(function(blob) {
                        if (blob.size > $maxBlobBytes) throw new Error('Export exceeds 25 MiB');
                        var reader = new FileReader();
                        reader.onload = function() { SeanimeFileExport.save(token, reader.result, link.download || 'seanime-export', blob.type); };
                        reader.onerror = function() { SeanimeFileExport.failed(token); };
                        reader.readAsDataURL(blob);
                    }).catch(function() { SeanimeFileExport.failed(token); });
                };
                document.addEventListener('click', window.__seanimeExportListener, true);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    inner class ExportBridge {
        @JavascriptInterface
        fun failed(token: String) {
            if (token == exportToken) message("Export failed or exceeds the 25 MiB mobile export limit.")
        }

        @JavascriptInterface
        fun save(token: String, dataUrl: String, filename: String, mime: String) {
            if (token != exportToken || dataUrl.length > (maxBlobBytes * 4L / 3L + 1024L)) return
            val bytes = try {
                val comma = dataUrl.indexOf(',')
                if (comma < 0 || !dataUrl.substring(0,comma).endsWith(";base64")) return
                Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT).takeIf { it.size <= maxBlobBytes } ?: return
            } catch (_: IllegalArgumentException) { message("Invalid export data"); return }
            activity.runOnUiThread {
                if (token != exportToken || destroyed) return@runOnUiThread
                askSave(filename, mime.ifBlank { "application/octet-stream" }) { destination ->
                    thread(name = "SeanimeExport") {
                        try {
                            activity.contentResolver.openOutputStream(destination)?.use { it.write(bytes) }
                                ?: error("Could not open the selected file")
                            message("File saved")
                        } catch (_: Exception) { message("Could not save this file") }
                    }
                }
            }
        }
    }

    fun chooseFiles(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        chooser?.onReceiveValue(null)
        chooser = callback
        try { activity.startActivityForResult(params.createIntent(), openRequest) }
        catch (_: ActivityNotFoundException) {
            chooser?.onReceiveValue(null); chooser = null; message("No file picker is available")
        }
        return true
    }

    private fun askSave(filename: String, mime: String, writer: (Uri) -> Unit) {
        if (destroyed || activity.isFinishing || activity.isDestroyed) return
        if (pendingSave != null) { message("Finish or cancel the current file export first"); return }
        pendingSave = writer
        val name = filename.substringAfterLast('/').substringAfterLast('\\').take(180).ifBlank { "seanime-export" }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime).putExtra(Intent.EXTRA_TITLE, name)
        try { activity.startActivityForResult(intent, saveRequest) }
        catch (_: ActivityNotFoundException) { pendingSave = null; message("No file picker is available") }
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        when (requestCode) {
            openRequest -> {
                chooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
                chooser = null
            }
            saveRequest -> {
                val writer = pendingSave
                pendingSave = null
                if (resultCode == Activity.RESULT_OK) data?.data?.let { writer?.invoke(it) }
            }
            else -> return false
        }
        return true
    }

    fun destroy() {
        destroyed = true
        exportToken = null
        chooser?.onReceiveValue(null)
        chooser = null
        pendingSave = null
    }

    private fun message(text: String) {
        activity.runOnUiThread { if (!destroyed) Toast.makeText(activity, text, Toast.LENGTH_LONG).show() }
    }
}
