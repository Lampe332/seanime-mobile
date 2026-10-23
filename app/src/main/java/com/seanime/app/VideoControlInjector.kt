package com.seanime.app

import android.webkit.WebView

object VideoControlInjector {

    fun inject(view: WebView) {
        injectPlayerBehavior(view)
    }

    // ── Behavior (show/hide, double-tap seek) ─────────────────────────────────

    private fun injectPlayerBehavior(view: WebView) {
        val js = """
        (function() {
            if (window.__seanimeControlPatchActive) return;
            window.__seanimeControlPatchActive = true;

            var HIDE_DELAY_MS = 5000;
            var DOUBLE_TAP_DELAY = 280;
            var hideTimer = null;
            var isScrubbing = false;
            var firstPatch = true;

            var patchedContainer = null;
            var patchedTopBar = null;
            var patchedBottomBar = null;
            var patchedVideo = null;
            var mobileControls = null;

            var lastClickTime = 0;
            var lastClickSide = null;
            var singleTapTimer = null;
            var surfaceTapWasVisible = null;
            var lastPointerDownAt = 0;
            var orientationListenersAttached = false;

            function isEntryRoute() {
                var url = window.location.pathname + window.location.search;
                return url.indexOf('/entry') !== -1 && url.indexOf('id=') !== -1;
            }

            function getTopBar()    { return document.querySelector('[data-vc-element="mobile-control-bar-top-section"]'); }
            function getBottomBar() { return document.querySelector('[data-vc-element="mobile-control-bar-bottom-section"]'); }
            function getContainer() { return document.querySelector('[data-vc-element="container"]'); }
            function getVideo()     { return document.querySelector('video'); }
            function getOverlayParent() {
                return document.fullscreenElement || getContainer() || document.body;
            }

            function attachFullscreenOrientationListeners() {
                if (orientationListenersAttached || !window.OrientationBridge || !window.OrientationBridge.setVideoFullscreen) return;
                orientationListenersAttached = true;

                function syncVideoOrientation() {
                    var fullscreenElement = document.fullscreenElement ||
                        document.webkitFullscreenElement ||
                        document.mozFullScreenElement ||
                        document.msFullscreenElement;
                    window.OrientationBridge.setVideoFullscreen(!!fullscreenElement);
                }

                document.addEventListener('fullscreenchange', syncVideoOrientation, true);
                document.addEventListener('webkitfullscreenchange', syncVideoOrientation, true);
                document.addEventListener('mozfullscreenchange', syncVideoOrientation, true);
                document.addEventListener('MSFullscreenChange', syncVideoOrientation, true);
            }

            function areBarsVisible() {
                var top = getTopBar(); var bot = getBottomBar();
                if (top && bot) return !isHideTransform(top.style.transform) && !isHideTransform(bot.style.transform);
                var controls = getMobileControls();
                return !!(controls && controls.classList.contains('__seanime-visible'));
            }

            function getMobileControls() {
                return document.getElementById('__seanime-mobile-controls');
            }

            function syncPlayButton() {
                var controls = getMobileControls();
                var video = getVideo();
                if (!controls || !video) return;
                var button = controls.querySelector('[data-seanime-action="toggle"]');
                if (!button) return;
                var paused = video.paused;
                var nextState = paused ? 'paused' : 'playing';
                button.setAttribute('aria-label', paused ? 'Play' : 'Pause');
                if (button.getAttribute('data-seanime-play-state') !== nextState) {
                    button.setAttribute('data-seanime-play-state', nextState);
                    button.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="currentColor">' + (paused ? '<path d="M8 5.5v13l11-6.5z"/>' : '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>') + '</svg>';
                }
            }

            function injectMobileControlStyles() {
                if (document.getElementById('__seanime-mobile-control-styles')) return;
                var style = document.createElement('style');
                style.id = '__seanime-mobile-control-styles';
                style.textContent = [
                    '.__seanime-mobile-controls {',
                    '  position: absolute; top: 50%; left: 50%;',
                    '  transform: translate(-50%, -50%);',
                    '  display: flex; align-items: center; justify-content: center;',
                    '  gap: clamp(8px, 3vw, 26px); z-index: 99998;',
                    '  opacity: 0; visibility: hidden; pointer-events: none;',
                    '  transition: opacity 160ms ease;',
                    '  touch-action: manipulation;',
                    '}',
                    '.__seanime-mobile-controls.__seanime-visible {',
                    '  opacity: 1; visibility: visible; pointer-events: auto;',
                    '}',
                    '.__seanime-mobile-control {',
                    '  width: clamp(44px, 11vw, 64px); height: clamp(44px, 11vw, 64px);',
                    '  min-width: 44px; min-height: 44px;',
                    '  display: flex; align-items: center; justify-content: center;',
                    '  border: 0; border-radius: 999px;',
                    '  color: white; background: transparent;',
                    '  box-shadow: none; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.8));',
                    '  font: 600 16px/1 sans-serif;',
                    '  padding: 0; -webkit-tap-highlight-color: transparent;',
                    '}',
                    '.__seanime-mobile-control:active { background: rgba(255,255,255,0.24); transform: scale(0.94); }',
                    '.__seanime-mobile-control.__seanime-main {',
                    '  width: clamp(58px, 15vw, 78px); height: clamp(58px, 15vw, 78px);',
                    '  font-size: clamp(24px, 6vw, 32px);',
                    '  background: rgba(0,0,0,0.22);',
                    '}',
                    '.__seanime-mobile-control svg { pointer-events: none; }',
                    // a tablet keeps the phone controls (the web app's lib/tablet-ui.ts rule)
                    '@media (min-width: ' + (Math.min(screen.width, screen.height) >= 600 ? '100000px' : '1024px') + ') { .__seanime-mobile-controls { display: none !important; } }'
                ].join('\n');
                (document.head || document.documentElement).appendChild(style);
            }

            function showMobileControls() {
                var controls = getMobileControls();
                if (!controls) return;
                controls.classList.add('__seanime-visible');
                syncPlayButton();
            }

            function hideMobileControls() {
                var controls = getMobileControls();
                if (controls) controls.classList.remove('__seanime-visible');
            }

            function ensureMobileControls(container) {
                if (!container) return null;
                injectMobileControlStyles();
                var controls = container.querySelector('#__seanime-mobile-controls');
                if (!controls) {
                    controls = document.createElement('div');
                    controls.id = '__seanime-mobile-controls';
                    controls.className = '__seanime-mobile-controls';
                    controls.setAttribute('aria-label', 'Mobile playback controls');
                    controls.innerHTML =
                        '<button type="button" class="__seanime-mobile-control" data-seanime-mobile-control data-seanime-action="seek" data-seconds="-5" aria-label="Back 5 seconds">&#8722;5</button>' +
                        '<button type="button" class="__seanime-mobile-control __seanime-main" data-seanime-mobile-control data-seanime-action="toggle" aria-label="Play">&#9654;</button>' +
                        '<button type="button" class="__seanime-mobile-control" data-seanime-mobile-control data-seanime-action="seek" data-seconds="10" aria-label="Forward 10 seconds">+10</button>';
                    controls.addEventListener('click', function(e) {
                        var button = e.target && e.target.closest ? e.target.closest('[data-seanime-mobile-control]') : null;
                        if (!button) return;
                        e.preventDefault();
                        e.stopPropagation();
                        var video = getVideo();
                        if (!video) return;
                        var action = button.getAttribute('data-seanime-action');
                        if (action === 'toggle') {
                            if (video.paused) {
                                var playResult = video.play();
                                if (playResult && playResult.catch) playResult.catch(function() {});
                                scheduleHide();
                            } else {
                                video.pause();
                                clearTimeout(hideTimer);
                                showBars();
                            }
                        } else if (action === 'seek') {
                            var seconds = parseInt(button.getAttribute('data-seconds') || '0', 10);
                            seekVideo(seconds);
                            showSeekAnimation(seconds < 0 ? 'left' : 'right', seconds);
                            showBars();
                            scheduleHide();
                        }
                        syncPlayButton();
                    }, true);
                    container.appendChild(controls);
                }
                mobileControls = controls;
                syncPlayButton();
                return controls;
            }

            function isHideTransform(transform) {
                if (!transform || transform === 'none' || transform === '') return false;
                var match = transform.match(/translateY\(([^)]+)\)/);
                if (!match) return false;
                return parseFloat(match[1]) !== 0;
            }

            function showBars() {
                showMobileControls();
                var top = getTopBar(); var bot = getBottomBar();
                if (!top || !bot) return;
                top.__seanimeHidden = false; bot.__seanimeHidden = false;
                top.__seanimeOurControl = true; bot.__seanimeOurControl = true;
                top.style.transform = 'translateY(0px)';
                bot.style.transform = 'translateY(0px)';
            }

            function hideBars() {
                if (isScrubbing) return;
                hideMobileControls();
                var top = getTopBar(); var bot = getBottomBar();
                if (!top || !bot) return;
                top.__seanimeHidden = true; bot.__seanimeHidden = true;
                top.__seanimeOurControl = true; bot.__seanimeOurControl = true;
                top.style.transform = 'translateY(-100%)';
                bot.style.transform = 'translateY(100%)';
            }

            function scheduleHide() {
                clearTimeout(hideTimer);
                if (isScrubbing) return;
                hideTimer = setTimeout(hideBars, HIDE_DELAY_MS);
            }

            function isProgressBarTarget(el) {
                if (!el) return false;
                var cur = el;
                for (var i = 0; i < 6; i++) {
                    if (!cur) break;
                    var role   = cur.getAttribute ? (cur.getAttribute('role') || '') : '';
                    var dataVc = cur.getAttribute ? (cur.getAttribute('data-vc-element') || '') : '';
                    if (dataVc === 'mobile-control-bar-bottom-section' ||
                        dataVc === 'mobile-control-bar-top-section' ||
                        dataVc === 'container') break;
                    if (role === 'slider' || role === 'progressbar') return true;
                    if (dataVc.indexOf('progress') !== -1 ||
                        dataVc.indexOf('seek') !== -1 ||
                        dataVc.indexOf('slider') !== -1 ||
                        dataVc === 'time-range') return true;
                    var cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
                    if (cls.indexOf('scrub') !== -1 || cls.indexOf('seek') !== -1) return true;
                    if ((cur.tagName || '').toLowerCase() === 'input' &&
                        cur.getAttribute('type') === 'range') return true;
                    cur = cur.parentElement;
                }
                return false;
            }

            function isInteractivePlayerTarget(el) {
                if (!el || !el.closest) return false;
                if (isProgressBarTarget(el)) return true;
                return !!el.closest(
                    '[data-seanime-mobile-controls], [data-seanime-mobile-control], ' +
                    '[data-vc-element="control-button"], button, a, input, select, textarea, ' +
                    '[role="button"], [role="menuitem"], [role="menu"], [data-radix-popper-content-wrapper]'
                );
            }

            function isSurfaceTapTarget(el) {
                var container = getContainer();
                if (!container || !el || !container.contains(el)) return false;
                return !isInteractivePlayerTarget(el);
            }

            function isVideoSurfaceElement(el) {
                if (!el || !el.closest) return false;
                var video = getVideo();
                return el === video || !!el.closest('video') || !!el.closest('[data-vc-element="inner-container"]');
            }

            // ── Seek animation ────────────────────────────────────────────────

            function injectSeekStyles() {
                if (document.getElementById('__seanime-seek-styles')) return;
                var style = document.createElement('style');
                style.id = '__seanime-seek-styles';
                style.textContent = [
                    '.__seanime-seek-overlay {',
                    '  position: absolute; top: 50%;',
                    '  transform: translateY(-50%) scale(0.85);',
                    '  width: 110px; height: 190px;',
                    '  display: flex; flex-direction: column;',
                    '  align-items: center; justify-content: center;',
                    '  pointer-events: none; z-index: 99999;',
                    '  background: rgba(255,255,255,0.18);',
                    '  opacity: 0;',
                    '  animation: __seanime-seek-pop 0.85s cubic-bezier(0.4,0,0.2,1) forwards;',
                    '}',
                    '.__seanime-seek-left  { left: 0;  border-radius: 0 999px 999px 0; }',
                    '.__seanime-seek-right { right: 0; border-radius: 999px 0 0 999px; }',
                    '@keyframes __seanime-seek-pop {',
                    '  0%   { opacity: 0;   transform: translateY(-50%) scale(0.8);  }',
                    '  18%  { opacity: 1;   transform: translateY(-50%) scale(1.05); }',
                    '  30%  { opacity: 1;   transform: translateY(-50%) scale(1);    }',
                    '  72%  { opacity: 1;   transform: translateY(-50%) scale(1);    }',
                    '  100% { opacity: 0;   transform: translateY(-50%) scale(0.92); }',
                    '}',
                    '.__seanime-seek-arrows { display: flex; gap: 1px; margin-bottom: 10px; }',
                    '.__seanime-seek-arrow {',
                    '  color: white; font-size: 22px; opacity: 0;',
                    '  animation: __seanime-arrow-wave 0.55s ease forwards;',
                    '}',
                    '.__seanime-seek-arrow:nth-child(1) { animation-delay: 0.05s; }',
                    '.__seanime-seek-arrow:nth-child(2) { animation-delay: 0.15s; }',
                    '.__seanime-seek-arrow:nth-child(3) { animation-delay: 0.25s; }',
                    '@keyframes __seanime-arrow-wave {',
                    '  0%   { opacity: 0;   transform: scale(0.7); }',
                    '  45%  { opacity: 1;   transform: scale(1.1); }',
                    '  100% { opacity: 0.5; transform: scale(1);   }',
                    '}',
                    '.__seanime-seek-label {',
                    '  color: white; font-size: 13px; font-weight: 700;',
                    '  font-family: sans-serif; text-shadow: 0 1px 4px rgba(0,0,0,0.5);',
                    '  letter-spacing: 0.3px;',
                    '}'
                ].join('\n');
                (document.head || document.documentElement).appendChild(style);
            }

            function showSeekAnimation(side, seconds) {
                injectSeekStyles();
                if (typeof seconds !== 'number') seconds = side === 'right' ? 10 : -10;
                var existing = document.getElementById('__seanime-seek-anim');
                if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

                var parent = getOverlayParent();
                var ps = window.getComputedStyle(parent).position;
                if (ps === 'static') parent.style.position = 'relative';

                var el = document.createElement('div');
                el.id = '__seanime-seek-anim';
                el.className = '__seanime-seek-overlay __seanime-seek-' + side;
                var arrow = side === 'right' ? '\u25B6' : '\u25C0';
                el.innerHTML =
                    '<div class="__seanime-seek-arrows">' +
                        '<span class="__seanime-seek-arrow">' + arrow + '</span>' +
                        '<span class="__seanime-seek-arrow">' + arrow + '</span>' +
                        '<span class="__seanime-seek-arrow">' + arrow + '</span>' +
                    '</div>' +
                        '<div class="__seanime-seek-label">' + (seconds > 0 ? '+' : '') + seconds + 's</div>';
                parent.appendChild(el);
                setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 900);
            }

            function seekVideo(seconds) {
                var video = getVideo();
                if (!video) return;
                var nextTime = Math.max(0, video.currentTime + seconds);
                if (isFinite(video.duration) && video.duration > 0) nextTime = Math.min(video.duration, nextTime);
                video.currentTime = nextTime;
            }

            // ── Scrubbing listeners ───────────────────────────────────────────

            var scrubbingListenersAttached = false;
            function attachScrubbingListeners() {
                if (scrubbingListenersAttached) return;
                scrubbingListenersAttached = true;

                function onScrubStart(e) {
                    if (!isEntryRoute()) return;
                    if (isProgressBarTarget(e.target)) {
                        isScrubbing = true;
                        clearTimeout(hideTimer);
                        showBars();
                    }
                }
                function onScrubEnd() {
                    if (!isScrubbing) return;
                    isScrubbing = false;
                    scheduleHide();
                }

                document.addEventListener('pointerdown',   onScrubStart, { capture: true, passive: true });
                document.addEventListener('touchstart',    onScrubStart, { capture: true, passive: true });
                document.addEventListener('pointerup',     onScrubEnd,   { capture: true, passive: true });
                document.addEventListener('pointercancel', onScrubEnd,   { capture: true, passive: true });
                document.addEventListener('touchend',      onScrubEnd,   { capture: true, passive: true });
                document.addEventListener('touchcancel',   onScrubEnd,   { capture: true, passive: true });
            }

            var activityListenersAttached = false;
            function attachActivityListeners() {
                if (activityListenersAttached) return;
                activityListenersAttached = true;

                function onPlayerActivity(e) {
                    if (!isEntryRoute()) return;
                    var container = getContainer();
                    var target = e.target;
                    var inPlayer = container && container.contains(target);
                    var inPlayerMenu = target && target.closest && target.closest('[role="menu"], [data-radix-popper-content-wrapper], [data-vc-element*="menu"]');
                    if (!inPlayer && !inPlayerMenu) return;

                    // Capture whether this surface tap started with the hub open.
                    // Android may emit both pointerdown and touchstart, so the
                    // second event must not overwrite the first state.
                    var isSurfaceTap = isSurfaceTapTarget(target);
                    if (e.type === 'pointerdown') {
                        lastPointerDownAt = Date.now();
                        surfaceTapWasVisible = isSurfaceTap ? areBarsVisible() : null;
                    } else if (e.type === 'touchstart' && Date.now() - lastPointerDownAt > 500) {
                        surfaceTapWasVisible = isSurfaceTap ? areBarsVisible() : null;
                    }

                    // Do not expose buttons between touchstart and the synthetic
                    // click: Android can hit-test that click against the new UI.
                    // Reveal a hidden hub only after its opening click is consumed.
                    if (isSurfaceTap) {
                        clearTimeout(hideTimer);
                        return;
                    }
                    showBars();
                    scheduleHide();
                }

                document.addEventListener('pointerdown', onPlayerActivity, { capture: true, passive: true });
                document.addEventListener('touchstart', onPlayerActivity, { capture: true, passive: true });
            }

            // ── Tap / double-tap listener ─────────────────────────────────────

            var clickListenerAttached = false;
            function attachClickListener() {
                if (clickListenerAttached) return;
                clickListenerAttached = true;

                document.addEventListener('dblclick', function(e) {
                    if (!isEntryRoute()) return;
                    var container = getContainer();
                    if (!container || !container.contains(e.target)) return;
                    e.preventDefault();
                    e.stopPropagation();
                }, true);

                document.addEventListener('click', function(e) {
                    if (!isEntryRoute()) return;
                    var container = getContainer();
                    if (!container || !container.contains(e.target)) return;
                    if (surfaceTapWasVisible === false) {
                        surfaceTapWasVisible = null;
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        clearTimeout(singleTapTimer);
                        lastClickTime = 0;
                        showBars();
                        scheduleHide();
                        return;
                    }
                    var mobileControl = e.target && e.target.closest ? e.target.closest('[data-seanime-mobile-control]') : null;
                    if (mobileControl) return;
                    if (isInteractivePlayerTarget(e.target)) {
                        surfaceTapWasVisible = null;
                        return;
                    }

                    var tapStartedWithHubVisible = surfaceTapWasVisible;
                    surfaceTapWasVisible = null;
                    // Synthetic/desktop-style clicks may arrive without a
                    // preceding pointerdown; use the current hub state then.
                    if (tapStartedWithHubVisible === null) tapStartedWithHubVisible = areBarsVisible();

                    // The React player toggles play from the video's click handler.
                    // On Android a tap is used to reveal controls, so consume free
                    // player-area clicks and leave real control buttons alone.
                    var innerContainer = e.target && e.target.closest ? e.target.closest('[data-vc-element="inner-container"]') : null;
                    var videoSurface = isVideoSurfaceElement(e.target);
                    e.preventDefault();
                    e.stopPropagation();

                    // A free area outside the inner video surface only opens or
                    // closes the hub; double-tap seek remains limited to video.
                    if (!innerContainer && !videoSurface) {
                        if (tapStartedWithHubVisible) {
                            clearTimeout(hideTimer);
                            hideBars();
                        } else {
                            showBars();
                            scheduleHide();
                        }
                        return;
                    }

                    var now = Date.now();
                    var rect = container.getBoundingClientRect();
                    var side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
                    var isDouble = (now - lastClickTime) < DOUBLE_TAP_DELAY && side === lastClickSide;

                    lastClickTime = now;
                    lastClickSide = side;

                    if (isDouble) {
                        clearTimeout(singleTapTimer);
                        lastClickTime = 0;
                        seekVideo(side === 'right' ? 10 : -10);
                        showSeekAnimation(side);
                        showBars();
                        scheduleHide();
                        return;
                    }

                    clearTimeout(singleTapTimer);
                    singleTapTimer = setTimeout(function() {
                        if (tapStartedWithHubVisible) {
                            clearTimeout(hideTimer);
                            hideBars();
                        } else {
                            showBars();
                            scheduleHide();
                        }
                    }, DOUBLE_TAP_DELAY);
                }, true);
            }

            function watchBar(el, hideValue) {
                new MutationObserver(function(mutations) {
                    mutations.forEach(function(m) {
                        if (m.attributeName !== 'style') return;
                        if (!isEntryRoute()) return;
                        if (el.__seanimeOurControl) { el.__seanimeOurControl = false; return; }
                        el.__seanimeOurControl = true;
                        el.style.transform = el.__seanimeHidden ? hideValue : 'translateY(0px)';
                    });
                }).observe(el, { attributes: true, attributeFilter: ['style'] });
            }

            function patchPlayer() {
                if (!isEntryRoute()) return;
                var topBar    = getTopBar();
                var bottomBar = getBottomBar();
                var container = getContainer();
                var video     = getVideo();
                if (!topBar || !bottomBar || !container) return;

                var nodesReplaced = (topBar    !== patchedTopBar) ||
                                    (bottomBar !== patchedBottomBar) ||
                                    (container !== patchedContainer);
                if (nodesReplaced) {
                    patchedTopBar    = topBar;
                    patchedBottomBar = bottomBar;
                    patchedContainer = container;

                    watchBar(topBar,    'translateY(-100%)');
                    watchBar(bottomBar, 'translateY(100%)');

                    if (!('__seanimeHidden' in topBar))
                        Object.defineProperty(topBar,    '__seanimeHidden', { value: false, writable: true, configurable: true });
                    if (!('__seanimeHidden' in bottomBar))
                        Object.defineProperty(bottomBar, '__seanimeHidden', { value: false, writable: true, configurable: true });
                }

                ensureMobileControls(container);
                if (patchedVideo !== video) {
                    if (patchedVideo) {
                        patchedVideo.removeEventListener('play', syncPlayButton);
                        patchedVideo.removeEventListener('pause', syncPlayButton);
                        patchedVideo.removeEventListener('ended', syncPlayButton);
                    }
                    patchedVideo = video;
                    if (patchedVideo) {
                        patchedVideo.addEventListener('play', syncPlayButton);
                        patchedVideo.addEventListener('pause', syncPlayButton);
                        patchedVideo.addEventListener('ended', syncPlayButton);
                    }
                }

                if (firstPatch) { firstPatch = false; scheduleHide(); }
            }

            attachScrubbingListeners();
            attachActivityListeners();
            attachClickListener();
            attachFullscreenOrientationListeners();

            function onRouteChange() {
                patchedContainer = null;
                patchedTopBar    = null;
                patchedBottomBar = null;
                if (patchedVideo) {
                    patchedVideo.removeEventListener('play', syncPlayButton);
                    patchedVideo.removeEventListener('pause', syncPlayButton);
                    patchedVideo.removeEventListener('ended', syncPlayButton);
                }
                patchedVideo = null;
                mobileControls = null;
                firstPatch = true;
                setTimeout(patchPlayer, 500);
            }

            var _pushState = history.pushState.bind(history);
            history.pushState = function() { _pushState.apply(history, arguments); onRouteChange(); };
            var _replaceState = history.replaceState.bind(history);
            history.replaceState = function() { _replaceState.apply(history, arguments); onRouteChange(); };
            window.addEventListener('popstate', onRouteChange);

            new MutationObserver(patchPlayer).observe(document.body, { childList: true, subtree: true });
            patchPlayer();
        })();
        """.trimIndent()

        view.evaluateJavascript(js, null)
    }
}
