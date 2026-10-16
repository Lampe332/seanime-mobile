package com.seanime.app

import android.webkit.WebView

object UIEntryPatch {

    fun inject(webView: WebView) {
        injectEntryPagePatches(webView)
        injectMoreInfoPanel(webView)
    }

    private fun injectEntryPagePatches(webView: WebView) {
        val js = """
            (function() {
                if (window.__seanime_entry_observer) return;
                window.__seanime_entry_observer = true;

                function isEntryPage() {
                    return /\/entry\?id=/.test(window.location.href);
                }

                function injectCharacterStyles() {
                    if (document.getElementById('__seanime_characters_fix')) return;
                    var s = document.createElement('style');
                    s.id = '__seanime_characters_fix';
                    s.textContent = `
                        [data-media-page-header-entry-details="true"] {
                            flex-direction: row !important;
                            align-items: flex-start !important;
                            gap: 0.85rem !important;
                            flex-wrap: wrap !important;
                        }
                        [data-media-page-header-entry-details-cover-image-container="true"] {
                            max-width: 140px !important;
                            min-width: 140px !important;
                            width: 140px !important;
                            margin: 0 !important;
                            flex-shrink: 0 !important;
                        }
                        [data-media-page-header-entry-details-content="true"] {
                            flex: 1 !important;
                            min-width: 0 !important;
                            overflow: hidden !important;
                        }
                        [data-media-page-header-entry-details-title-container="true"] .font-bold {
                            font-size: 0.88rem !important;
                            line-height: 1.25 !important;
                            text-align: left !important;
                            white-space: nowrap !important;
                            overflow: hidden !important;
                            text-overflow: ellipsis !important;
                            display: block !important;
                            -webkit-line-clamp: unset !important;
                            max-width: 100% !important;
                        }
                        [data-media-page-header-entry-details-title-container="true"] .font-bold > div {
                            white-space: nowrap !important;
                            overflow: hidden !important;
                            text-overflow: ellipsis !important;
                            display: block !important;
                            max-width: 100% !important;
                        }
                        [data-media-page-header-entry-details-title-container="true"] .font-bold > div > span {
                            white-space: nowrap !important;
                        }
                        [data-media-page-header-entry-details-title-container="true"] h4 {
                            text-align: left !important;
                            font-size: 0.68rem !important;
                            white-space: nowrap !important;
                            overflow: hidden !important;
                            text-overflow: ellipsis !important;
                            display: block !important;
                            max-width: 100% !important;
                        }
                        [data-media-page-header-entry-details-date-container="true"] {
                            justify-content: flex-start !important;
                            font-size: 0.78rem !important;
                            flex-wrap: wrap !important;
                            gap: 0.4rem !important;
                        }
                        [data-media-page-header-entry-details-date-container="true"] p {
                            font-size: 0.78rem !important;
                        }
                        [data-media-page-header-entry-details-more-info="true"] {
                            justify-content: flex-start !important;
                            gap: 0.5rem !important;
                            flex-wrap: wrap !important;
                        }
                        /* ── Characters grid ── */
                        [data-media-entry-characters-section-grid="true"] {
                            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                        }
                        [data-media-entry-characters-section-grid-item-container="true"] {
                            gap: 0.5rem !important;
                            padding-top: 0.5rem !important;
                            padding-bottom: 0.5rem !important;
                            padding-right: 0.5rem !important;
                        }
                        [data-media-entry-characters-section-grid-item-image-container="true"] {
                            width: 3rem !important;
                            height: 3rem !important;
                            min-width: 3rem !important;
                            min-height: 3rem !important;
                        }
                        [data-media-entry-characters-section-grid-item-content="true"] p.text-lg {
                            font-size: 0.8rem !important;
                            line-height: 1.1rem !important;
                        }
                        [data-media-entry-characters-section-grid-item-content="true"] p.text-sm {
                            font-size: 0.7rem !important;
                        }
                        [data-media-entry-characters-section-grid-item-content="true"] p.text-xs {
                            font-size: 0.65rem !important;
                        }
                        /* ── Related/recommendations carousels ── */
                        [data-media-card-grid="true"][data-carouselized="true"] {
                            display: flex !important;
                            flex-direction: row !important;
                            flex-wrap: nowrap !important;
                            overflow-x: auto !important;
                            overflow-y: visible !important;
                            gap: 0.75rem !important;
                            padding: 0.5rem 0.25rem 0.75rem 0.25rem !important;
                            scroll-behavior: smooth !important;
                            -webkit-overflow-scrolling: touch !important;
                            scrollbar-width: none !important;
                        }
                        [data-media-card-grid="true"][data-carouselized="true"]::-webkit-scrollbar {
                            display: none !important;
                        }
                        [data-media-card-grid="true"][data-carouselized="true"] .col-span-1 {
                            flex: 0 0 auto !important;
                            width: 180px !important;
                        }
                    `;
                    document.head.appendChild(s);
                }

                function moveScoreBadge() {
                    if (!isEntryPage()) return;
                    var badge = document.querySelector('[data-media-page-header-score-badge="true"]');
                    if (!badge || badge.dataset.seanimeMoved === 'true') return;
                    var statusEl = document.querySelector('[data-media-page-header-entry-details-status="true"]');
                    if (!statusEl || !statusEl.parentElement) return;
                    badge.dataset.seanimeMoved = 'true';
                    statusEl.parentElement.insertBefore(badge, statusEl.nextSibling);
                }

                function carouselizeGrids() {
                    if (!isEntryPage()) return;
                    document.querySelectorAll('[data-media-card-grid="true"]:not([data-carouselized])').forEach(function(grid) {
                        grid.setAttribute('data-carouselized', 'true');
                    });
                }

                var applyTimer = null;
                function applyAll() {
                    if (!isEntryPage() || applyTimer !== null) return;
                    applyTimer = setTimeout(function() {
                        applyTimer = null;
                        injectCharacterStyles();
                        if (isEntryPage()) {
                            carouselizeGrids();
                            moveScoreBadge();
                        }
                    }, 80);
                }

                applyAll();

                var observer = new MutationObserver(function(mutations) {
                    var relevant = mutations.some(function(m) { return m.addedNodes.length > 0; });
                    if (relevant) applyAll();
                });
                observer.observe(document.body, { childList: true, subtree: true });

                var lastHref = window.location.href;
                setInterval(function() {
                    if (window.location.href !== lastHref) {
                        lastHref = window.location.href;
                        setTimeout(applyAll, 300);
                        setTimeout(applyAll, 800);
                        setTimeout(applyAll, 1500);
                    }
                }, 300);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun injectMoreInfoPanel(webView: WebView) {
        val js = """
            (function() {
                if (window.__seanime_moreinfo_init) return;
                window.__seanime_moreinfo_init = true;

                function isEntryPage() {
                    return /\/entry\?id=/.test(window.location.href);
                }

                function injectMoreInfoStyles() {
                    if (document.getElementById('__seanime_moreinfo_styles')) return;
                    var s = document.createElement('style');
                    s.id = '__seanime_moreinfo_styles';
                    s.textContent = `
                        [data-anime-meta-section-rankings-container="true"],
                        [data-media-entry-genres-list="true"],
                        [data-media-entry-audience-score="true"],
                        [data-anime-entry-studio-badge="true"],
                        [data-media-page-header-details-description-trigger="true"] {
                            display: none !important;
                        }

                        #__seanime_moreinfo_wrapper {
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            gap: 0.5rem;
                            width: 100%;
                            margin-top: 0.75rem;
                        }

                        #__seanime_moreinfo_btn {
                            display: inline-flex;
                            align-items: center;
                            gap: 0.3rem;
                            padding: 0.25rem 0.75rem;
                            font-size: 0.72rem;
                            font-weight: 600;
                            letter-spacing: 0.04em;
                            color: rgba(255,255,255,0.4);
                            background: rgba(255,255,255,0.05);
                            border: 1px solid rgba(255,255,255,0.08);
                            border-radius: 999px;
                            cursor: pointer;
                            transition: color 0.18s, background 0.18s;
                            user-select: none;
                            -webkit-user-select: none;
                            flex-shrink: 0;
                        }
                        #__seanime_moreinfo_btn svg {
                            transition: transform 0.22s cubic-bezier(0.4,0,0.2,1);
                            flex-shrink: 0;
                        }
                        #__seanime_moreinfo_btn[data-open="true"] {
                            color: rgba(255,255,255,0.7);
                            background: rgba(255,255,255,0.08);
                        }
                        #__seanime_moreinfo_btn[data-open="true"] svg {
                            transform: rotate(180deg);
                        }

                        #__seanime_moreinfo_panel {
                            overflow: hidden;
                            max-height: 0;
                            opacity: 0;
                            width: 100%;
                            transition: max-height 0.32s cubic-bezier(0.4,0,0.2,1), opacity 0.22s ease;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            gap: 0.6rem;
                            padding-top: 0.25rem;
                        }
                        #__seanime_moreinfo_panel[data-open="true"] {
                            max-height: 600px;
                            opacity: 1;
                        }

                        #__seanime_moreinfo_panel .smi-description {
                            font-size: 0.78rem;
                            line-height: 1.5;
                            color: rgba(255,255,255,0.45);
                            text-align: center;
                            width: 100%;
                            max-height: 5rem;
                            overflow: hidden;
                            position: relative;
                            transition: max-height 0.35s cubic-bezier(0.4,0,0.2,1), color 0.2s ease;
                            cursor: pointer;
                        }
                        #__seanime_moreinfo_panel .smi-description:not([data-expanded="true"])::after {
                            content: "";
                            position: absolute;
                            bottom: 0; left: 0; right: 0;
                            height: 2.5rem;
                            background: linear-gradient(to bottom, transparent, var(--background, #0c0c0c));
                            pointer-events: none;
                        }
                        #__seanime_moreinfo_panel .smi-description[data-expanded="true"] {
                            max-height: 400px;
                            color: rgba(255,255,255,0.6);
                        }

                        #__seanime_moreinfo_panel .smi-sep {
                            height: 1px;
                            background: rgba(255,255,255,0.06);
                            width: 100%;
                        }

                        #__seanime_moreinfo_panel .smi-row {
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-wrap: wrap;
                            gap: 0.35rem;
                            width: 100%;
                        }

                        #__seanime_moreinfo_panel .smi-pill {
                            display: inline-flex;
                            align-items: center;
                            gap: 0.3rem;
                            padding: 0.15rem 0.55rem;
                            border-radius: 999px;
                            font-size: 0.7rem;
                            font-weight: 600;
                            border: 1px solid rgba(255,255,255,0.10);
                            background: rgba(255,255,255,0.04);
                            color: rgba(255,255,255,0.55);
                            white-space: nowrap;
                            text-decoration: none;
                        }
                        #__seanime_moreinfo_panel .smi-pill.smi-score {
                            color: #a5b4fc;
                            border-color: rgba(165,180,252,0.22);
                            background: rgba(165,180,252,0.06);
                        }
                        #__seanime_moreinfo_panel .smi-pill.smi-studio {
                            color: rgba(255,255,255,0.65);
                            border-color: rgba(255,255,255,0.13);
                            background: rgba(255,255,255,0.05);
                            cursor: pointer;
                        }
                        #__seanime_moreinfo_panel .smi-pill svg {
                            width: 11px; height: 11px; flex-shrink: 0;
                        }
                    `;
                    document.head.appendChild(s);
                }

                function buildMoreInfoWidget() {
                    if (!isEntryPage()) return;
                    if (document.getElementById('__seanime_moreinfo_wrapper')) return;

                    var rankingsEl    = document.querySelector('[data-anime-meta-section-rankings-container="true"]');
                    var descTrigger   = document.querySelector('[data-media-page-header-details-description-trigger="true"]');
                    var audienceScore = document.querySelector('[data-media-entry-audience-score="true"]');
                    var studioEl      = document.querySelector('[data-anime-entry-studio-badge="true"]');
                    var genresEl      = document.querySelector('[data-media-entry-genres-list="true"]');

                    if (!rankingsEl && !descTrigger && !audienceScore && !studioEl && !genresEl) return;

                    var rowEl = document.querySelector('[data-media-page-header-entry-details="true"]');
                    if (!rowEl || !rowEl.parentElement) return;

                    var wrapper = document.createElement('div');
                    wrapper.id = '__seanime_moreinfo_wrapper';

                    var btn = document.createElement('button');
                    btn.id = '__seanime_moreinfo_btn';
                    btn.setAttribute('data-open', 'false');
                    btn.innerHTML =
                        '<span>More info</span>' +
                        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
                          '<polyline points="6 9 12 15 18 9"></polyline>' +
                        '</svg>';

                    var panel = document.createElement('div');
                    panel.id = '__seanime_moreinfo_panel';
                    panel.setAttribute('data-open', 'false');

                    // Description
                    if (descTrigger) {
                        var descText = descTrigger.textContent.trim();
                        if (descText) {
                            var descDiv = document.createElement('div');
                            descDiv.className = 'smi-description';
                            descDiv.textContent = descText;
                            descDiv.addEventListener('click', function() {
                                var expanded = descDiv.getAttribute('data-expanded') === 'true';
                                descDiv.setAttribute('data-expanded', expanded ? 'false' : 'true');
                            });
                            panel.appendChild(descDiv);
                            // Skip fade if text fits without overflow
                            setTimeout(function() {
                                if (descDiv.scrollHeight <= descDiv.clientHeight) {
                                    descDiv.setAttribute('data-expanded', 'true');
                                    descDiv.style.cursor = 'default';
                                }
                            }, 50);
                        }
                    }

                    // Score + Studio
                    var hasMeta = audienceScore || studioEl;
                    if (hasMeta) {
                        panel.appendChild(Object.assign(document.createElement('div'), {className: 'smi-sep'}));
                        var metaRow = document.createElement('div');
                        metaRow.className = 'smi-row';
                        if (audienceScore) {
                            var scorePill = document.createElement('span');
                            scorePill.className = 'smi-pill smi-score';
                            scorePill.innerHTML = audienceScore.innerHTML;
                            metaRow.appendChild(scorePill);
                        }
                        if (studioEl) {
                            var studioPill = document.createElement('span');
                            studioPill.className = 'smi-pill smi-studio';
                            studioPill.textContent = studioEl.textContent.trim();
                            studioPill.addEventListener('click', function() {
                                studioEl.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                            });
                            metaRow.appendChild(studioPill);
                        }
                        panel.appendChild(metaRow);
                    }

                    // Rankings
                    if (rankingsEl) {
                        var rankLinks = rankingsEl.querySelectorAll('a');
                        if (rankLinks.length > 0) {
                            panel.appendChild(Object.assign(document.createElement('div'), {className: 'smi-sep'}));
                            var rankRow = document.createElement('div');
                            rankRow.className = 'smi-row';
                            rankLinks.forEach(function(a) {
                                var pill = document.createElement('a');
                                pill.className = 'smi-pill';
                                pill.href = a.href;
                                var iconEl = a.querySelector('svg');
                                if (iconEl) {
                                    var iconWrap = document.createElement('span');
                                    var clonedIcon = iconEl.cloneNode(true);
                                    clonedIcon.setAttribute('width', '11');
                                    clonedIcon.setAttribute('height', '11');
                                    var iconSpanOrig = a.querySelector('.UI-Badge__icon');
                                    if (iconSpanOrig) {
                                        iconWrap.style.color = iconSpanOrig.style.color ||
                                            (iconSpanOrig.className.indexOf('yellow') !== -1 ? '#eab308' :
                                             iconSpanOrig.className.indexOf('pink') !== -1   ? '#ec4899' : 'currentColor');
                                    }
                                    iconWrap.appendChild(clonedIcon);
                                    pill.appendChild(iconWrap);
                                }
                                pill.appendChild(document.createTextNode(a.textContent.trim()));
                                rankRow.appendChild(pill);
                            });
                            panel.appendChild(rankRow);
                        }
                    }

                    // Genres
                    if (genresEl) {
                        var genreLinks = genresEl.querySelectorAll('a');
                        if (genreLinks.length > 0) {
                            panel.appendChild(Object.assign(document.createElement('div'), {className: 'smi-sep'}));
                            var genreRow = document.createElement('div');
                            genreRow.className = 'smi-row';
                            genreLinks.forEach(function(a) {
                                var pill = document.createElement('a');
                                pill.className = 'smi-pill';
                                pill.href = a.href;
                                pill.textContent = a.textContent.trim();
                                genreRow.appendChild(pill);
                            });
                            panel.appendChild(genreRow);
                        }
                    }

                    btn.addEventListener('click', function() {
                        var isOpen = btn.getAttribute('data-open') === 'true';
                        btn.setAttribute('data-open', isOpen ? 'false' : 'true');
                        panel.setAttribute('data-open', isOpen ? 'false' : 'true');
                    });

                    wrapper.appendChild(btn);
                    wrapper.appendChild(panel);

                    rowEl.parentElement.insertBefore(wrapper, rowEl.nextSibling);
                }

                injectMoreInfoStyles();
                buildMoreInfoWidget();

                var observer = new MutationObserver(function(mutations) {
                    var added = mutations.some(function(m) { return m.addedNodes.length > 0; });
                    if (added && isEntryPage()) buildMoreInfoWidget();
                });
                observer.observe(document.body, { childList: true, subtree: true });

                var lastHref = window.location.href;
                setInterval(function() {
                    if (window.location.href !== lastHref) {
                        lastHref = window.location.href;
                        ['__seanime_moreinfo_wrapper', '__seanime_moreinfo_styles'].forEach(function(id) {
                            var el = document.getElementById(id);
                            if (el) el.remove();
                        });
                        window.__seanime_moreinfo_init = false;
                        setTimeout(function() {
                            window.__seanime_moreinfo_init = true;
                            injectMoreInfoStyles();
                            buildMoreInfoWidget();
                        }, 400);
                        setTimeout(buildMoreInfoWidget, 900);
                        setTimeout(buildMoreInfoWidget, 1500);
                    }
                }, 300);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }
}
