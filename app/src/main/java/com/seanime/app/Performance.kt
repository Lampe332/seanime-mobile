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

    // ─────────────────────────────────────────────────────────────────────────
    // 2. JavaScript runtime optimisations — call from WebViewClient.onPageFinished
    // ─────────────────────────────────────────────────────────────────────────

    fun injectRuntimeOptimizations(webView: WebView) {
        injectImageLazyLoading(webView)
        injectReducedMotion(webView)
    }

    private fun injectImageLazyLoading(webView: WebView) {
        val js = """
        (function() {
            if (window.__seanime_img_observer) {
                window.__seanime_img_observer.disconnect();
            }

            function optimiseImages(root) {
                (root || document).querySelectorAll('img').forEach(function(img) {
                    if (img.loading === 'eager') return;
                    if (!img.hasAttribute('loading'))  img.setAttribute('loading',  'lazy');
                    if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
                });
            }

            optimiseImages(document);

            var imgObserver = new MutationObserver(function(mutations) {
                mutations.forEach(function(m) {
                    m.addedNodes.forEach(function(node) {
                        if (node.nodeType !== 1) return;
                        if (node.tagName === 'IMG') optimiseImages(node.parentElement);
                        else if (node.querySelector) optimiseImages(node);
                    });
                });
            });
            imgObserver.observe(document.body, { childList: true, subtree: true });
            window.__seanime_img_observer = imgObserver;
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun injectReducedMotion(webView: WebView) {
        val js = """
        (function() {
            var REDUCED_STYLE_ID  = '__seanime_reduced_motion';
            var existingReduced = document.getElementById(REDUCED_STYLE_ID);
            if (existingReduced) existingReduced.remove();

            var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
            if (mq.matches) {
                var sr = document.createElement('style');
                sr.id = REDUCED_STYLE_ID;
                sr.textContent = [
                    '*, *::before, *::after {',
                    '  animation-duration: 0.01ms !important;',
                    '  animation-iteration-count: 1 !important;',
                    '  transition-duration: 0.01ms !important;',
                    '  scroll-behavior: auto !important;',
                    '}'
                ].join('\n');
                document.head.appendChild(sr);
            }
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    fun onTrimMemory(webView: WebView, level: Int) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE) webView.clearCache(false)
    }

    fun onLowMemory(webView: WebView) {
        webView.clearCache(false)
    }
}
