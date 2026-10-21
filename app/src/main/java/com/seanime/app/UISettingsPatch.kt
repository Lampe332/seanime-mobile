package com.seanime.app

import android.webkit.WebView

object UISettingsPatch {

    fun inject(webView: WebView) {
        injectSettingsFix(webView)
        injectSettingsMenuFix(webView)
    }

    private fun injectSettingsFix(webView: WebView) {
        val js = """
            (function() {
                var style = document.getElementById('__seanime_settings_fix');
                if (style) return;
                style = document.createElement('style');
                style.id = '__seanime_settings_fix';
                style.textContent = `
                    [data-open-issue-recorder-button="true"] {
                        transform: none !important;
                        transition: background-color 0.2s ease, box-shadow 0.2s ease !important;
                    }
                    [data-open-issue-recorder-button="true"]:hover {
                        transform: none !important;
                    }
                    .UI-Card__content .pb-3.flex.gap-2 {
                        flex-wrap: wrap !important;
                        overflow: hidden !important;
                    }
                    .UI-Card__content .pb-3.flex.gap-2 button {
                        flex-shrink: 1 !important;
                        min-width: 0 !important;
                        max-width: 100% !important;
                    }
                `;
                document.head.appendChild(style);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun injectSettingsMenuFix(webView: WebView) {
        val js = """
            (function() {
                if (window.__seanime_settings_menu_init) return;
                window.__seanime_settings_menu_init = true;
                function ensureDonateHideStyle() {
                    if (document.getElementById('__seanime_donate_hide')) return;
                    var style = document.createElement('style');
                    style.id = '__seanime_donate_hide';
                    style.textContent = '[data-seanime-donate="true"] { display: none !important; }';
                    document.head.appendChild(style);
                }
                ensureDonateHideStyle();

                function tagDonateButtons() {
                    if (!isSettingsPage()) return;
                    var ourDrawer = document.getElementById('__seanime_drawer');
                    document.querySelectorAll('button.UI-Button_root, button').forEach(function(btn) {
                        if (ourDrawer && ourDrawer.contains(btn)) return;
                        if (btn.dataset.seanimeOwned === 'true') return;
                        var isDonate = btn.textContent.trim() === 'Donate' ||
                            Array.from(btn.querySelectorAll('span')).some(function(s) {
                                return s.textContent.trim() === 'Donate';
                            });
                        if (isDonate) btn.setAttribute('data-seanime-donate', 'true');
                    });
                }

                function isSettingsPage() {
                    return /\/settings/.test(window.location.href);
                }

                // The phone settings screen has its own navigation: no drawer, no grip.
                function isPhoneSettingsScreen() {
                    return !!document.querySelector('[data-phone-screen="settings"]');
                }

                var backListener = null;
                function setBackListener(listener) {
                    if (backListener) window.removeEventListener('seanime:android-back', backListener);
                    backListener = listener;
                    if (listener) window.addEventListener('seanime:android-back', listener);
                }

                function cleanupDrawer() {
                    setBackListener(null);
                    ['__seanime_drawer', '__seanime_backdrop', '__seanime_drawer_tab'].forEach(function(id) {
                        var el = document.getElementById(id);
                        if (el) el.remove();
                    });
                    var origNav = document.querySelector('.overflow-x-none.overflow-y-hidden');
                    if (origNav) {
                        origNav.style.removeProperty('position');
                        origNav.style.removeProperty('top');
                        origNav.style.removeProperty('left');
                        origNav.style.removeProperty('visibility');
                        origNav.style.removeProperty('pointer-events');
                    }
                }

                function buildDrawer() {
                    if (!isSettingsPage()) return;
                    if (isPhoneSettingsScreen()) {
                        if (document.getElementById('__seanime_drawer_tab') || document.getElementById('__seanime_drawer')) cleanupDrawer();
                        return;
                    }
                    if (document.getElementById('__seanime_drawer_tab')) return;

                    var triggers = document.querySelectorAll('.UI-Tabs__trigger');
                    if (triggers.length === 0) return;

                    var origNav = document.querySelector('.overflow-x-none.overflow-y-hidden');
                    if (!origNav) return;

                    origNav.style.setProperty('position', 'fixed', 'important');
                    origNav.style.setProperty('top', '-9999px', 'important');
                    origNav.style.setProperty('left', '-9999px', 'important');
                    origNav.style.setProperty('pointer-events', 'auto', 'important');
                    origNav.style.setProperty('visibility', 'hidden', 'important');

                    var backdrop = document.createElement('div');
                    backdrop.id = '__seanime_backdrop';
                    backdrop.style.cssText = [
                        'position:fixed','inset:0','z-index:9999',   // increased from 998
                        'background:rgba(0,0,0,0.6)','opacity:0',
                        'pointer-events:none','transition:opacity 0.25s ease'
                    ].join(';');
                    document.body.appendChild(backdrop);

                    var drawer = document.createElement('div');
                    drawer.id = '__seanime_drawer';
                    drawer.style.cssText = [
                        'position:fixed','top:0','left:0','height:100%',
                        'width:75vw','max-width:300px','z-index:10000',   // increased from 999
                        'transform:translateX(-100%)',
                        'transition:transform 0.28s cubic-bezier(0.4,0,0.2,1)',
                        'background:rgba(10,10,15,0.55)',
                        'backdrop-filter:blur(24px)','-webkit-backdrop-filter:blur(24px)',
                        'border-right:1px solid rgba(255,255,255,0.07)',
                        'display:flex','flex-direction:column','overflow-y:auto','overflow-x:hidden'
                    ].join(';');

                    var header = document.createElement('div');
                    header.style.cssText = 'padding:1.5rem 1.25rem 1.1rem;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';
                    header.innerHTML = '<p style="margin:0;font-size:1.1rem;font-weight:700;color:white;">Settings</p>';
                    drawer.appendChild(header);

                    var groups = origNav.querySelectorAll('.UI-Card__root');
                    groups.forEach(function(group, gi) {
                        var btns = group.querySelectorAll('.UI-Tabs__trigger');
                        if (btns.length === 0) return;
                        if (gi > 0) {
                            var sep = document.createElement('div');
                            sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.06);margin:0.15rem 0;flex-shrink:0;';
                            drawer.appendChild(sep);
                        }
                        btns.forEach(function(btn) {
                            var svgEl = btn.querySelector('svg');
                            var label = btn.textContent.trim();
                            var isActive = btn.getAttribute('data-state') === 'active';

                            var item = document.createElement('button');
                            item.setAttribute('data-drawer-for', btn.id);
                            item.dataset.seanimeOwned = 'true';
                            item.style.cssText = [
                                'display:flex','align-items:center','gap:0.85rem','width:100%',
                                'padding:0.8rem 1.25rem',
                                'background:' + (isActive ? 'rgba(255,255,255,0.06)' : 'transparent'),
                                'border:none',
                                'border-left:3px solid ' + (isActive ? 'var(--brand,#818cf8)' : 'transparent'),
                                'color:' + (isActive ? 'white' : 'rgba(255,255,255,0.45)'),
                                'font-size:0.92rem','font-weight:' + (isActive ? '600' : '400'),
                                'text-align:left','cursor:pointer','flex-shrink:0','box-sizing:border-box'
                            ].join(';');

                            var iconSpan = document.createElement('span');
                            iconSpan.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-shrink:0;width:20px;height:20px;opacity:' + (isActive ? '1' : '0.5') + ';';
                            if (svgEl) {
                                var clonedSvg = svgEl.cloneNode(true);
                                clonedSvg.setAttribute('width', '20');
                                clonedSvg.setAttribute('height', '20');
                                clonedSvg.style.cssText = 'width:20px;height:20px;flex-shrink:0;';
                                iconSpan.appendChild(clonedSvg);
                            }

                            var labelSpan = document.createElement('span');
                            labelSpan.textContent = label;
                            labelSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

                            item.appendChild(iconSpan);
                            item.appendChild(labelSpan);

                            item.addEventListener('click', function() {
                                origNav.style.setProperty('visibility', 'visible', 'important');
                                var realBtn = document.getElementById(item.getAttribute('data-drawer-for'));
                                if (realBtn) {
                                    realBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, cancelable:true}));
                                    realBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true}));
                                    realBtn.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, cancelable:true}));
                                    realBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true}));
                                    realBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
                                }
                                setTimeout(function() {
                                    origNav.style.setProperty('visibility', 'hidden', 'important');
                                }, 50);
                                drawer.querySelectorAll('[data-drawer-for]').forEach(function(i) {
                                    i.style.background = 'transparent';
                                    i.style.borderLeft = '3px solid transparent';
                                    i.style.color = 'rgba(255,255,255,0.45)';
                                    i.style.fontWeight = '400';
                                    var ico = i.querySelector('span:first-child');
                                    if (ico) ico.style.opacity = '0.5';
                                });
                                item.style.background = 'rgba(255,255,255,0.06)';
                                item.style.borderLeft = '3px solid var(--brand,#818cf8)';
                                item.style.color = 'white';
                                item.style.fontWeight = '600';
                                var ico = item.querySelector('span:first-child');
                                if (ico) ico.style.opacity = '1';
                            });

                            drawer.appendChild(item);
                        });
                    });

                    document.body.appendChild(drawer);
                    tagDonateButtons();

                    var drawerW = Math.min(window.innerWidth * 0.75, 300);
                    var isOpen = false;

                    var tab = document.createElement('button');
                    tab.id = '__seanime_drawer_tab';
                    tab.dataset.seanimeOwned = 'true';
                    tab.style.cssText = [
                        'position:fixed','left:0','top:50%','transform:translateY(-50%)',
                        'z-index:10001',  // increased from 1000
                        'width:20px','height:56px',
                        'background:rgba(255,255,255,0.07)',
                        'backdrop-filter:blur(12px)','-webkit-backdrop-filter:blur(12px)',
                        'border:1px solid rgba(255,255,255,0.10)','border-left:none',
                        'border-radius:0 8px 8px 0','color:rgba(255,255,255,0.6)',
                        'display:flex','align-items:center','justify-content:center',
                        'cursor:pointer','padding:0',
                        'transition:left 0.28s cubic-bezier(0.4,0,0.2,1)','box-sizing:border-box'
                    ].join(';');

                    function setArrow(pointRight) {
                        tab.innerHTML = pointRight
                            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
                            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
                    }
                    setArrow(true);

                    // Android Back closes the open drawer before it leaves /settings.
                    function onBack(event) {
                        event.preventDefault();
                        closeDrawer();
                    }
                    function openDrawer() {
                        isOpen = true;
                        drawer.style.transform = 'translateX(0)';
                        backdrop.style.opacity = '1';
                        backdrop.style.pointerEvents = 'auto';
                        tab.style.left = drawerW + 'px';
                        setArrow(false);
                        setBackListener(onBack);
                    }
                    function closeDrawer() {
                        isOpen = false;
                        setBackListener(null);
                        drawer.style.transform = 'translateX(-100%)';
                        backdrop.style.opacity = '0';
                        backdrop.style.pointerEvents = 'none';
                        tab.style.left = '0';
                        setArrow(true);
                    }

                    tab.addEventListener('click', function() { if (isOpen) closeDrawer(); else openDrawer(); });
                    backdrop.addEventListener('click', closeDrawer);
                    document.body.appendChild(tab);
                }

                buildDrawer();

                var observer = new MutationObserver(function(mutations) {
                    var added = mutations.some(function(m) { return m.addedNodes.length > 0; });
                    if (added) { tagDonateButtons(); buildDrawer(); }
                });
                observer.observe(document.body, { childList: true, subtree: true });

                var lastHref = window.location.href;
                setInterval(function() {
                    if (window.location.href !== lastHref) {
                        lastHref = window.location.href;
                        cleanupDrawer();
                        setTimeout(buildDrawer, 400);
                        setTimeout(buildDrawer, 900);
                    }
                }, 300);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }
}
