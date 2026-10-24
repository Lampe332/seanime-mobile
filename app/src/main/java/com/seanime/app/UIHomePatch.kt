package com.seanime.app

import android.webkit.WebView

object UIHomePatch {

    fun inject(webView: WebView) {
        injectHomeStyles(webView)
        injectModalStyles(webView)
    }

    private fun injectHomeStyles(webView: WebView) {
        val js = """
        (function() {
            if (document.getElementById('__seanime_home_styles')) return;

            var s = document.createElement('style');
            s.id = '__seanime_home_styles';
            s.textContent = `
                /* ── Global layout constraints & Top Spacing ── */
                html, body {
                    overflow-x: hidden !important;
                    position: relative !important;
                    width: 100% !important;
                    max-width: 100vw !important;
                }

                [data-page-wrapper="true"] {
                    padding-top: 1.5rem !important;
                    overflow-x: hidden !important;
                    max-width: 100vw !important;
                    display: block !important;
                }
                [data-home-toolbar-container] {
                    min-width: 0 !important;
                    max-width: 100% !important;
                    box-sizing: border-box !important;
                }
                [data-home-toolbar-container] button {
                    min-width: 44px;
                    min-height: 44px;
                }

                /* ── Banner: shrink on mobile ── */
                [data-layout-header-background-gradient="true"] {
                    height: 4rem !important;
                }
                [data-library-toolbar-top-padding="true"].h-28 {
                    height: 4rem !important;
                }

                /* ── Top navbar ── */
                [data-top-navbar-content-separator="true"] {
                    display: none !important;
                }

                /* ── Carousel / Grid fix for Horizontal Scrolling ── */
                [data-library-collection-list-item-media-card-lazy-grid] {
                    min-width: 0 !important;
                    max-width: 100vw !important;
                    width: 100% !important;
                    overflow: hidden !important;
                }

                /* ── Card UI tweaks ── */
                [data-episode-card-subtitle="true"] { font-size: 0.78rem !important; }
                [data-episode-card-title="true"] { font-size: 0.92rem !important; width: 100% !important; }
                [data-media-card-grid="true"] { gap: 0.65rem !important; }
                [data-media-entry-card-title-section-title="true"] { font-size: 0.78rem !important; }

                /* ── Genre tabs ── */
                .UI-StaticTabs__trigger {
                    height: 2.2rem !important;
                    padding: 0 0.85rem !important;
                    font-size: 0.82rem !important;
                }
            `;
            document.head.appendChild(s);
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun injectModalStyles(webView: WebView) {
        val js = """
        (function() {
            if (document.getElementById('__seanime_modal_styles')) return;

            var s = document.createElement('style');
            s.id = '__seanime_modal_styles';
            s.textContent = `
                /* ── Modal Shell & Top Spacing ── */
                .UI-Modal__content:not(.mobile-workspace) {
                    padding: 3.5rem 0.75rem 1rem 0.75rem !important;
                    max-height: 100svh !important;
                    overflow-y: auto !important;
                    overflow-x: hidden !important; 
                    -webkit-overflow-scrolling: touch !important;
                    width: 100% !important;
                    max-width: 100vw !important;
                    box-sizing: border-box !important;
                }

                .UI-Modal__content > div {
                    max-width: 100% !important;
                    min-width: 0 !important;
                }
                .UI-Modal__content[data-home-settings-modal] {
                    width: calc(100% - 1.5rem) !important;
                    max-width: min(64rem, calc(100vw - 1.5rem)) !important;
                    max-height: calc(100svh - 1.5rem) !important;
                    border-radius: 1rem !important;
                }

                /* ── Banner Adjustment ── */
                .UI-Modal__content .absolute.opacity-30 {
                    height: 7rem !important;
                    top: 1rem !important; 
                }

                /* ── Header Row & Title Truncation ── */
                .UI-Modal__content [data-media-page-header-entry-details="true"] {
                    flex-direction: row !important;
                    align-items: flex-start !important;
                    gap: 0.75rem !important;
                    width: 100% !important;
                    overflow: hidden !important;
                }

                .UI-Modal__content [data-media-page-header-entry-details-cover-image-container="true"] {
                    width: 110px !important;
                    min-width: 110px !important;
                    flex-shrink: 0 !important;
                }

                /* Title truncation */
                .UI-Modal__content [data-media-page-header-entry-details-title-container="true"] {
                    flex: 1 1 auto !important;
                    min-width: 0 !important;
                    overflow: hidden !important;
                }

                .UI-Modal__content [data-media-page-header-entry-details-title-container="true"] div.font-bold {
                    font-size: 1.15rem !important;
                    white-space: nowrap !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    display: block !important;
                    width: 100% !important;
                }

                /* ── Modal-Only Carousel Fix (Relations/Recommendations) ── */
                .UI-Modal__content [data-media-card-grid="true"] {
                    display: flex !important;
                    flex-wrap: nowrap !important;
                    flex-direction: row !important;
                    overflow-x: auto !important;
                    overflow-y: hidden !important;
                    -webkit-overflow-scrolling: touch !important;
                    scroll-snap-type: x mandatory !important;
                    gap: 0.75rem !important;
                    padding: 0.5rem 0 1.5rem 0 !important;
                    width: 100% !important;
                    scrollbar-width: none !important;
                }
                
                .UI-Modal__content [data-media-card-grid="true"]::-webkit-scrollbar {
                    display: none !important;
                }

                /* Poster cards in the modal */
                .UI-Modal__content [data-media-card-grid="true"] > * {
                    flex: 0 0 auto !important;
                    width: 125px !important;
                    max-width: 125px !important;
                    scroll-snap-align: start !important;
                }

                .UI-Modal__content .media-entry-card__body {
                    aspect-ratio: 2/3 !important;
                }

                /* Action buttons list */
                .UI-Modal__content [data-media-page-header-entry-details="true"] ~ div.mt-6 {
                    display: flex !important;
                    flex-wrap: wrap !important;
                    gap: 0.5rem !important;
                }
            `;
            document.head.appendChild(s);
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }
}
