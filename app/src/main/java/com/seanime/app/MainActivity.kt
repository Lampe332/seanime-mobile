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
import com.seanime.app.notify.AiringNotifier
import org.json.JSONObject
import java.net.URISyntaxException

class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var pipManager: PiPManager
    private lateinit var mediaSession: MediaSessionBridge
    private lateinit var chromeClient: WebChromeClient
    private val fileTransfer by lazy { WebFileTransfer(this) }
    private val offlineBridge by lazy { com.seanime.app.offline.OfflineBridge(this) }
    private val feedback by lazy { Feedback(this) }
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
        const val REQUEST_STREAM_PLAYER = 302
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

        @JavascriptInterface
        fun getAiringNotifications(): Boolean = AiringNotifier.isEnabled(this@MainActivity)

        /** Turning it on asks for the notification permission first (Android 13+). */
        @JavascriptInterface
        fun setAiringNotifications(enabled: Boolean) {
            AiringNotifier.setEnabled(this@MainActivity, enabled)
            if (enabled) runOnUiThread { askNotificationPermission() }
        }

        /** "ok", or "permission" when Android does not allow notifications. */
        @JavascriptInterface
        fun testAiringNotification(): String = AiringNotifier.postTest(this@MainActivity).also {
            if (it == "permission") runOnUiThread { askNotificationPermission() }
        }

        /** Audio the WebView cannot decode (AC3, DTS …): the app's player takes over; "seanime-app-player-closed" tells where it stopped. */
        @JavascriptInterface
        fun playInAppPlayer(url: String, title: String, positionMs: Double, audioLanguage: String, subtitleLanguage: String) {
            // only streams of the app's own server
            if (!url.startsWith("$ORIGIN/")) return
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(this@MainActivity, com.seanime.app.offline.StreamPlayerActivity::class.java)
                    .putExtra(com.seanime.app.offline.StreamPlayerActivity.EXTRA_URL, url)
                    .putExtra(com.seanime.app.offline.StreamPlayerActivity.EXTRA_TITLE, title)
                    .putExtra(com.seanime.app.offline.StreamPlayerActivity.EXTRA_POSITION, positionMs.toLong())
                    .putExtra(com.seanime.app.offline.StreamPlayerActivity.EXTRA_AUDIO_LANGUAGE, audioLanguage)
                    .putExtra(com.seanime.app.offline.StreamPlayerActivity.EXTRA_SUBTITLE_LANGUAGE, subtitleLanguage), REQUEST_STREAM_PLAYER)
            }
        }

        /** Settings folder fields: answers with a "seanime-folder-picked" window event carrying the same requestId. */
        @JavascriptInterface
        fun pickFolder(requestId: String) = runOnUiThread { startFolderPicker(requestId) }

        @JavascriptInterface
        fun getDownloadsWifiOnly(): Boolean = com.seanime.app.offline.EpisodeDownloads.wifiOnly(this@MainActivity)

        /** Episode downloads wait for Wi-Fi; applies to running downloads right away. */
        @JavascriptInterface
        fun setDownloadsWifiOnly(enabled: Boolean) = runOnUiThread {
            com.seanime.app.offline.EpisodeDownloads.setWifiOnly(this@MainActivity, enabled)
        }

        @JavascriptInterface
        fun isMeteredNetwork(): Boolean = com.seanime.app.offline.EpisodeDownloads.metered(this@MainActivity)

        /** "tick", "long", "confirm" or "reject"; nothing when turned off in the settings or in Android's touch feedback. */
        @JavascriptInterface
        fun haptic(kind: String) = feedback.haptic(kind)

        /** "success"; silent while the phone is muted or something plays audio. */
        @JavascriptInterface
        fun playSound(name: String) = feedback.playSound(name)

        @JavascriptInterface
        fun hasVibrator(): Boolean = feedback.hasVibrator()

        @JavascriptInterface
        fun getHaptics(): Boolean = feedback.hapticsEnabled

        @JavascriptInterface
        fun setHaptics(enabled: Boolean) { feedback.hapticsEnabled = enabled }

        @JavascriptInterface
        fun getSounds(): Boolean = feedback.soundsEnabled

        @JavascriptInterface
        fun setSounds(enabled: Boolean) { feedback.soundsEnabled = enabled }
    }

    /** Player swipe gestures: screen brightness (this window only) and the media volume, as fractions 0..1. */
    inner class PlayerGestureBridge {
        private val audio by lazy { getSystemService(AUDIO_SERVICE) as android.media.AudioManager }

        @JavascriptInterface
        fun getBrightness(): Float {
            val own = window.attributes.screenBrightness
            if (own >= 0f) return own
            return try {
                android.provider.Settings.System.getInt(contentResolver, android.provider.Settings.System.SCREEN_BRIGHTNESS) / 255f
            } catch (_: android.provider.Settings.SettingNotFoundException) {
                0.5f
            }
        }

        @JavascriptInterface
        fun setBrightness(value: Float) = runOnUiThread {
            window.attributes = window.attributes.apply { screenBrightness = value.coerceIn(0.01f, 1f) }
        }

        /** Back to the system brightness when the player closes. */
        @JavascriptInterface
        fun resetBrightness() = runOnUiThread {
            window.attributes = window.attributes.apply { screenBrightness = android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE }
        }

        @JavascriptInterface
        fun getVolume(): Float {
            val max = audio.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC).coerceAtLeast(1)
            return audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC).toFloat() / max
        }

        @JavascriptInterface
        fun setVolume(value: Float) {
            val max = audio.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
            audio.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, Math.round(value.coerceIn(0f, 1f) * max), 0)
        }
    }

    /** Casting to a TV (LG webOS and other DLNA TVs, Google TV/Chromecast); the player's cast panel listens to "seanime-cast" events. */
    inner class CastBridge {
        @JavascriptInterface
        fun discover() = cast.discover()

        @JavascriptInterface
        fun start(id: String, url: String, title: String, positionMs: Double, artworkUrl: String) {
            // only streams of the app's own server
            if (url.startsWith("$ORIGIN/")) cast.start(id, url, title, positionMs.toLong(), artworkUrl)
        }

        /** The same video with other tracks, from where the TV is */
        @JavascriptInterface
        fun switchStream(url: String) {
            if (url.startsWith("$ORIGIN/")) cast.switchStream(url)
        }

        /** Another video (the next episode) on the TV in use */
        @JavascriptInterface
        fun load(url: String, title: String, positionMs: Double, artworkUrl: String) {
            if (url.startsWith("$ORIGIN/")) cast.load(url, title, positionMs.toLong(), artworkUrl)
        }

        /** play, pause, seek, skip, volume */
        @JavascriptInterface
        fun control(action: String, value: Double) = cast.control(action, value.toLong())

        @JavascriptInterface
        fun status() = cast.status()

        @JavascriptInterface
        fun stop(resume: Boolean) = cast.stop(resume)

        @JavascriptInterface
        fun current(): String = cast.current()
    }

    private val cast by lazy {
        com.seanime.app.cast.CastController(applicationContext) { detail ->
            runOnUiThread {
                if (::webView.isInitialized) webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('seanime-cast',{detail:$detail}))", null)
                // no automatic picture-in-picture while the TV plays
                if (::pipManager.isInitialized) pipManager.refreshAutoEnter()
            }
        }
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
            Toast.makeText(this, AppLanguage.tr("No folder picker is available", "Keine Ordnerauswahl verfügbar"), Toast.LENGTH_SHORT).show()
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
            // Fullscreen video may use the area beside the camera cutout, like Android 15+ already does for every
            // window of this app. The pages themselves keep the default: the WebView is only padded to the cutout there.
            if (Build.VERSION.SDK_INT >= 28) window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = if (fullscreen) android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    else android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
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
        // the local server tells the AniList user; give it time to boot
        AiringNotifier.checkLater(this, 20_000)
        publishShortcuts()
        hideSystemBars()

        requestLibraryAccess()
        if (Build.VERSION.SDK_INT >= 33) {
            // Above the WebView's own fullscreen callback, which would leave fullscreen with a player menu still open;
            // the page closes the menu first and then leaves fullscreen itself (AndroidNavigation.backScript).
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_OVERLAY
            ) { handleBackNavigation() }
        }
    }

    /** singleTask: widget, notification, shortcut and link intents reach the running app and navigate its WebView. */
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (::webView.isInitialized) handleWidgetIntent(intent)
    }

    private fun handleWidgetIntent(intent: Intent?) {
        val url = widgetUrl(intent) ?: return
        openAppUrl(url)
    }

    private fun openAppUrl(url: String) {
        pendingUrl = url
        retryHandler.removeCallbacks(retryLoad)
        webView.loadUrl(pendingUrl)
    }

    /** Widget, launcher shortcut, AniList/MyAnimeList link or shared text; MyAnimeList ids open once AniList knows them. */
    private fun widgetUrl(intent: Intent?): String? {
        val target = if (intent?.action == Intent.ACTION_SEND) AppLinks.shared(intent.getStringExtra(Intent.EXTRA_TEXT))
            else AppLinks.target(intent?.dataString)
        return when (target) {
            is AppLinks.Page -> ORIGIN + target.path
            is AppLinks.MalAnime -> {
                openMalAnime(target.malId)
                null
            }
            null -> null
        }
    }

    private fun openMalAnime(malId: Long) = Thread {
        val anilistId = try {
            val body = JSONObject().put("query", "query (\$id: Int) { Media(idMal: \$id, type: ANIME) { id } }")
                .put("variables", JSONObject().put("id", malId)).toString()
            val conn = java.net.URL("https://graphql.anilist.co").openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            conn.doOutput = true
            try {
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                JSONObject(conn.inputStream.bufferedReader().use { it.readText() }).getJSONObject("data").getJSONObject("Media").getLong("id")
            } finally {
                conn.disconnect()
            }
        } catch (_: Exception) {
            null
        }
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            if (anilistId == null) Toast.makeText(this, AppLanguage.tr("This anime is not on AniList", "Dieser Anime ist nicht auf AniList"), Toast.LENGTH_SHORT).show()
            else openAppUrl("$ORIGIN/entry?id=$anilistId")
        }
    }.start()

    /** Long-pressing the launcher icon: search, downloads, schedule (in the app's language). */
    private fun publishShortcuts() {
        if (Build.VERSION.SDK_INT < 25) return
        fun shortcut(id: String, label: String, path: String, icon: Int) = android.content.pm.ShortcutInfo.Builder(this, id)
            .setShortLabel(label)
            .setIcon(android.graphics.drawable.Icon.createWithResource(this, icon))
            .setIntent(Intent(Intent.ACTION_VIEW, Uri.parse("seanime://open?path=$path"), this, MainActivity::class.java))
            .build()
        try {
            getSystemService(android.content.pm.ShortcutManager::class.java).dynamicShortcuts = listOf(
                shortcut("search", AppLanguage.tr("Search", "Suche"), "/search", android.R.drawable.ic_menu_search),
                shortcut("downloads", AppLanguage.tr("Downloads", "Downloads"), "/android-downloads", android.R.drawable.stat_sys_download_done),
                shortcut("schedule", AppLanguage.tr("Schedule", "Sendeplan"), "/schedule", android.R.drawable.ic_menu_my_calendar),
            )
        } catch (_: IllegalStateException) {
            // the launcher limits how often shortcuts change; the last ones stay
        }
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

    /** [openIntent] false: a rebuilt WebView continues where the old one was instead of following the launch intent again. */
    private fun setupWebView(savedInstanceState: Bundle?, openIntent: Boolean = true) {
        webView = WebView(this)
        setContentView(webView)

        Performance.init(this, webView)
        fileTransfer.attach(webView)
        webView.addJavascriptInterface(offlineBridge, "SeanimeOffline")
        pipManager = PiPManager(this, webView) { cast.current().isNotEmpty() }
        pipManager.registerBridge()
        mediaSession = MediaSessionBridge(this, webView, pipManager)
        webView.addJavascriptInterface(mediaSession, "SeanimeMedia")
        webView.addJavascriptInterface(PlayerGestureBridge(), "SeanimeGestures")
        webView.addJavascriptInterface(CastBridge(), "SeanimeCast")

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
                        Toast.makeText(this@MainActivity, AppLanguage.tr("No installed player can handle this link", "Kein installierter Player kann diesen Link öffnen"), Toast.LENGTH_SHORT).show()
                    } catch (_: SecurityException) {
                        Toast.makeText(this@MainActivity, AppLanguage.tr("Android blocked opening this player", "Android hat das Öffnen dieses Players blockiert"), Toast.LENGTH_SHORT).show()
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
                        Toast.makeText(this@MainActivity, AppLanguage.tr("No installed app can open this link", "Keine installierte App kann diesen Link öffnen"), Toast.LENGTH_SHORT).show()
                    } catch (_: SecurityException) {
                        Toast.makeText(this@MainActivity, AppLanguage.tr("Android blocked opening this link", "Android hat das Öffnen dieses Links blockiert"), Toast.LENGTH_SHORT).show()
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
                injectWhenReady(0)
            }

            // The renderer crashed or Android ended it for memory. Returning false would end the whole app; the
            // local server runs in its own process, so a fresh WebView can continue on the same page.
            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                if (view === webView) rebuildWebView()
                return true
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
            if (openIntent) pendingUrl = widgetUrl(intent) ?: pendingUrl
            retryHandler.postDelayed(retryLoad, if (openIntent) 1000 else 0)
        } else {
            pendingUrl = restored.currentItem?.url ?: pendingUrl
        }
    }

    /** Replaces a WebView whose renderer is gone; Android forbids using it any further. */
    private fun rebuildWebView() {
        val dead = webView
        // SPA navigation does not start a page load, so the WebView's own URL is the newer one.
        pendingUrl = dead.url?.takeIf { it.startsWith("$ORIGIN/") } ?: pendingUrl
        retryHandler.removeCallbacks(retryLoad)
        customView?.let {
            (window.decorView as FrameLayout).removeView(it)
            customView = null
            customViewCallback = null
            setVideoFullscreenOrientation(false)
        }
        PopupWebViewSheet.dismissFor(this)
        pipManager.destroy()
        mediaSession.release()
        offlineBridge.invalidate()
        (dead.parent as? android.view.ViewGroup)?.removeView(dead)
        dead.destroy()
        if (isFinishing || isDestroyed) return
        retries = 0
        setupWebView(null, openIntent = false)
        hideSystemBars()
    }

    /**
     * When a reload interrupts a load, that load's finish callback can arrive while the next document has no body
     * yet. The injections would then mark themselves done in a page they could not build (no navigation bar, no
     * player controls), so they wait for the body.
     */
    private fun injectWhenReady(attempt: Int) {
        webView.evaluateJavascript("!!document.body") { ready ->
            if (isDestroyed) return@evaluateJavascript
            if (ready != "true") {
                if (attempt < 50) webView.postDelayed({ injectWhenReady(attempt + 1) }, 100)
                return@evaluateJavascript
            }
            pipManager.injectHijacker()
            VideoControlInjector.inject(webView)
            UIBottomNav.inject(webView)
            UIHomePatch.inject(webView)
            fileTransfer.injectExports(webView)
            offlineBridge.inject(webView)
        }
    }

    private fun retry() {
        if (retries >= MAX_RETRIES) {
            Toast.makeText(this, AppLanguage.tr("Local server did not respond. Check the Seanime notification and reopen the app to retry.",
                "Der lokale Server antwortet nicht. Seanime-Benachrichtigung prüfen und die App für einen neuen Versuch erneut öffnen."), Toast.LENGTH_LONG).show()
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
        if (backNavigationPending) return
        backNavigationPending = true
        webView.evaluateJavascript(AndroidNavigation.backScript) { handled ->
            backNavigationPending = false
            if (isFinishing || isDestroyed || handled == "true") return@evaluateJavascript
            when {
                customView != null -> chromeClient.onHideCustomView()
                // On the start page Back leaves like Home: the WebView, playback and the server stay as they are.
                webView.canGoBack() -> webView.goBack()
                else -> moveTaskToBack(true)
            }
        }
    }

    // Every start of another screen or app from here passes this; opening one is no reason for picture-in-picture.
    override fun startActivityForResult(intent: Intent, requestCode: Int, options: Bundle?) {
        if (::pipManager.isInitialized) pipManager.setOwnLaunch(true)
        try {
            super.startActivityForResult(intent, requestCode, options)
        } catch (e: RuntimeException) {
            if (::pipManager.isInitialized) pipManager.setOwnLaunch(false)
            throw e
        }
    }

    /** Home or recents while a video plays: picture-in-picture by itself (Android 12+ does that from the PiP params). */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (::pipManager.isInitialized) pipManager.onUserLeaveHint()
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
        if (requestCode == REQUEST_STREAM_PLAYER) {
            val position = data?.getLongExtra(com.seanime.app.offline.StreamPlayerActivity.EXTRA_POSITION, 0L) ?: 0L
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('seanime-app-player-closed',{detail:{positionMs:$position}}))", null)
            return
        }
        if (!fileTransfer.onActivityResult(requestCode, resultCode, data)) {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    override fun onDestroy() {
        fileTransfer.destroy()
        offlineBridge.invalidate()
        feedback.release()
        retryHandler.removeCallbacksAndMessages(null)
        PopupWebViewSheet.dismissFor(this)
        if (::pipManager.isInitialized) pipManager.destroy()
        if (::mediaSession.isInitialized) mediaSession.release()
        cast.release()
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
            .setTitle(AppLanguage.tr("Local media library", "Lokale Mediathek"))
            .setMessage(AppLanguage.tr("Allow file access so Seanime can scan and download media in shared storage. You can also use streaming without this permission.",
                "Erlaube den Dateizugriff, damit Seanime Medien im gemeinsamen Speicher findet und herunterlädt. Streaming geht auch ohne diese Berechtigung."))
            .setPositiveButton(AppLanguage.tr("Allow file access", "Dateizugriff erlauben")) { _, _ -> openFileAccessSettings() }
            .setNegativeButton(AppLanguage.tr("Use streaming", "Nur streamen"), null)
            .setOnDismissListener { requestNotificationAccess() }
            .show()
    }

    /** From a setting the user turned on: unlike the first-start prompt it asks again, or opens the system page once Android stops asking. */
    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33 || isFinishing || isDestroyed) return
        if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) return
        val prefs = getSharedPreferences("android_permissions", MODE_PRIVATE)
        if (prefs.getBoolean("notifications_requested", false) && !shouldShowRequestPermissionRationale("android.permission.POST_NOTIFICATIONS")) {
            startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName))
            return
        }
        prefs.edit().putBoolean("notifications_requested", true).apply()
        requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), REQUEST_NOTIFICATIONS)
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
