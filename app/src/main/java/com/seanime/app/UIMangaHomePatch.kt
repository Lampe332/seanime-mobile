package com.seanime.app

import android.webkit.WebView

object UIMangaHomePatch {

    fun inject(webView: WebView) {
        injectMangaListCarousels(webView)
    }

    private fun injectMangaListCarousels(webView: WebView) {
        val js = """
        (function() {
            if (document.getElementById('__seanime_manga_carousel_styles')) return;

            var s = document.createElement('style');
            s.id = '__seanime_manga_carousel_styles';
            s.textContent = [
                '[data-manga-library-view-collection-lists-container="true"] {',
                '    overflow: visible !important;',
                '}',
                '[data-manga-library-view-collection-lists-container="true"] [data-media-card-grid="true"] {',
                '    display: flex !important;',
                '    flex-direction: row !important;',
                '    flex-wrap: nowrap !important;',
                '    overflow-x: auto !important;',
                '    overflow-y: visible !important;',
                '    gap: 0.65rem !important;',
                '    padding: 0.25rem 1rem 1rem 1rem !important;',
                '    scroll-snap-type: x mandatory !important;',
                '    -webkit-overflow-scrolling: touch !important;',
                '    scrollbar-width: none !important;',
                '}',
                '[data-manga-library-view-collection-lists-container="true"] [data-media-card-grid="true"]::-webkit-scrollbar {',
                '    display: none !important;',
                '}',
                // the card size of the other Home rows: 38vw on a phone, never wider than 10rem (a tablet's 38vw is a giant cover)
                '[data-manga-library-view-collection-lists-container="true"] [data-media-card-grid="true"] > div {',
                '    flex: 0 0 min(38vw, 10rem) !important;',
                '    max-width: min(38vw, 10rem) !important;',
                '    min-width: min(38vw, 10rem) !important;',
                '    width: min(38vw, 10rem) !important;',
                '    scroll-snap-align: start !important;',
                '}'
            ].join('\n');
            document.head.appendChild(s);
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }
}