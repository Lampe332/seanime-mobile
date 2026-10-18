package com.seanime.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
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

    private val retryCountMap = mutableMapOf<WebView, Int>()
    private val MAX_RETRIES = 30
    private var pageLoadFailed = false
    private var pendingUrl = "http://127.0.0.1:43211"
    private val retryHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val retryLoad = Runnable { webView.loadUrl(pendingUrl) }
    private val REQUEST_CODE_NOTIFICATIONS = 101

    private val LOCAL_HOST = "127.0.0.1"
    private val androidAppVersion by lazy {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "unknown"
    }

    inner class AppInfoBridge {
        @JavascriptInterface
        fun getAppVersion(): String = androidAppVersion

        @JavascriptInterface
        fun setLanguage(language: String) = AppLanguage.set(this@MainActivity, language)
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
        setSystemBarsHidden(true)

        // --- ADDED: Handle deep link if app was closed ---
        requestLibraryAccess()
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) { handleBackNavigation() }
        }
    }

    // --- ADDED: Handle deep link if app was already in background ---
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent) // Essential for getIntent() to return the latest data
        handleWidgetIntent(intent)
    }

    // --- ADDED: The Navigation Logic ---
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
        return "http://127.0.0.1:43211/entry?id=$animeId"
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        AppUpdater.onRequestPermissionsResult(requestCode, grantResults)
        if (requestCode == REQUEST_CODE_NOTIFICATIONS &&
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
            val top: Int
            val bottom: Int
            val left: Int
            val right: Int

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val systemInsets = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
                top = systemInsets.top
                bottom = systemInsets.bottom
                left = systemInsets.left
                right = systemInsets.right
            } else {
                @Suppress("DEPRECATION")
                top = insets.systemWindowInsetTop
                @Suppress("DEPRECATION")
                bottom = insets.systemWindowInsetBottom
                @Suppress("DEPRECATION")
                left = insets.systemWindowInsetLeft
                @Suppress("DEPRECATION")
                right = insets.systemWindowInsetRight
            }

            val js = "window.__seanimeInsets = { top: $top, bottom: $bottom, left: $left, right: $right };"
            view.setPadding(left, top, right, bottom)
            view.post { (view as? WebView)?.evaluateJavascript(js, null) }
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
                if (url?.startsWith("http://127.0.0.1:43211") == true) pendingUrl = url
            }
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                // Embedded player frames must remain inside their own WebView frame.
                if (!request.isForMainFrame) return false

                if (uri.scheme == "intent") {
                    return try {
                        val intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                        startActivity(intent)
                        true
                    } catch (e: URISyntaxException) {
                        e.printStackTrace()
                        true
                    } catch (e: ActivityNotFoundException) {
                        Toast.makeText(this@MainActivity, "No installed player can handle this link", Toast.LENGTH_SHORT).show()
                        true
                    } catch (e: SecurityException) {
                        Toast.makeText(this@MainActivity, "Android blocked opening this player", Toast.LENGTH_SHORT).show()
                        true
                    }
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
                if (host == LOCAL_HOST && uri.scheme == "http" && uri.port == 43211) return false
                
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
                    retry(view)
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (pageLoadFailed) return
                retryHandler.removeCallbacks(retryLoad)
                if (view != null) retryCountMap[view] = 0

                Performance.injectRuntimeOptimizations(webView)
                pipManager.injectHijacker()
                VideoControlInjector.inject(webView)
                UIPatches.inject(webView)
                AppUpdater.inject(webView)
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
                setSystemBarsHidden(true)
            }

            override fun onHideCustomView() {
                setVideoFullscreenOrientation(false)
                val decor = window.decorView as FrameLayout
                decor.removeView(customView)
                customView = null
                customViewCallback?.onCustomViewHidden()
                webView.visibility = View.VISIBLE
                setSystemBarsHidden(true)
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

    private fun retry(view: WebView?) {
        view ?: return
        val count = retryCountMap[view] ?: 0
        if (count >= MAX_RETRIES) {
            Toast.makeText(this, "Local server did not respond. Check the Seanime notification and reopen the app to retry.", Toast.LENGTH_LONG).show()
            return
        }
        retryCountMap[view] = count + 1
        val delayMs = minOf(count + 1, 3) * 1000L
        retryHandler.removeCallbacks(retryLoad)
        retryHandler.postDelayed(retryLoad, delayMs)
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
                setSystemBarsHidden(true)
            }, 100)
        }
    }

    private fun setSystemBarsHidden(hide: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                if (hide) {
                    it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                    it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                } else {
                    it.show(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                }
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (hide) {
                (View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
            } else {
                View.SYSTEM_UI_FLAG_VISIBLE
            }
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
        if (!fileTransfer.onActivityResult(requestCode, resultCode, data)) {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    override fun onDestroy() {
        fileTransfer.destroy()
        offlineBridge.invalidate()
        retryHandler.removeCallbacksAndMessages(null)
        PopupWebViewSheet.dismissFor(this)
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
            .setPositiveButton("Allow file access") { _, _ ->
                if (Build.VERSION.SDK_INT >= 30) {
                    startActivity(Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:$packageName")))
                } else if (Build.VERSION.SDK_INT >= 23) {
                    requestPermissions(arrayOf("android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"), 102)
                }
            }
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
        requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), REQUEST_CODE_NOTIFICATIONS)
    }
}
