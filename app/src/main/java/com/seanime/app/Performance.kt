package com.seanime.app

import android.content.ComponentCallbacks2
import android.content.Context
import android.content.pm.ApplicationInfo
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView

object Performance {

    fun init(context: Context, webView: WebView) {
        WebView.setWebContentsDebuggingEnabled(context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        val settings = webView.settings
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        @Suppress("SetJavaScriptEnabled")
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        settings.mediaPlaybackRequiresUserGesture = false
        settings.setSupportZoom(false)
        // No pop-up windows and no file:// or content:// access for web content.
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        val version = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
        settings.userAgentString = "${settings.userAgentString} SeanimeAndroid/$version"
    }

    fun onTrimMemory(webView: WebView, level: Int) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE) webView.clearCache(false)
    }

    fun onLowMemory(webView: WebView) {
        webView.clearCache(false)
    }
}
