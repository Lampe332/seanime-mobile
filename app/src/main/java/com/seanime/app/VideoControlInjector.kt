package com.seanime.app

import android.webkit.WebView

object VideoControlInjector {

    fun inject(view: WebView) {
        val js = """
        (function() {
            if (window.__seanimeControlPatchActive) return;
            window.__seanimeControlPatchActive = true;

            var HIDE_DELAY_MS = 5000;
            var DOUBLE_TAP_DELAY = 280;
            var LONG_PRESS_DELAY = 450;
            var hideTimer = null;
            // a swipe or long press ends in a click that must not toggle the controls
            var suppressClickUntil = 0;
            var hadPlayer = false;
            var isScrubbing = false;
            var firstPatch = true;

            var patchedContainer = null;
            var patchedTopBar = null;
            var patchedBottomBar = null;
            var patchedVideo = null;

            var lastClickTime = 0;
            var lastClickSide = null;
            var singleTapTimer = null;
            var surfaceTapWasVisible = null;
            var lastPointerDownAt = 0;
            var orientationListenersAttached = false;

            // Any open player, not only the one on an anime page: the native player opens over
            // whatever page started it (Home, Continue watching, Nakama, auto next). The mini player keeps its own taps.
            function hasPlayer() {
                var container = getContainer();
                return !!container && container.getAttribute('data-vc-mini') !== 'true';
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

            // The centre buttons (back, play/pause, forward) are part of the web player (MediaCoreCenterControlsView);
            // this script only shows and hides them with the bars.
            function getMobileControls() {
                return document.getElementById('__seanime-mobile-controls');
            }

            function showMobileControls() {
                var controls = getMobileControls();
                if (controls) controls.classList.add('__seanime-visible');
            }

            function hideMobileControls() {
                var controls = getMobileControls();
                if (controls) controls.classList.remove('__seanime-visible');
            }

            // Paused: keep the controls up. Playing: let them fade after the idle delay.
            function onPlaybackStateChange() {
                if (!hasPlayer()) return;
                var video = getVideo();
                if (!video) return;
                if (video.paused) {
                    clearTimeout(hideTimer);
                    showBars();
                } else {
                    scheduleHide();
                }
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
                hideTimer = setTimeout(function() {
                    // a paused video keeps its controls until the viewer taps them away
                    var video = getVideo();
                    if (video && video.paused && !video.ended) return;
                    // an open player menu keeps the bars: hiding them moves the menu under the finger
                    if (document.querySelector('[data-radix-popper-content-wrapper], .vc-cast-backdrop')) return scheduleHide();
                    hideBars();
                }, HIDE_DELAY_MS);
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
                    '[data-seanime-mobile-control], ' +
                    '[data-vc-element="control-button"], button, a, input, select, textarea, ' +
                    '[role="button"], [role="menuitem"], [role="menu"], [data-radix-popper-content-wrapper], .vc-cast-backdrop'
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
                    if (!hasPlayer()) return;
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
                    if (!hasPlayer()) return;
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

            // ── Swipe gestures: brightness (left half), volume (right half), long press = 2x ──
            // Only on the full player: swiping the small player on an anime page still scrolls the page.

            var GESTURE_ICONS = {
                brightness: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
                volume: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>'
            };

            function injectGestureStyles() {
                if (document.getElementById('__seanime-gesture-styles')) return;
                var style = document.createElement('style');
                style.id = '__seanime-gesture-styles';
                style.textContent = [
                    '.__seanime-gesture-hud { position: absolute; top: 50%; transform: translateY(-50%); z-index: 70; display: flex; align-items: center; gap: 8px;',
                    '  padding: 10px 16px; border-radius: 999px; background: rgba(0,0,0,.66); color: #fff; font: 600 15px/1 system-ui, sans-serif; pointer-events: none; transition: opacity .2s; }',
                    '.__seanime-gesture-left { left: 8%; }',
                    '.__seanime-gesture-right { right: 8%; }',
                    '.__seanime-gesture-center { left: 50%; top: 12%; transform: translateX(-50%); }'
                ].join('\n');
                document.head.appendChild(style);
            }

            function showGestureHud(side, text, kind) {
                var container = getContainer();
                if (!container) return;
                injectGestureStyles();
                var el = document.getElementById('__seanime-gesture-hud');
                if (!el) { el = document.createElement('div'); el.id = '__seanime-gesture-hud'; }
                if (el.parentNode !== container) container.appendChild(el);
                el.className = '__seanime-gesture-hud __seanime-gesture-' + side;
                el.innerHTML = (kind ? GESTURE_ICONS[kind] : '') + '<span>' + text + '</span>';
                el.style.opacity = '1';
            }

            function hideGestureHud() {
                var el = document.getElementById('__seanime-gesture-hud');
                if (el) el.style.opacity = '0';
            }

            var gestureListenersAttached = false;
            function attachGestureListeners() {
                var bridge = window.SeanimeGestures;
                if (gestureListenersAttached || !bridge) return;
                gestureListenersAttached = true;
                var start = null;
                var longPressTimer = null;
                var rateBeforeBoost = null;

                // the full player, or the page's inline player once it fills the screen
                function onFullPlayer() {
                    var container = getContainer();
                    if (!hasPlayer()) return false;
                    var fullscreen = document.fullscreenElement;
                    // data-vc-fullscreen also covers the player's in-page fullscreen (no browser fullscreen element)
                    return container.getAttribute('data-vc-inline') !== 'true' || container.getAttribute('data-vc-fullscreen') === 'true' ||
                        !!(fullscreen && fullscreen.contains(container));
                }

                document.addEventListener('touchstart', function(e) {
                    start = null;
                    clearTimeout(longPressTimer);
                    if (e.touches.length !== 1 || !onFullPlayer() || !isSurfaceTapTarget(e.target)) return;
                    var touch = e.touches[0];
                    var rect = getContainer().getBoundingClientRect();
                    start = { x: touch.clientX, y: touch.clientY, height: rect.height, kind: null, value: 0,
                              side: touch.clientX < rect.left + rect.width / 2 ? 'left' : 'right' };
                    longPressTimer = setTimeout(function() {
                        var video = getVideo();
                        if (!start || start.kind || !video || video.paused) return;
                        start.kind = 'boost';
                        rateBeforeBoost = video.playbackRate;
                        video.playbackRate = 2;
                        showGestureHud('center', '2x', null);
                        if (window.SeanimeAndroid && window.SeanimeAndroid.haptic) window.SeanimeAndroid.haptic('long');
                    }, LONG_PRESS_DELAY);
                }, { capture: true, passive: true });

                document.addEventListener('touchmove', function(e) {
                    if (!start || e.touches.length !== 1 || start.kind === 'boost') return;
                    var touch = e.touches[0];
                    var dx = touch.clientX - start.x;
                    var dy = start.y - touch.clientY;
                    if (!start.kind) {
                        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(longPressTimer);
                        // vertical only: sideways swipes stay free
                        if (Math.abs(dy) < 24 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
                        start.kind = start.side === 'left' ? 'brightness' : 'volume';
                        start.value = start.kind === 'brightness' ? bridge.getBrightness() : bridge.getVolume();
                        start.y = touch.clientY;
                        dy = 0;
                    }
                    var value = Math.max(0, Math.min(1, start.value + dy / (start.height * 0.75)));
                    if (start.kind === 'brightness') bridge.setBrightness(value); else bridge.setVolume(value);
                    showGestureHud(start.side, Math.round(value * 100) + ' %', start.kind);
                }, { capture: true, passive: true });

                function onTouchEnd() {
                    clearTimeout(longPressTimer);
                    if (start && start.kind) suppressClickUntil = Date.now() + 400;
                    if (start && start.kind === 'boost') {
                        var video = getVideo();
                        if (video && rateBeforeBoost !== null) video.playbackRate = rateBeforeBoost;
                        rateBeforeBoost = null;
                        hideGestureHud();
                    } else if (start && start.kind) {
                        setTimeout(hideGestureHud, 600);
                    }
                    start = null;
                }
                document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
                document.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
            }

            // ── Tap / double-tap listener ─────────────────────────────────────

            var clickListenerAttached = false;
            function attachClickListener() {
                if (clickListenerAttached) return;
                clickListenerAttached = true;

                document.addEventListener('dblclick', function(e) {
                    if (!hasPlayer()) return;
                    var container = getContainer();
                    if (!container || !container.contains(e.target)) return;
                    e.preventDefault();
                    e.stopPropagation();
                }, true);

                document.addEventListener('click', function(e) {
                    if (!hasPlayer()) return;
                    var container = getContainer();
                    if (!container || !container.contains(e.target)) return;
                    if (Date.now() < suppressClickUntil) {
                        suppressClickUntil = 0;
                        surfaceTapWasVisible = null;
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        return;
                    }
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
                // one observer per bar: a route change re-patches the same nodes, and the flag below only works for one
                if (el.__seanimeWatched) return;
                el.__seanimeWatched = true;
                new MutationObserver(function(mutations) {
                    mutations.forEach(function(m) {
                        if (m.attributeName !== 'style') return;
                        if (!hasPlayer()) return;
                        if (el.__seanimeOurControl) { el.__seanimeOurControl = false; return; }
                        el.__seanimeOurControl = true;
                        el.style.transform = el.__seanimeHidden ? hideValue : 'translateY(0px)';
                    });
                }).observe(el, { attributes: true, attributeFilter: ['style'] });
            }

            function patchPlayer() {
                var playerOpen = hasPlayer();
                // the swipe brightness only lasts while the player is open
                if (hadPlayer && !playerOpen && window.SeanimeGestures) window.SeanimeGestures.resetBrightness();
                hadPlayer = playerOpen;
                if (!playerOpen) return;
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

                if (patchedVideo !== video) {
                    if (patchedVideo) {
                        patchedVideo.removeEventListener('play', onPlaybackStateChange);
                        patchedVideo.removeEventListener('pause', onPlaybackStateChange);
                        patchedVideo.removeEventListener('ended', onPlaybackStateChange);
                    }
                    patchedVideo = video;
                    if (patchedVideo) {
                        patchedVideo.addEventListener('play', onPlaybackStateChange);
                        patchedVideo.addEventListener('pause', onPlaybackStateChange);
                        patchedVideo.addEventListener('ended', onPlaybackStateChange);
                        onPlaybackStateChange();
                    }
                }

                if (firstPatch) { firstPatch = false; scheduleHide(); }
            }

            attachScrubbingListeners();
            attachActivityListeners();
            attachClickListener();
            attachGestureListeners();
            attachFullscreenOrientationListeners();

            function onRouteChange() {
                patchedContainer = null;
                patchedTopBar    = null;
                patchedBottomBar = null;
                if (patchedVideo) {
                    patchedVideo.removeEventListener('play', onPlaybackStateChange);
                    patchedVideo.removeEventListener('pause', onPlaybackStateChange);
                    patchedVideo.removeEventListener('ended', onPlaybackStateChange);
                }
                patchedVideo = null;
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
