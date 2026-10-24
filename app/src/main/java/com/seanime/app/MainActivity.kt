package com.seanime.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.DocumentsContract
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
import org.json.JSONObject
import java.net.URISyntaxException

class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var pipManager: PiPManager
    private lateinit var chromeClient: WebChromeClient
    private val fileTransfer by lazy { WebFileTransfer(this) }
    private val offlineBridge by lazy { com.seanime.app.offline.OfflineBridge(this) }
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var videoFullscreenPreviousOrientation: Int? = null
    private var backNavigationPending = false

    private var retries = 0
    private var pageLoadFailed = false
    private var pendingUrl = ORIGIN
    private val retryHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val retryLoad = Runnable { webView.loadUrl(pendingUrl) }
    private var folderPickRequestId: String? = null

    private companion object {
        const val ORIGIN = "http://127.0.0.1:43211"
        const val MAX_RETRIES = 30
        const val REQUEST_NOTIFICATIONS = 101
        const val REQUEST_STORAGE = 102
        const val REQUEST_FOLDER = 301
    }

    private val androidAppVersion by lazy {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "unknown"
    }

    inner class AppInfoBridge {
        @JavascriptInterface
        fun getAppVersion(): String = androidAppVersion

        @JavascriptInterface
        fun setLanguage(language: String) = AppLanguage.set(this@MainActivity, language)

        /** WebView blocks navigator.clipboard.readText; the AniList login pastes its token through this. */
        @JavascriptInterface
        fun readClipboard(): String {
            val clip = (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).primaryClip ?: return ""
            return if (clip.itemCount > 0) clip.getItemAt(0).coerceToText(this@MainActivity).toString() else ""
        }

        /** Settings folder fields: answers with a "seanime-folder-picked" window event carrying the same requestId. */
        @JavascriptInterface
        fun pickFolder(requestId: String) = runOnUiThread { startFolderPicker(requestId) }
    }

    private fun startFolderPicker(requestId: String) {
        if (isFinishing || isDestroyed) return
        // The Go backend reads plain paths, which needs "All files access" rather than the tree grant.
        val hasFileAccess = if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
            else Build.VERSION.SDK_INT < 23 || checkSelfPermission("android.permission.READ_EXTERNAL_STORAGE") == PackageManager.PERMISSION_GRANTED
        if (!hasFileAccess) {
            openFileAccessSettings()
            dispatchFolderPicked(requestId, error = "permission")
            return
        }
        folderPickRequestId?.let { dispatchFolderPicked(it, error = "cancelled") }
        folderPickRequestId = requestId
        try {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), REQUEST_FOLDER)
        } catch (_: ActivityNotFoundException) {
            folderPickRequestId = null
            dispatchFolderPicked(requestId, error = "cancelled")
            Toast.makeText(this, "No folder picker is available", Toast.LENGTH_SHORT).show()
        }
    }

    private fun onFolderPicked(resultCode: Int, data: Intent?) {
        val requestId = folderPickRequestId ?: return
        folderPickRequestId = null
        val tree = data?.data
        if (resultCode != RESULT_OK || tree == null) {
            dispatchFolderPicked(requestId, error = "cancelled")
            return
        }
        val path = if (tree.authority == "com.android.externalstorage.documents") {
            primaryStoragePath(DocumentsContract.getTreeDocumentId(tree))
        } else null
        if (path == null) dispatchFolderPicked(requestId, error = "not-primary")
        else dispatchFolderPicked(requestId, path = path)
    }

    private fun dispatchFolderPicked(requestId: String, path: String? = null, error: String? = null) {
        val detail = JSONObject().put("requestId", requestId)
        if (path != null) detail.put("path", path)
        if (error != null) detail.put("error", error)
        val js = "window.dispatchEvent(new CustomEvent('seanime-folder-picked', {detail: $detail}));"
        runOnUiThread { if (::webView.isInitialized && !isDestroyed) webView.evaluateJavascript(js, null) }
    }

    private fun openFileAccessSettings() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                startActivity(Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:$packageName")))
            } catch (_: ActivityNotFoundException) {
                startActivity(Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            }
        } else if (Build.VERSION.SDK_INT >= 23) {
            requestPermissions(arrayOf("android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"), REQUEST_STORAGE)
        }
    }

    inner class OrientationBridge {
        @JavascriptInterface
        fun setLandscape(landscape: Boolean) {
            runOnUiThread {
                // Reader DOM observers must not release the video fullscreen lock.
                if (videoFullscreenPreviousOrientation != null) return@runOnUiThread
                requestedOrientation = if (landscape) {
                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                } else {
                    ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                }
            }
        }

        @JavascriptInterface
        fun setVideoFullscreen(fullscreen: Boolean) {
            setVideoFullscreenOrientation(fullscreen)
        }
    }

    private fun setVideoFullscreenOrientation(fullscreen: Boolean) {
        runOnUiThread {
            if (fullscreen) {
                if (videoFullscreenPreviousOrientation == null) {
                    videoFullscreenPreviousOrientation = requestedOrientation
                }
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            } else {
                val previous = videoFullscreenPreviousOrientation
                videoFullscreenPreviousOrientation = null
                if (previous != null) requestedOrientation = previous
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        AppLanguage.init(this)
        super.onCreate(savedInstanceState)

        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = android.graphics.Color.TRANSPARENT

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
        }

        setupWebView(savedInstanceState)
        startSeanimeService()
        hideSystemBars()

        requestLibraryAccess()
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) { handleBackNavigation() }
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleWidgetIntent(intent)
    }

    private fun handleWidgetIntent(intent: Intent?) {
        val url = widgetUrl(intent) ?: return
        pendingUrl = url
        retryHandler.removeCallbacks(retryLoad)
        webView.loadUrl(pendingUrl)
    }

    private fun widgetUrl(intent: Intent?): String? {
        val data = intent?.data ?: return null
        if (!data.isHierarchical || data.scheme != "seanime" || data.host != "entry") return null
        val animeId = data.getQueryParameter("id")?.toLongOrNull()?.takeIf { it > 0 } ?: return null
        return "$ORIGIN/entry?id=$animeId"
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        AppUpdater.onRequestPermissionsResult(requestCode, grantResults)
        if (requestCode == REQUEST_NOTIFICATIONS &&
            grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        ) {
            startSeanimeService()
        }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        Performance.onTrimMemory(webView, level)
    }

    override fun onLowMemory() {
        super.onLowMemory()
        Performance.onLowMemory(webView)
    }

    private fun startSeanimeService() {
        val intent = Intent(this, SeanimeService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
    }

    private fun setupWebView(savedInstanceState: Bundle?) {
        webView = WebView(this)
        setContentView(webView)

        Performance.init(this, webView)
        fileTransfer.attach(webView)
        webView.addJavascriptInterface(offlineBridge, "SeanimeOffline")

        webView.setOnApplyWindowInsetsListener { view, insets ->
            val bars = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
                    .run { android.graphics.Rect(left, top, right, bottom) }
            } else {
                @Suppress("DEPRECATION")
                android.graphics.Rect(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            val js = "window.__seanimeInsets = { top: ${bars.top}, bottom: ${bars.bottom}, left: ${bars.left}, right: ${bars.right} }; window.dispatchEvent(new Event('seanime:window-insets'));"
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            view.post { webView.evaluateJavascript(js, null) }
            insets
        }

        pipManager = PiPManager(this, webView)
        pipManager.registerBridge()

        AppUpdater.init(this, webView)

        webView.addJavascriptInterface(OrientationBridge(), "OrientationBridge")
        webView.addJavascriptInterface(AppInfoBridge(), "SeanimeAndroid")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                fileTransfer.invalidateExport()
                offlineBridge.invalidate()
                pageLoadFailed = false
                if (url?.startsWith(ORIGIN) == true) pendingUrl = url
            }
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                // Embedded player frames must remain inside their own WebView frame.
                if (!request.isForMainFrame) return false

                if (uri.scheme == "intent") {
                    try {
                        startActivity(Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME))
                    } catch (_: URISyntaxException) {
                    } catch (_: ActivityNotFoundException) {
                        Toast.makeText(this@MainActivity, "No installed player can handle this link", Toast.LENGTH_SHORT).show()
                    } catch (_: SecurityException) {
                        Toast.makeText(this@MainActivity, "Android blocked opening this player", Toast.LENGTH_SHORT).show()
                    }
                    return true
                }

                if (uri.scheme == "seanime") {
                    handleWidgetIntent(Intent(Intent.ACTION_VIEW, uri))
                    return true
                }
                if (uri.scheme != "http" && uri.scheme != "https") {
                    if (uri.scheme in setOf("about", "data", "file", "content", "javascript")) return true
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
                    } catch (_: ActivityNotFoundException) {
                        Toast.makeText(this@MainActivity, "No installed app can open this link", Toast.LENGTH_SHORT).show()
                    } catch (_: SecurityException) {
                        Toast.makeText(this@MainActivity, "Android blocked opening this link", Toast.LENGTH_SHORT).show()
                    }
                    return true
                }
                val host = uri.host ?: return false
                if (host == "127.0.0.1" && uri.scheme == "http" && uri.port == 43211) return false

                PopupWebViewSheet.show(this@MainActivity, uri.toString())
                return true
            }

            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                return request?.url?.let { com.seanime.app.offline.OfflineLibrary.get(this@MainActivity).intercept(it) }
                    ?: super.shouldInterceptRequest(view, request)
            }

            override fun onReceivedError(view: WebView?, req: WebResourceRequest?, err: WebResourceError?) {
                if (req?.isForMainFrame == true) {
                    pageLoadFailed = true
                    retry()
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (pageLoadFailed) return
                retryHandler.removeCallbacks(retryLoad)
                retries = 0

                pipManager.injectHijacker()
                VideoControlInjector.inject(webView)
                UIBottomNav.inject(webView)
                UIHomePatch.inject(webView)
                fileTransfer.injectExports(webView)
                offlineBridge.inject(webView)
            }
        }

        chromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =
                fileTransfer.chooseFiles(callback, params)

            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (customView != null) {
                    onHideCustomView()
                    return
                }
                setVideoFullscreenOrientation(true)
                customView = view
                customViewCallback = callback
                val decor = window.decorView as FrameLayout
                decor.addView(customView, FrameLayout.LayoutParams(-1, -1))
                webView.visibility = View.GONE
                hideSystemBars()
            }

            override fun onHideCustomView() {
                setVideoFullscreenOrientation(false)
                val decor = window.decorView as FrameLayout
                decor.removeView(customView)
                customView = null
                customViewCallback?.onCustomViewHidden()
                webView.visibility = View.VISIBLE
                hideSystemBars()
            }
        }

        webView.webChromeClient = chromeClient

        val restored = savedInstanceState?.let { webView.restoreState(it) }
        if (restored == null) {
            // Invalid or unsupported deep links must still show a usable home page.
            pendingUrl = widgetUrl(intent) ?: pendingUrl
            retryHandler.postDelayed(retryLoad, 1000)
        } else {
            pendingUrl = restored.currentItem?.url ?: pendingUrl
        }
    }

    private fun retry() {
        if (retries >= MAX_RETRIES) {
            Toast.makeText(this, "Local server did not respond. Check the Seanime notification and reopen the app to retry.", Toast.LENGTH_LONG).show()
            return
        }
        retries++
        retryHandler.removeCallbacks(retryLoad)
        retryHandler.postDelayed(retryLoad, minOf(retries, 3) * 1000L)
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        pipManager.onPiPModeChanged(isInPictureInPictureMode)

        if (!isInPictureInPictureMode) {
            webView.postDelayed({
                webView.setInitialScale(100)
                webView.postDelayed({
                    webView.evaluateJavascript(
                        "(function(){document.documentElement.style.zoom='1';document.body.style.zoom='1';})();",
                        null
                    )
                }, 50)
                hideSystemBars()
            }, 100)
        }
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    // API 33+ uses the native OnBackInvokedDispatcher registered in onCreate.
    @android.annotation.SuppressLint("GestureBackNavigation")
    override fun onBackPressed() = handleBackNavigation()

    private fun handleBackNavigation() {
        if (customView != null) {
            chromeClient.onHideCustomView()
        } else {
            if (backNavigationPending) return
            backNavigationPending = true
            webView.evaluateJavascript(AndroidNavigation.backScript) { handled ->
                backNavigationPending = false
                if (isFinishing || isDestroyed || handled == "true") return@evaluateJavascript
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        UpdateInstaller.onResume(this)
        if (::pipManager.isInitialized) pipManager.onResume()
    }

    override fun onStop() {
        // Closing the picture-in-picture window stops the activity: stop playback with it.
        if (::pipManager.isInitialized) pipManager.onStop()
        super.onStop()
    }

    override fun onPause() {
        UpdateInstaller.onPause(this)
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("WebView file callbacks use the platform Activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (UpdateInstaller.onActivityResult(requestCode, resultCode)) return
        if (requestCode == REQUEST_FOLDER) { onFolderPicked(resultCode, data); return }
        if (!fileTransfer.onActivityResult(requestCode, resultCode, data)) {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    override fun onDestroy() {
        fileTransfer.destroy()
        offlineBridge.invalidate()
        retryHandler.removeCallbacksAndMessages(null)
        PopupWebViewSheet.dismissFor(this)
        if (::pipManager.isInitialized) pipManager.destroy()
        if (::webView.isInitialized) {
            webView.stopLoading()
            (webView.parent as? android.view.ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun requestLibraryAccess() {
        val prefs = getSharedPreferences("android_permissions", MODE_PRIVATE)
        if (prefs.getBoolean("library_access_explained", false)) {
            requestNotificationAccess()
            return
        }
        prefs.edit().putBoolean("library_access_explained", true).apply()
        android.app.AlertDialog.Builder(this)
            .setTitle("Local media library")
            .setMessage("Allow file access so Seanime can scan and download media in shared storage. You can also use streaming without this permission.")
            .setPositiveButton("Allow file access") { _, _ -> openFileAccessSettings() }
            .setNegativeButton("Use streaming", null)
            .setOnDismissListener { requestNotificationAccess() }
            .show()
    }

    private fun requestNotificationAccess() {
        if (Build.VERSION.SDK_INT < 33 || isFinishing || isDestroyed) return
        if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) return
        val prefs = getSharedPreferences("android_permissions", MODE_PRIVATE)
        if (prefs.getBoolean("notifications_requested", false)) return
        prefs.edit().putBoolean("notifications_requested", true).apply()
        requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), REQUEST_NOTIFICATIONS)
    }
}

/** Tree document id of the primary volume ("primary:Anime/Show") as a plain path; null for other volumes. */
internal fun primaryStoragePath(treeDocumentId: String): String? {
    val volume = treeDocumentId.substringBefore(':', "")
    if (volume != "primary") return null
    val relative = treeDocumentId.substringAfter(':').trim('/')
    return if (relative.isEmpty()) "/storage/emulated/0" else "/storage/emulated/0/$relative"
}
