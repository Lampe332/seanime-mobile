package com.seanime.app

import android.content.ComponentCallbacks2
import android.content.Context
import android.webkit.WebSettings
import android.webkit.WebView

object Performance {

    fun init(context: Context, webView: WebView) {
        WebView.setWebContentsDebuggingEnabled(
            context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
        )
        applyWebViewSettings(context, webView)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. WebView settings — applied before page load
    // ─────────────────────────────────────────────────────────────────────────

    private fun applyWebViewSettings(context: Context, webView: WebView) {
        val settings: WebSettings = webView.settings

        // ── Rendering ────────────────────────────────────────────────────────
        // Hardware acceleration is set on the View layer; enabling it here ensures
        // the compositor path is fully active.
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null)

        // Use the widest viewport so the page layout matches a desktop/tablet
        // layout engine — avoids double-render from a narrow initial viewport.
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        // ── JavaScript engine ────────────────────────────────────────────────
        @Suppress("SetJavaScriptEnabled")
        settings.javaScriptEnabled = true
        settings.javaScriptCanOpenWindowsAutomatically = false // no pop-ups

        // ── Caching ──────────────────────────────────────────────────────────
        // LOAD_DEFAULT honours HTTP cache-control headers; falls back to cache
        // when offline. This avoids unnecessary network round-trips for static assets.
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // ── Network ──────────────────────────────────────────────────────────
        // Allow the page to store data (IndexedDB, localStorage, etc.)
        settings.domStorageEnabled = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

        // ── Text / media ─────────────────────────────────────────────────────
        settings.mediaPlaybackRequiresUserGesture = false  // inline video/audio
        settings.loadsImagesAutomatically = true

        // Disable features that add overhead or expand attack surface
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.setSupportMultipleWindows(false)
        settings.allowFileAccess    = false
        settings.allowContentAccess = false

        // ── User-agent tweak ─────────────────────────────────────────────────
        val ua = settings.userAgentString
        if (!ua.contains("SeanimeAndroid")) {
            val versionName = try {
                context.packageManager
                    .getPackageInfo(context.packageName, 0)
                    .versionName ?: "0"
            } catch (e: Exception) {
                "0"
            }
            settings.userAgentString = "$ua SeanimeAndroid/$versionName"
        }
    }

    fun onTrimMemory(webView: WebView, level: Int) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE) webView.clearCache(false)
    }

    fun onLowMemory(webView: WebView) {
        webView.clearCache(false)
    }
}
