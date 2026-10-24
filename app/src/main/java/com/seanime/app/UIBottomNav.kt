package com.seanime.app

import android.webkit.WebView

object UIBottomNav {

    fun inject(webView: WebView) {
        MobileIcons.inject(webView)
        injectBottomNavStyles(webView)
        injectBottomNav(webView)
    }

    private fun injectBottomNavStyles(webView: WebView) {
        val js = """
        (function() {
            if (document.getElementById('__seanime_bottomnav_styles')) return;
            var s = document.createElement('style');
            s.id = '__seanime_bottomnav_styles';
            s.textContent = `
                [data-main-layout-content="true"] {
                    padding-bottom: 5.25rem !important;
                }

                #__seanime_bottom_nav {
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    z-index: 9000;
                    height: 4.75rem;
                    display: flex;
                    align-items: stretch;
                    background: rgba(10, 10, 15, 0.82);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                    border-top: 1px solid rgba(255,255,255,0.07);
                    padding: 0 4px env(safe-area-inset-bottom, 0px);
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.25s ease;
                }
                #__seanime_bottom_nav.visible {
                    opacity: 1;
                    pointer-events: auto;
                }
                #__seanime_bottom_nav:not(.visible) { visibility: hidden; }
                #__seanime_bottom_nav a[data-active="true"],
                #__seanime_bottom_nav button[data-active="true"] {
                    color: #c4b5fd;
                    background: rgba(139,92,246,0.18);
                }
                #__seanime_bottom_nav a[data-active="true"] span,
                #__seanime_bottom_nav button[data-active="true"] span {
                    color: #ddd6fe;
                    font-weight: 600;
                }
                #__seanime_bottom_nav :focus-visible,
                #android-floating-menu :focus-visible {
                    outline: 2px solid #c4b5fd;
                    outline-offset: -2px;
                }
                #__seanime_bottom_nav a,
                #__seanime_bottom_nav button {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 0.22rem;
                    min-width: 0;
                    min-height: 48px;
                    margin: 4px 1px;
                    border-radius: 14px;
                    background: transparent;
                    border: none;
                    color: rgba(255,255,255,0.55);
                    font-size: 0.6875rem;
                    font-weight: 600;
                    letter-spacing: -0.02em;
                    white-space: nowrap;
                    text-decoration: none;
                    cursor: pointer;
                    transition: color 0.15s, background 0.15s;
                    padding: 0 1px;
                    -webkit-tap-highlight-color: transparent;
                    position: relative;
                    user-select: none;
                    -webkit-user-select: none;
                    touch-action: manipulation;
                }
                #__seanime_bottom_nav a svg,
                #__seanime_bottom_nav button svg {
                    width: 24px;
                    height: 24px;
                    flex-shrink: 0;
                }
                #__seanime_bottom_nav a span,
                #__seanime_bottom_nav button span {
                    max-width: 100%;
                    overflow: hidden;
                    text-overflow: clip;
                    white-space: nowrap;
                    line-height: 1.2;
                }
                #__seanime_bottom_nav a:active,
                #__seanime_bottom_nav button:active {
                    color: rgba(255,255,255,0.8);
                    background: rgba(255,255,255,0.08);
                }
                #__seanime_bottom_nav a[data-active="true"]:active {
                    background: rgba(139,92,246,0.28);
                }

                /* 7 entries: slightly smaller icons/labels, side gutter, nothing clipped */
                #__seanime_bottom_nav[data-nav-count="7"] {
                    padding-left: max(6px, env(safe-area-inset-left, 0px));
                    padding-right: max(6px, env(safe-area-inset-right, 0px));
                }
                #__seanime_bottom_nav[data-nav-count="7"] a,
                #__seanime_bottom_nav[data-nav-count="7"] button {
                    margin: 4px 0.5px;
                    padding: 0;
                    font-size: 0.58rem;
                    letter-spacing: -0.01em;
                    gap: 0.2rem;
                }
                #__seanime_bottom_nav[data-nav-count="7"] a svg,
                #__seanime_bottom_nav[data-nav-count="7"] button svg {
                    width: 22px;
                    height: 22px;
                }
                @media (max-width: 370px) {
                    #__seanime_bottom_nav[data-nav-count="7"] a,
                    #__seanime_bottom_nav[data-nav-count="7"] button {
                        font-size: 0.54rem;
                    }
                }

                /* Drag handle on nav items */
                .seanime-nav-drag-handle {
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    width: 16px;
                    height: 16px;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    color: rgba(255,255,255,0.7);
                    line-height: 1;
                    cursor: grab;
                    z-index: 10;
                    pointer-events: auto;
                    touch-action: none;
                }
                .seanime-edit-mode .seanime-nav-drag-handle {
                    display: flex;
                }
                .seanime-nav-drag-handle svg,
                .float-drag-handle svg {
                    width: 14px !important;
                    height: 14px !important;
                    display: block !important;
                    margin: 0 !important;
                }
                #android-floating-menu.seanime-edit-mode .float-drag-handle svg {
                    width: 20px !important;
                    height: 20px !important;
                }

                /* Nav drop target highlight */
                #__seanime_bottom_nav a.seanime-drop-target,
                #__seanime_bottom_nav button.seanime-drop-target {
                    background: rgba(255,255,255,0.1);
                    border-radius: 8px;
                }

                /* Floating menu */
                #android-floating-menu {
                    left: 0.5rem !important;
                    right: 0.5rem !important;
                    bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px)) !important;
                    width: auto !important;
                    max-height: calc(100vh - 9rem);
                    max-height: calc(100dvh - 9rem);
                    overflow-y: auto;
                    overscroll-behavior: contain;
                    touch-action: pan-y;
                    align-items: stretch !important;
                    gap: 0 !important;
                    padding: 8px;
                    background: linear-gradient(180deg, rgba(22,20,38,0.66), rgba(9,9,14,0.74));
                    -webkit-backdrop-filter: blur(22px) saturate(140%);
                    backdrop-filter: blur(22px) saturate(140%);
                    border: 1px solid rgba(139,92,246,0.22);
                    border-radius: 24px;
                    box-shadow: 0 18px 50px rgba(0,0,0,0.6), 0 0 36px rgba(97,82,223,0.18), inset 0 1px 0 rgba(255,255,255,0.07);
                    transform-origin: 50% 100%;
                }
                #android-floating-menu:not(.seanime-edit-mode) {
                    animation: seanime-menu-in 0.34s cubic-bezier(0.2,0.9,0.25,1.15);
                }
                @keyframes seanime-menu-in {
                    from { opacity: 0; transform: translateY(18px) scale(0.94); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
                #android-floating-menu .float-nav-item {
                    flex: 0 0 auto;
                    cursor: pointer;
                }
                #android-floating-menu .float-nav-tooltip {
                    position: static !important;
                    flex: 1;
                    min-width: 0;
                    white-space: normal !important;
                    overflow-wrap: anywhere;
                    opacity: 1 !important;
                    transform: none !important;
                }
                /* Edit mode: calm full-height panel, the bar stays visible below */
                #android-floating-menu.seanime-edit-mode {
                    top: 3rem !important;
                    bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px)) !important;
                    left: 0.5rem !important;
                    right: 0.5rem !important;
                    max-height: none !important;
                    gap: 0 !important;
                    padding: 0;
                    overflow: hidden;
                    animation: none;
                }
                .seanime-edit-head {
                    flex: 0 0 auto;
                    padding: 14px 12px 10px 16px;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                }
                .seanime-edit-head-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                }
                .seanime-edit-title {
                    font-size: 1.05rem;
                    font-weight: 700;
                    letter-spacing: 0.01em;
                    color: #ede9fe;
                }
                .seanime-edit-done {
                    min-width: 80px;
                    min-height: 44px;
                    padding: 0 18px;
                    border-radius: 14px;
                    border: 1px solid rgba(196,181,253,0.45);
                    background: linear-gradient(135deg, #6152df, #8b5cf6);
                    color: #fff;
                    font-size: 0.9rem;
                    font-weight: 700;
                    cursor: pointer;
                    -webkit-tap-highlight-color: transparent;
                    touch-action: manipulation;
                }
                .seanime-edit-done:active { filter: brightness(0.88); }
                .seanime-edit-count {
                    margin-top: 6px;
                    min-height: 1.2em;
                    font-size: 0.82rem;
                    font-weight: 600;
                    color: #c4b5fd;
                    transition: color 0.15s ease;
                }
                .seanime-edit-count.is-warn { color: #fca5a5; }
                .seanime-edit-hint {
                    margin-top: 4px;
                    font-size: 0.75rem;
                    line-height: 1.4;
                    color: rgba(255,255,255,0.62);
                }
                .seanime-edit-scroll {
                    flex: 1 1 auto;
                    min-height: 0;
                    overflow-y: auto;
                    overscroll-behavior: contain;
                    touch-action: pan-y;
                    padding: 2px 8px 12px;
                }
                .seanime-edit-sec { border-radius: 14px; }
                .seanime-edit-sec-title {
                    padding: 12px 10px 6px;
                    font-size: 0.72rem;
                    font-weight: 700;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                    color: rgba(196,181,253,0.85);
                }
                .seanime-edit-sec-empty {
                    padding: 8px 10px 12px;
                    font-size: 0.8rem;
                    color: rgba(255,255,255,0.55);
                }
                #android-floating-menu.seanime-edit-mode .float-nav-item {
                    min-height: 48px;
                    justify-content: flex-start;
                    gap: 12px;
                    padding: 0 2px 0 6px;
                    border-radius: 12px;
                    color: rgba(255,255,255,0.86);
                    -webkit-tap-highlight-color: transparent;
                    transition: background 0.15s ease;
                }
                #android-floating-menu.seanime-edit-mode .float-nav-item:active {
                    background: rgba(255,255,255,0.08);
                }
                #android-floating-menu.seanime-edit-mode .float-nav-item--current {
                    background: linear-gradient(90deg, rgba(97,82,223,0.26), rgba(139,92,246,0.04));
                    color: #ddd6fe;
                }
                #android-floating-menu.seanime-edit-mode .float-nav-tooltip {
                    padding: 0 !important;
                    font-size: 0.9rem;
                    font-weight: 500;
                    color: inherit;
                }
                #android-floating-menu.seanime-edit-mode .float-nav-icon {
                    width: 36px !important;
                    height: 36px !important;
                    flex: 0 0 auto;
                    border-radius: 11px !important;
                    background: rgba(255,255,255,0.06) !important;
                    border: 1px solid rgba(255,255,255,0.07) !important;
                    box-shadow: none !important;
                    color: inherit;
                }
                #android-floating-menu.seanime-edit-mode .float-nav-item--current .float-nav-icon {
                    background: linear-gradient(135deg, #6152df, #8b5cf6) !important;
                    border-color: rgba(196,181,253,0.45) !important;
                    color: #fff;
                }
                #android-floating-menu.seanime-edit-mode .float-nav-action {
                    flex-direction: row-reverse;
                }
                .seanime-edit-check {
                    flex: 0 0 auto;
                    width: 22px;
                    height: 22px;
                    display: grid;
                    place-items: center;
                    color: #c4b5fd;
                    opacity: 0.85;
                }
                .seanime-edit-fixed {
                    flex: 0 0 auto;
                    padding: 0 14px 0 8px;
                    font-size: 0.72rem;
                    font-weight: 600;
                    color: rgba(255,255,255,0.55);
                }
                #android-floating-menu.seanime-edit-mode .float-drag-handle {
                    position: static;
                    flex: 0 0 auto;
                    width: 44px;
                    height: 44px;
                    border-radius: 10px;
                    color: rgba(255,255,255,0.6);
                }
                #android-floating-menu.seanime-edit-mode .seanime-float-drop-target {
                    background: rgba(139,92,246,0.22);
                }
                #android-floating-menu.seanime-edit-mode .seanime-edit-sec.seanime-float-drop-target {
                    background: transparent;
                    outline: 1px dashed rgba(196,181,253,0.5);
                    outline-offset: -1px;
                }
                @keyframes seanime-row-pulse {
                    0%, 100% { background: transparent; }
                    40% { background: rgba(252,165,165,0.24); }
                }
                #android-floating-menu.seanime-edit-mode .seanime-row-pulse {
                    animation: seanime-row-pulse 0.6s ease 2;
                }
                @media (prefers-reduced-motion: reduce) {
                    #android-floating-menu.seanime-edit-mode .seanime-row-pulse {
                        animation: none;
                        background: rgba(252,165,165,0.2);
                    }
                }
                /* Regular menu: soft icon tile left, label right */
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-item {
                    flex-direction: row-reverse;
                    min-height: 56px;
                    padding: 0 12px 0 10px;
                    gap: 14px;
                    justify-content: flex-start;
                    border-radius: 16px;
                    color: rgba(255,255,255,0.78);
                    transition: background 0.15s ease, transform 0.15s ease;
                    -webkit-tap-highlight-color: transparent;
                }
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-item + .float-nav-item::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 64px;
                    right: 12px;
                    height: 1px;
                    background: rgba(255,255,255,0.05);
                }
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-item:active {
                    background: rgba(255,255,255,0.08);
                    transform: scale(0.975);
                }
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-item--current {
                    background: linear-gradient(90deg, rgba(97,82,223,0.30), rgba(139,92,246,0.06));
                    color: #ddd6fe;
                }
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-item--current::before {
                    display: none;
                }
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-item--current + .float-nav-item::before {
                    display: none;
                }
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-tooltip {
                    padding: 0 !important;
                    font-size: 0.95rem;
                    font-weight: 500;
                    letter-spacing: 0.01em;
                    color: rgba(255,255,255,0.92);
                }
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-item--current .float-nav-tooltip {
                    font-weight: 600;
                    color: #ede9fe;
                }
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-icon {
                    width: 38px !important;
                    height: 38px !important;
                    flex: 0 0 auto;
                    border-radius: 12px !important;
                    background: rgba(255,255,255,0.06) !important;
                    border: 1px solid rgba(255,255,255,0.07) !important;
                    box-shadow: none !important;
                    color: inherit;
                    transition: background 0.2s ease, box-shadow 0.2s ease;
                }
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-item--current .float-nav-icon {
                    background: linear-gradient(135deg, #6152df, #8b5cf6) !important;
                    border-color: rgba(196,181,253,0.45) !important;
                    box-shadow: 0 0 16px rgba(97,82,223,0.65) !important;
                    color: #fff;
                }

                /* Menu action rows (customize / reset) */
                #android-floating-menu .float-nav-divider {
                    flex: 0 0 auto;
                    height: 1px;
                    margin: 6px 12px 4px;
                    background: rgba(255,255,255,0.1);
                }
                #android-floating-menu .float-nav-action--danger,
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-action--danger {
                    color: #fca5a5;
                }
                #android-floating-menu .float-nav-action--danger .float-nav-tooltip,
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-action--danger .float-nav-tooltip {
                    color: #fca5a5;
                }
                #android-floating-menu .float-nav-action--danger .float-nav-icon,
                #android-floating-menu:not(.seanime-edit-mode) .float-nav-action--danger .float-nav-icon {
                    background: rgba(239,68,68,0.12) !important;
                    border-color: rgba(239,68,68,0.45) !important;
                    color: #f87171;
                }

                /* Reset dialog */
                #__seanime_reset_dialog_overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 999999;
                    background: rgba(0,0,0,0.55);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.18s ease;
                }
                #__seanime_reset_dialog_overlay.visible {
                    opacity: 1;
                    pointer-events: auto;
                }
                #__seanime_reset_dialog_overlay:not(.visible) { visibility: hidden; }
                #__seanime_reset_dialog {
                    width: min(360px, 92vw);
                    border-radius: 14px;
                    background: rgba(20,20,28,0.96);
                    border: 1px solid rgba(255,255,255,0.12);
                    box-shadow: 0 18px 50px rgba(0,0,0,0.65);
                    padding: 14px 14px 12px 14px;
                    transform: translateY(8px) scale(0.98);
                    transition: transform 0.18s ease;
                }
                #__seanime_reset_dialog_overlay.visible #__seanime_reset_dialog {
                    transform: translateY(0) scale(1);
                }
                #__seanime_reset_dialog_title {
                    color: rgba(255,255,255,0.92);
                    font-size: 15px;
                    font-weight: 700;
                    margin: 0 0 6px 0;
                    letter-spacing: 0.01em;
                }
                #__seanime_reset_dialog_desc {
                    color: rgba(255,255,255,0.65);
                    font-size: 13px;
                    font-weight: 500;
                    margin: 0 0 12px 0;
                    line-height: 1.35;
                }
                #__seanime_reset_dialog_actions {
                    display: flex;
                    gap: 10px;
                    justify-content: flex-end;
                }
                .__seanime_dialog_btn {
                    min-width: 48px;
                    min-height: 48px;
                    appearance: none;
                    border: 1px solid rgba(255,255,255,0.12);
                    background: rgba(255,255,255,0.06);
                    color: rgba(255,255,255,0.9);
                    font-size: 13px;
                    font-weight: 700;
                    padding: 10px 12px;
                    border-radius: 12px;
                    cursor: pointer;
                    -webkit-tap-highlight-color: transparent;
                }
                .__seanime_dialog_btn:active {
                    background: rgba(255,255,255,0.1);
                }
                .__seanime_dialog_btn_danger {
                    border-color: rgba(239,68,68,0.45);
                    background: rgba(239,68,68,0.14);
                    color: rgba(255,255,255,0.95);
                }
                .__seanime_dialog_btn_danger:active {
                    background: rgba(239,68,68,0.22);
                }

                /* Float drag handle */
                .float-drag-handle {
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    width: 14px;
                    height: 14px;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    color: rgba(255,255,255,0.7);
                    line-height: 1;
                    cursor: grab;
                    z-index: 10;
                    pointer-events: auto;
                    touch-action: none;
                }
                .seanime-edit-mode .float-drag-handle {
                    display: flex;
                }

                /* Float drop target highlight */
                .float-nav-item.seanime-float-drop-target .float-nav-icon {
                    background: rgba(255,255,255,0.2) !important;
                    border-color: rgba(255,255,255,0.4) !important;
                }

                /* Float hidden state */
                .float-nav-item[data-hidden="true"] .float-nav-icon {
                    opacity: 0.3;
                }

                /* Landscape phones: slimmer bar and menu */
                @media (orientation: landscape) and (max-height: 600px) {
                    [data-main-layout-content="true"] {
                        padding-bottom: 4.25rem !important;
                    }
                    #__seanime_bottom_nav {
                        height: 3.75rem;
                        padding-left: max(4px, env(safe-area-inset-left, 0px));
                        padding-right: max(4px, env(safe-area-inset-right, 0px));
                    }
                    #__seanime_bottom_nav a svg,
                    #__seanime_bottom_nav button svg {
                        width: 22px;
                        height: 22px;
                    }
                    #__seanime_bottom_nav a,
                    #__seanime_bottom_nav button {
                        font-size: 0.66rem;
                        min-height: 40px;
                        gap: 0.12rem;
                    }
                    #android-floating-menu {
                        bottom: calc(4.75rem + env(safe-area-inset-bottom, 0px)) !important;
                        max-height: calc(100vh - 8rem);
                        max-height: calc(100dvh - 8rem);
                    }
                    #android-floating-menu:not(.seanime-edit-mode) .float-nav-item {
                        min-height: 46px;
                    }
                    #android-floating-menu.seanime-edit-mode {
                        top: 0.5rem !important;
                        bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px)) !important;
                    }
                    .seanime-edit-head { padding-top: 10px; padding-bottom: 8px; }
                    .seanime-edit-count { margin-top: 2px; }
                    .seanime-edit-hint { margin-top: 2px; }
                }

                /* Drag ghost clone */
                .seanime-drag-ghost--row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 0 8px;
                    border-radius: 12px;
                    background: rgba(32,28,60,0.96);
                    border: 1px solid rgba(196,181,253,0.4);
                    color: #ede9fe;
                    transform: none;
                }
                .seanime-drag-ghost--row .float-nav-tooltip {
                    position: static !important;
                    flex: 1;
                    font-size: 0.9rem;
                    font-weight: 500;
                    padding: 0 !important;
                    color: inherit;
                }
                .seanime-drag-ghost {
                    position: fixed;
                    z-index: 99999;
                    pointer-events: none;
                    opacity: 0.85;
                    transform: scale(1.1);
                    border-radius: 12px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
                }

                /* Base of the menu rows and of their drag ghosts */
                .float-nav-item { display: flex; align-items: center; justify-content: center; position: relative; width: 100%; }
                .float-nav-tooltip { position: absolute; right: 64px; color: white; font-size: 13px; font-weight: 500; padding: 0; white-space: nowrap; pointer-events: none; }
                .float-nav-icon {
                    width: 44px !important;
                    height: 44px !important;
                    border-radius: 12px;
                    background: rgba(25,25,25,0.9);
                    border: 1px solid rgba(255,255,255,0.1);
                    display: grid !important;
                    place-items: center !important;
                    color: #a0a0a0;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.4);
                }
            `;
            document.head.appendChild(s);
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun injectBottomNav(webView: WebView) {
        val js = """
        (function() {
            if (window.__seanime_bottomnav_init) return;
            window.__seanime_bottomnav_init = true;

            // Phones and tablets both get the bar; on a tablet (html[data-layout="tablet"], set by the web app) tablet.css makes it a rail
            var TABLET_UI = document.documentElement.dataset.layout === 'tablet';

            initNav();

            function initNav() {
                var LS_NAV_ORDER     = '__seanime_nav_order';
                var LS_NAV_PLACEMENT = '__seanime_nav_placement';
                var LS_NAV_ITEMS     = '__seanime_nav_items_full';
                var LS_FLOAT_HIDDEN  = '__seanime_float_hidden';
                var LS_FLOAT_ORDER   = '__seanime_float_order';

                var icon = window.__seanimeIcons.svg;
                var iconFor = window.__seanimeIcons.forItem;
                var SVG_HAMBURGER = icon('menu');
                var SVG_WRENCH = icon('wrench');
                var SVG_RESET = icon('close');
                var SVG_GRIP = icon('grip');
                var SVG_CHECK = icon('check');

                // Maximum number of entries in the bottom bar (the Menu button counts).
                var MAX_NAV_ITEMS = 7;

                var DEFAULT_NAV_ITEMS = [
                    { id: 'home', href: '/', label: 'Home', matchExact: true, placement: 'nav', svg: icon('home') },
                    { id: 'lists', href: '/lists', label: 'My Lists', matchExact: false, placement: 'nav', svg: icon('lists') },
                    { id: 'discover', href: '/discover', label: 'Discover', matchExact: false, placement: 'nav', svg: icon('discover') },
                    { id: 'search', href: '/search', label: 'Search', matchExact: false, placement: 'nav', svg: icon('search') },
                    { id: 'menu', label: 'Menu', isMenu: true, immovableToFloat: true, placement: 'nav', svg: SVG_HAMBURGER }
                ];

                // Persistence
                function normalizeNavItem(it) {
                    if (!it || !it.id) return null;
                    return {
                        id: it.id,
                        href: it.href !== undefined ? it.href : null,
                        label: it.label || it.id,
                        matchExact: !!it.matchExact,
                        placement: it.placement || 'nav',
                        svg: iconFor(it) || window.__seanimeIcons.clean(it.svg),
                        isMenu: !!it.isMenu,
                        immovableToFloat: !!it.immovableToFloat,
                        isSidebarItem: !!it.isSidebarItem,
                        sidebarType: it.sidebarType || null
                    };
                }

                function navigationPath(href) {
                    if (!href || href === '#') return '';
                    var path;
                    try { path = new URL(String(href), window.location.href).pathname; } catch (e) { path = String(href).split(/[?#]/)[0]; }
                    return path.replace(/(.)\/+${'$'}/, '${'$'}1');
                }
                function isAndroidRemovedOfflineItem(item) {
                    return !!item && navigationPath(item.href) === '/sync';
                }

                function loadNavItems() {
                    try {
                        var savedFull = JSON.parse(localStorage.getItem(LS_NAV_ITEMS) || 'null');
                        if (Array.isArray(savedFull) && savedFull.length) {
                            var rebuilt = [];
                            savedFull.forEach(function(x) {
                                var n = normalizeNavItem(x);
                                if (n && !isAndroidRemovedOfflineItem(n)) rebuilt.push(n);
                            });
                            if (rebuilt.length) { localStorage.setItem(LS_NAV_ITEMS, JSON.stringify(rebuilt)); return rebuilt; }
                        }
                    } catch(e) {}

                    var items = DEFAULT_NAV_ITEMS.map(function(d) { return Object.assign({}, d); });
                    try {
                        var savedPlacement = JSON.parse(localStorage.getItem(LS_NAV_PLACEMENT) || 'null');
                        if (savedPlacement) {
                            items.forEach(function(it) {
                                if (savedPlacement[it.id] !== undefined) it.placement = savedPlacement[it.id];
                            });
                        }
                        var savedOrder = JSON.parse(localStorage.getItem(LS_NAV_ORDER) || 'null');
                        if (Array.isArray(savedOrder)) items = inSavedOrder(items, savedOrder, 'id');
                    } catch(e) {}
                    return items;
                }

                // The entries named in the saved order first, in that order, then the rest.
                function inSavedOrder(list, order, key) {
                    var ordered = [];
                    order.forEach(function(value) {
                        for (var i = 0; i < list.length; i++) {
                            if (list[i][key] === value) { ordered.push(list[i]); break; }
                        }
                    });
                    return ordered.concat(list.filter(function(it) {
                        return !ordered.some(function(o) { return o[key] === it[key]; });
                    }));
                }

                function saveNavState() {
                    try {
                        localStorage.setItem(LS_NAV_ITEMS, JSON.stringify(NAV_ITEMS));
                        localStorage.setItem(LS_NAV_ORDER, JSON.stringify(NAV_ITEMS.map(function(it) { return it.id; })));
                        var placement = {};
                        NAV_ITEMS.forEach(function(it) { placement[it.id] = it.placement; });
                        localStorage.setItem(LS_NAV_PLACEMENT, JSON.stringify(placement));
                    } catch(e) {}
                }

                function loadFloatHidden() {
                    try { return JSON.parse(localStorage.getItem(LS_FLOAT_HIDDEN) || '{}'); } catch(e) { return {}; }
                }
                function saveFloatHidden(map) {
                    try { localStorage.setItem(LS_FLOAT_HIDDEN, JSON.stringify(map)); } catch(e) {}
                }
                function loadFloatOrder() {
                    try { return JSON.parse(localStorage.getItem(LS_FLOAT_ORDER) || 'null'); } catch(e) { return null; }
                }
                function saveFloatOrder(arr) {
                    try { localStorage.setItem(LS_FLOAT_ORDER, JSON.stringify(arr)); } catch(e) {}
                }

                // Remove the Android navigation entry by its /sync destination, independent of its label.
                function migrateStoredOfflineNavigation() {
                    try {
                        var saved = JSON.parse(localStorage.getItem(LS_NAV_ITEMS) || 'null');
                        var hasSavedItems = Array.isArray(saved);
                        if (!hasSavedItems) saved = [];
                        var removed = saved.filter(isAndroidRemovedOfflineItem);

                        var removedIds = {};
                        var removedLabels = {};
                        // The former built-in sidebar registered Offline -> /sync.
                        // Its float-order identity can remain even when it never entered the bar.
                        // Preserve a user item that reuses this label for another destination.
                        if (!saved.some(function(item) { return item.label === 'Offline' && !isAndroidRemovedOfflineItem(item); })) {
                            removedIds.__float_Offline = true;
                            removedLabels.Offline = true;
                        }
                        removed.forEach(function(item) {
                            if (item && item.id) removedIds[item.id] = true;
                            if (item && item.label) removedLabels[item.label] = true;
                        });
                        if (hasSavedItems) localStorage.setItem(LS_NAV_ITEMS, JSON.stringify(saved.filter(function(item) {
                            return !isAndroidRemovedOfflineItem(item);
                        })));

                        var order = JSON.parse(localStorage.getItem(LS_NAV_ORDER) || 'null');
                        if (Array.isArray(order)) localStorage.setItem(LS_NAV_ORDER, JSON.stringify(order.filter(function(id) { return !removedIds[id]; })));

                        var placement = JSON.parse(localStorage.getItem(LS_NAV_PLACEMENT) || 'null');
                        if (placement && typeof placement === 'object' && !Array.isArray(placement)) {
                            Object.keys(removedIds).forEach(function(id) { delete placement[id]; });
                            localStorage.setItem(LS_NAV_PLACEMENT, JSON.stringify(placement));
                        }

                        var floatOrder = JSON.parse(localStorage.getItem(LS_FLOAT_ORDER) || 'null');
                        if (Array.isArray(floatOrder)) localStorage.setItem(LS_FLOAT_ORDER, JSON.stringify(floatOrder.filter(function(label) { return !removedLabels[label]; })));

                        var hidden = JSON.parse(localStorage.getItem(LS_FLOAT_HIDDEN) || 'null');
                        if (hidden && typeof hidden === 'object' && !Array.isArray(hidden)) {
                            Object.keys(removedLabels).forEach(function(label) { delete hidden[label]; });
                            localStorage.setItem(LS_FLOAT_HIDDEN, JSON.stringify(hidden));
                        }
                    } catch(e) {}
                }
                migrateStoredOfflineNavigation();

                // Every bar state has the Downloads entry, and icons always come from the shared catalogue.
                function prepareNavItems(items) {
                    if (!items.some(function(item) { return item.id === 'android-downloads' || navigationPath(item.href) === '/android-downloads'; })) {
                        items.push({ id: 'android-downloads', href: '/android-downloads', label: 'Downloads', matchExact: true, placement: 'nav', svg: icon('download') });
                    }
                    items.forEach(function(it) { it.svg = iconFor(it) || window.__seanimeIcons.clean(it.svg); });
                    return items;
                }

                var NAV_ITEMS = prepareNavItems(loadNavItems().filter(function(item) {
                    return !/^\/(torrent-list|torrent-client|auto-downloader)(\/|${'$'})/.test(item.href || '');
                }));
                var menuOpen  = false;
                var editMode  = false;
                var menuBtn   = null;

                // Two entries point to the same destination when label (case-insensitive) or href match.
                function normKey(s) { return String(s || '').trim().toLowerCase(); }
                function sameTarget(a, b) {
                    if (!a || !b) return false;
                    if (normKey(a.label) && normKey(a.label) === normKey(b.label)) return true;
                    if (a.href && b.href && a.href !== '#' && a.href === b.href) return true;
                    return false;
                }
                // Merge duplicates in the saved state (e.g. "My Lists" vs "My lists"); nav placement wins.
                (function dedupeNavItems() {
                    var out = [];
                    NAV_ITEMS.forEach(function(it) {
                        if (it.isMenu) { out.push(it); return; }
                        for (var i = 0; i < out.length; i++) {
                            if (out[i].isMenu || !sameTarget(out[i], it)) continue;
                            if (out[i].placement !== 'nav' && it.placement === 'nav') out[i] = it;
                            return;
                        }
                        out.push(it);
                    });
                    NAV_ITEMS = out;
                })();
                function navCount() {
                    return NAV_ITEMS.filter(function(it) { return it.placement === 'nav'; }).length;
                }

                // The menu's entries in display order: { type, label, href, svg, isCurrent }
                var floatSidebarItems = [];
                function refreshFloatItems() { floatSidebarItems = applyFloatOrder(snapshotSidebarItems()); }

                function getItem(id) {
                    return NAV_ITEMS.find(function(it) { return it.id === id; }) || null;
                }
                function isActive(item) {
                    if (item.isMenu) return false;
                    var path = window.location.pathname;
                    if (item.matchExact) return path === item.href;
                    return path === item.href || path.indexOf(item.href + '/') === 0;
                }
                function suppressDefault(e) { e.preventDefault(); }

                // Menu tab: same hamburger icon open or closed; the open state is the active pill.
                function setMenuBtnOpen(open) {
                    if (!menuBtn) return;
                    menuBtn.setAttribute('data-menu-open', open ? 'true' : 'false');
                    if (open) menuBtn.setAttribute('data-active', 'true');
                    else menuBtn.removeAttribute('data-active');
                }

                // Texts of the menu's own rows and its edit mode follow the app language the web UI stores (English default).
                function navText(en, de) {
                    try { return JSON.parse(localStorage.getItem('seanime-mobile-language') || '"en"') === 'de' ? de : en; } catch (e) { return en; }
                }

                // Menu rows act as buttons: focusable and activated with Enter or Space.
                function asButton(row) {
                    row.setAttribute('role', 'button');
                    row.setAttribute('tabindex', '0');
                    row.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
                    });
                    return row;
                }
                function rowText(label) {
                    var text = document.createElement('span');
                    text.className = 'float-nav-tooltip';
                    text.textContent = label;
                    return text;
                }
                // Entry icons are drawn at 22px, whatever size their source svg declares.
                function fitIcon(container) {
                    var svgEl = container.querySelector('svg');
                    if (!svgEl) return;
                    svgEl.setAttribute('width', '22');
                    svgEl.setAttribute('height', '22');
                    svgEl.style.cssText = 'width:22px!important;height:22px!important;display:block!important;margin:0!important;';
                }
                function iconTile(svg) {
                    var iconWrap = document.createElement('div');
                    iconWrap.className = 'float-nav-icon';
                    iconWrap.innerHTML = svg || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
                    fitIcon(iconWrap);
                    return iconWrap;
                }

                // Last rows of the menu: customize navigation + reset navigation.
                function makeActionRow(id, label, svg, danger, onClick) {
                    var row = asButton(document.createElement('div'));
                    row.id = id;
                    row.className = 'float-nav-item float-nav-action' + (danger ? ' float-nav-action--danger' : '');
                    row.setAttribute('aria-label', label);
                    var iconWrap = document.createElement('div');
                    iconWrap.className = 'float-nav-icon';
                    iconWrap.innerHTML = svg;
                    row.appendChild(rowText(label));
                    row.appendChild(iconWrap);
                    row.addEventListener('contextmenu', suppressDefault);
                    row.addEventListener('click', function(e) { e.stopPropagation(); onClick(); });
                    return row;
                }
                function divider() {
                    var el = document.createElement('div');
                    el.className = 'float-nav-divider';
                    el.setAttribute('role', 'separator');
                    return el;
                }
                function appendMenuActions(menu, withCustomize) {
                    menu.appendChild(divider());
                    if (withCustomize) {
                        menu.appendChild(makeActionRow('__seanime_wrench_btn', navText('Customize navigation', 'Navigation anpassen'), SVG_WRENCH, false, toggleEditMode));
                    }
                    menu.appendChild(makeActionRow('__seanime_reset_btn', navText('Reset navigation', 'Navigation zur\u00fccksetzen'), SVG_RESET, true, showResetDialog));
                }

                function navItemToFloatPill(navItem) {
                    return {
                        type: navItem.isSidebarItem && navItem.sidebarType ? navItem.sidebarType : 'link',
                        label: navItem.label,
                        href: navItem.href || '#',
                        svg: navItem.svg || '',
                        isCurrent: isActive(navItem)
                    };
                }

                // Labels (lower-case) and hrefs of the bar entries, without the Menu button.
                function getNavLookup() {
                    var labels = new Set();
                    var hrefs = new Set();
                    for (var i = 0; i < NAV_ITEMS.length; i++) {
                        var it = NAV_ITEMS[i];
                        if (it.placement === 'nav' && it.id !== 'menu') {
                            labels.add(normKey(it.label));
                            if (it.href) hrefs.add(it.href);
                        }
                    }
                    return { labels: labels, hrefs: hrefs };
                }

                // Menu entries: the sidebar's items without those already in the bar.
                function snapshotSidebarItems() {
                    var items = [];
                    var existing = {};
                    var existingHref = {};
                    var navLookup = getNavLookup();
                    function inNav(label, href) {
                        return navLookup.labels.has(normKey(label)) || (!!href && navLookup.hrefs.has(href));
                    }
                    function seen(label, href) {
                        return !!existing[normKey(label)] || (!!href && !!existingHref[href]);
                    }
                    function markSeen(label, href) {
                        existing[normKey(label)] = true;
                        if (href) existingHref[href] = true;
                    }

                    // First, collect all sidebar items with duplicate prevention
                    document.querySelectorAll('.UI-AppSidebar__sidebar a[data-vertical-menu-item-link]').forEach(function(a) {
                        if (a.style.display === 'none') return;
                        var label = a.getAttribute('data-vertical-menu-item-link');
                        var href  = a.getAttribute('href');
                        if (isAndroidRemovedOfflineItem({ href: href })) return;
                        var isCurrent = a.getAttribute('data-current') === 'true';
                        var svgEl = a.querySelector('svg');
                        if (label && href && !seen(label, href) && !inNav(label, href)) {
                            items.push({ type: 'link', label: label, href: href, svg: iconFor({href:href, label:label}) || window.__seanimeIcons.clean(svgEl ? svgEl.outerHTML : ''), isCurrent: isCurrent });
                            markSeen(label, href);
                        }
                    });
                    document.querySelectorAll('.UI-AppSidebar__sidebar button[data-vertical-menu-item-button]').forEach(function(btn) {
                        if (btn.style.display === 'none') return;
                        var label = btn.getAttribute('data-vertical-menu-item-button');
                        var svgEl = btn.querySelector('svg');
                        if (label && !seen(label, null) && !inNav(label, null)) {
                            items.push({ type: 'button', label: label, svg: iconFor({label:label}) || window.__seanimeIcons.clean(svgEl ? svgEl.outerHTML : '') });
                            markSeen(label, null);
                        }
                    });

                    // Then add nav items that are in float placement, but only if not already in nav (should not happen) and not duplicate target
                    NAV_ITEMS.filter(function(it) { return it.placement === 'float' && !it.isMenu; }).forEach(function(navIt) {
                        if (!isAndroidRemovedOfflineItem(navIt) && !seen(navIt.label, navIt.href) && !inNav(navIt.label, navIt.href)) {
                            items.push(navItemToFloatPill(navIt));
                            markSeen(navIt.label, navIt.href);
                        }
                    });

                    return items;
                }

                // Signing out is destructive: it always sits at the bottom of the menu, whatever order was saved.
                // The menu renders this list reversed, so the bottom row is the first array entry.
                function signOutLast(list) {
                    return list.filter(function(it) { return it.label === 'Sign out'; })
                        .concat(list.filter(function(it) { return it.label !== 'Sign out'; }));
                }

                function applyFloatOrder(snapshot) {
                    var order = loadFloatOrder();
                    return signOutLast(order ? inSavedOrder(snapshot, order, 'label') : snapshot);
                }

                function resetToDefaults() {
                    if (editMode) exitEditMode();
                    NAV_ITEMS = prepareNavItems(DEFAULT_NAV_ITEMS.map(function(d) { return Object.assign({}, d); }));
                    saveNavState();
                    saveFloatHidden({});
                    saveFloatOrder(null);
                    refreshFloatItems();
                    refreshNavBar();
                    if (menuOpen) closeMenu();
                }

                // Menu
                function clickSidebarButton(label) {
                    var button = document.querySelector('.UI-AppSidebar__sidebar button[data-vertical-menu-item-button="' + label.replace(/"/g, '\\"') + '"]');
                    if (button) button.click();
                }

                function navigateViaApp(href) {
                    if (href === '/android-downloads') {
                        window.dispatchEvent(new Event('seanime-open-downloads'));  // routes/_main.tsx pauses playback and opens the page
                        return;
                    }
                    var target = new URL(href, window.location.origin);
                    var links = document.querySelectorAll('.UI-AppSidebar__sidebar a[href]');
                    for (var i = 0; i < links.length; i++) {
                        var url = new URL(links[i].href, window.location.origin);
                        if (url.origin === target.origin && url.pathname === target.pathname && url.search === target.search) {
                            links[i].click();
                            return;
                        }
                    }
                    window.location.assign(href);
                }

                function openMenu() {
                    var menu = document.getElementById('android-floating-menu');
                    if (!menu) return;

                    refreshFloatItems();
                    var hiddenMap = loadFloatHidden();

                    menu.innerHTML = '';
                    var updateHost = document.createElement('div');
                    updateHost.id = '__seanime_update_menu_host';
                    menu.appendChild(updateHost);
                    window.dispatchEvent(new Event('seanime-update-menu'));
                    // Reverse so last item in array appears at bottom (visually stacks upward)
                    var visible = floatSidebarItems.slice().reverse().filter(function(it) { return !hiddenMap[it.label]; });

                    visible.forEach(function(item) {
                        var row = asButton(document.createElement('div'));
                        row.className = 'float-nav-item' + (item.isCurrent ? ' float-nav-item--current' : '');
                        row.setAttribute('aria-label', item.label);
                        row.appendChild(rowText(item.label));
                        row.appendChild(iconTile(item.svg));
                        menu.appendChild(row);

                        row.addEventListener('click', function(e) {
                            e.stopPropagation();
                            if (editMode) return;
                            if (item.type === 'link' && isActive(item)) { closeMenu(); return; }
                            closeMenu(function() {
                                if (item.type === 'link') navigateViaApp(item.href);
                                else clickSidebarButton(item.label);
                            });
                        });
                    });

                    appendMenuActions(menu, true);

                    menu.style.display = 'flex';
                    menu.style.pointerEvents = 'auto';
                    menuOpen = true;

                    setMenuBtnOpen(true);

                    // Animate: rows fade in with a short stagger
                    var rows = menu.querySelectorAll('.float-nav-item');
                    rows.forEach(function(el, i) {
                        el.style.opacity = '0';
                        el.style.transform = 'translateX(-14px)';
                        setTimeout(function() {
                            el.style.transition = 'opacity 0.26s ease, transform 0.34s cubic-bezier(0.2,0.9,0.25,1.2)';
                            el.style.opacity = '1';
                            el.style.transform = 'translateX(0)';
                            setTimeout(function() { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; }, 380);
                        }, 60 + i * 32);
                    });
                }

                function closeMenu(onComplete) {
                    var menu = document.getElementById('android-floating-menu');
                    menuOpen = false;

                    setMenuBtnOpen(false);

                    if (!menu) { if (onComplete) onComplete(); return; }
                    menu.style.pointerEvents = 'none';

                    // Close atomically so an old hide timer cannot hide a reopened menu.
                    menu.style.display = 'none';
                    if (onComplete) onComplete();
                }

                function isReaderOpen() { return !!document.querySelector('[data-manga-reader-bar="true"]'); }
                function isDrawerOpen() {
                    if (document.querySelector('[data-vaul-drawer][data-state="open"]')) return true;
                    if (document.querySelector('.UI-Drawer__content[data-state="open"]')) return true;
                    // Tablet: the rail stays under a sheet's overlay, so the page beside it does not jump
                    if (TABLET_UI) return false;
                    if (document.querySelector('.UI-Modal__overlay[data-state="open"]')) return true;
                    if (document.querySelector('.UI-Modal__content[data-state="open"]')) return true;
                    return false;
                }
                function updateNavVisibility() {
                    var nav = document.getElementById('__seanime_bottom_nav');
                    if (!nav) return;
                    if (isReaderOpen() || isDrawerOpen()) {
                        nav.classList.remove('visible');
                    } else if (document.querySelector('.UI-AppSidebar__sidebar')) {
                        nav.classList.add('visible');
                    }
                }
                // The bar hides under open sheets and the manga reader. Only sheets are observed for data-state.
                var SHEETS = '[data-vaul-drawer], .UI-Drawer__content, .UI-Modal__overlay, .UI-Modal__content';
                var sheetStateObserver = new MutationObserver(updateNavVisibility);
                function watchSheet(el) { sheetStateObserver.observe(el, { attributes: true, attributeFilter: ['data-state'] }); }
                new MutationObserver(function(mutations) {
                    var needsCheck = false;
                    mutations.forEach(function(m) {
                        m.addedNodes.forEach(function(node) {
                            if (node.nodeType !== 1) return;
                            if (node.matches(SHEETS)) { watchSheet(node); needsCheck = true; }
                            node.querySelectorAll(SHEETS).forEach(function(c) { watchSheet(c); needsCheck = true; });
                        });
                        // A dialog can be unmounted while still "open" (its page re-renders), without a closing state change.
                        m.removedNodes.forEach(function(node) {
                            if (node.nodeType === 1 && (node.matches(SHEETS) || node.querySelector(SHEETS))) needsCheck = true;
                        });
                    });
                    if (needsCheck) updateNavVisibility();
                }).observe(document.body, { childList: true, subtree: true });
                document.querySelectorAll(SHEETS).forEach(watchSheet);

                function waitForReady() {
                    if (document.querySelector('.UI-AppSidebar__sidebar')) { updateNavVisibility(); return; }
                    var obs = new MutationObserver(function() {
                        if (document.querySelector('.UI-AppSidebar__sidebar')) { obs.disconnect(); updateNavVisibility(); }
                    });
                    obs.observe(document.body, { childList: true, subtree: true });
                }
                function updateActiveState() {
                    var nav = document.getElementById('__seanime_bottom_nav');
                    if (!nav) return;
                    nav.querySelectorAll('a[data-nav-id]').forEach(function(link) {
                        var item = getItem(link.getAttribute('data-nav-id'));
                        var active = !!item && isActive(item);
                        link.setAttribute('data-active', String(active));
                        if (active) link.setAttribute('aria-current', 'page');
                        else link.removeAttribute('aria-current');
                    });
                    if (menuOpen) closeMenu();
                }

                // Edit mode
                function enterEditMode() {
                    editMode = true;
                    // The open menu becomes the edit panel.
                    if (menuOpen) {
                        menuOpen = false;
                        setMenuBtnOpen(false);
                    }
                    var nav = document.getElementById('__seanime_bottom_nav');
                    if (nav) nav.classList.add('seanime-edit-mode');
                    refreshFloatItems();
                    buildEditFloatPanel();
                }

                function exitEditMode() {
                    editMode = false;

                    var nav  = document.getElementById('__seanime_bottom_nav');
                    var menu = document.getElementById('android-floating-menu');

                    if (nav)  nav.classList.remove('seanime-edit-mode');
                    if (menu) { menu.classList.remove('seanime-edit-mode'); menu.style.display = 'none'; menu.innerHTML = ''; }

                    saveFloatOrder(floatSidebarItems.map(function(it) { return it.label; }));
                    saveNavState();
                    refreshNavBar();

                    setMenuBtnOpen(false);
                }

                function toggleEditMode() { if (editMode) exitEditMode(); else enterEditMode(); }

                var editNoticeTimer = null;

                function updateEditCount() {
                    var cnt = document.getElementById('__seanime_edit_count');
                    if (!cnt) return;
                    cnt.classList.remove('is-warn');
                    cnt.textContent = navText('In the bar: ', 'In der Leiste: ') + navCount() + '/' + MAX_NAV_ITEMS;
                }

                // Short message in the panel header; optional row pulses so the cause is visible.
                function showEditNotice(msg, rowEl) {
                    var cnt = document.getElementById('__seanime_edit_count');
                    if (cnt) { cnt.textContent = msg; cnt.classList.add('is-warn'); }
                    if (rowEl) {
                        rowEl.classList.remove('seanime-row-pulse');
                        void rowEl.offsetWidth;
                        rowEl.classList.add('seanime-row-pulse');
                        setTimeout(function() { rowEl.classList.remove('seanime-row-pulse'); }, 1300);
                    }
                    if (editNoticeTimer) clearTimeout(editNoticeTimer);
                    editNoticeTimer = setTimeout(updateEditCount, 2200);
                }

                function makeEditRow(section, label, svgStr, isCurrent) {
                    var row = asButton(document.createElement('div'));
                    row.className = 'float-nav-item' + (isCurrent ? ' float-nav-item--current' : '');
                    row.dataset.section = section;
                    row.appendChild(iconTile(svgStr));
                    row.appendChild(rowText(label));
                    row.addEventListener('contextmenu', suppressDefault);
                    return row;
                }

                // Drag handle of a bar tile or panel row; dragging starts on touch, in edit mode only.
                function dragHandle(className, startDrag) {
                    var handle = document.createElement('div');
                    handle.className = className;
                    handle.innerHTML = SVG_GRIP;
                    handle.setAttribute('aria-hidden', 'true');
                    handle.addEventListener('contextmenu', suppressDefault);
                    handle.addEventListener('touchstart', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (editMode) startDrag(e.touches[0]);
                    }, { passive: false });
                    return handle;
                }
                function attachRowHandle(row, startDrag) {
                    var handle = dragHandle('float-drag-handle', startDrag);
                    handle.addEventListener('click', function(e) { e.stopPropagation(); });
                    row.appendChild(handle);
                }

                function editSection(name, title) {
                    var section = document.createElement('div');
                    section.className = 'seanime-edit-sec';
                    section.dataset.section = name;
                    var heading = document.createElement('div');
                    heading.className = 'seanime-edit-sec-title';
                    heading.textContent = title;
                    section.appendChild(heading);
                    return section;
                }

                // Edit panel: header (title, counter, hint, Done) and the sections bar / menu.
                // Tapping moves an entry between bar and menu, the drag handle reorders or places it.
                function buildEditFloatPanel() {
                    var menu = document.getElementById('android-floating-menu');
                    if (!menu) return;
                    var oldScroll = menu.querySelector('.seanime-edit-scroll');
                    var prevTop = oldScroll ? oldScroll.scrollTop : 0;
                    menu.innerHTML = '';
                    menu.style.display = 'flex';
                    menu.style.pointerEvents = 'auto';
                    menu.classList.add('seanime-edit-mode');

                    var hiddenMap = loadFloatHidden();

                    // Fixed header
                    var head = document.createElement('div');
                    head.className = 'seanime-edit-head';
                    var headRow = document.createElement('div');
                    headRow.className = 'seanime-edit-head-row';
                    var title = document.createElement('div');
                    title.className = 'seanime-edit-title';
                    title.setAttribute('role', 'heading');
                    title.setAttribute('aria-level', '2');
                    title.textContent = navText('Customize navigation', 'Navigation anpassen');
                    var done = document.createElement('button');
                    done.id = '__seanime_edit_done_btn';
                    done.className = 'seanime-edit-done';
                    done.type = 'button';
                    done.textContent = navText('Done', 'Fertig');
                    done.addEventListener('click', function(e) { e.stopPropagation(); exitEditMode(); });
                    headRow.appendChild(title);
                    headRow.appendChild(done);
                    var count = document.createElement('div');
                    count.id = '__seanime_edit_count';
                    count.className = 'seanime-edit-count';
                    count.setAttribute('aria-live', 'polite');
                    var hint = document.createElement('div');
                    hint.className = 'seanime-edit-hint';
                    hint.textContent = navText('Tap an item to move it into the bar or back into the menu. Up to ' + MAX_NAV_ITEMS + ' in the bar. Drag to reorder.',
                        'Tippe einen Eintrag, um ihn in die Leiste zu holen oder zurück ins Menü zu geben. Maximal ' + MAX_NAV_ITEMS + ' in der Leiste. Ziehen ordnet die Reihenfolge.');
                    head.appendChild(headRow);
                    head.appendChild(count);
                    head.appendChild(hint);
                    menu.appendChild(head);

                    var scroll = document.createElement('div');
                    scroll.className = 'seanime-edit-scroll';
                    menu.appendChild(scroll);

                    var secBar = editSection('bar', navText('In the bar', 'In der Leiste'));
                    NAV_ITEMS.filter(function(it) { return it.placement === 'nav'; }).forEach(function(item) {
                        var row = makeEditRow('bar', item.label, item.isMenu ? SVG_HAMBURGER : item.svg, isActive(item));
                        row.dataset.navId = item.id;
                        if (item.isMenu || item.immovableToFloat) {
                            row.setAttribute('aria-label', item.label + navText(' – always stays in the bar', ' – bleibt immer in der Leiste'));
                            var fixed = document.createElement('span');
                            fixed.className = 'seanime-edit-fixed';
                            fixed.textContent = navText('Fixed', 'Fest');
                            row.appendChild(fixed);
                        } else {
                            row.setAttribute('aria-label', item.label + navText(' – move back to the menu', ' – zurück ins Menü geben'));
                            var check = document.createElement('span');
                            check.className = 'seanime-edit-check';
                            check.setAttribute('aria-hidden', 'true');
                            check.innerHTML = SVG_CHECK;
                            row.appendChild(check);
                            attachRowHandle(row, function() { startRowDrag(row, 'barrow', item, null); });
                        }
                        row.addEventListener('click', function(e) {
                            e.stopPropagation();
                            if (!editMode) return;
                            removeNavToFloat(item);
                        });
                        secBar.appendChild(row);
                    });
                    scroll.appendChild(secBar);
                    scroll.appendChild(divider());

                    // Same order as the regular menu
                    var secMenu = editSection('menu', navText('In the menu', 'Im Menü'));
                    var reversed = floatSidebarItems.slice().reverse();
                    if (!reversed.length) {
                        var empty = document.createElement('div');
                        empty.className = 'seanime-edit-sec-empty';
                        empty.textContent = navText('No more items in the menu.', 'Keine weiteren Einträge im Menü.');
                        secMenu.appendChild(empty);
                    }
                    reversed.forEach(function(item) {
                        var row = makeEditRow('menu', item.label, item.svg, item.isCurrent);
                        row.dataset.floatLabel = item.label;
                        var hidden = !!hiddenMap[item.label];
                        if (hidden) {
                            row.setAttribute('data-hidden', 'true');
                            row.querySelector('.float-nav-tooltip').textContent = item.label + navText(' (hidden)', ' (ausgeblendet)');
                        }
                        row.setAttribute('aria-label', item.label + navText(' – move into the bar', ' – in die Leiste holen'));
                        attachRowHandle(row, function() { startRowDrag(row, 'menurow', null, item); });
                        row.addEventListener('click', function(e) {
                            e.stopPropagation();
                            if (!editMode) return;
                            addFloatToNav(item, -1, row);
                        });
                        secMenu.appendChild(row);
                    });
                    scroll.appendChild(secMenu);

                    appendMenuActions(scroll, false);

                    scroll.scrollTop = prevTop;
                    updateEditCount();
                }

                // Bar
                function refreshNavBar() {
                    var nav = document.getElementById('__seanime_bottom_nav');
                    if (!nav) return;

                    while (nav.firstChild) nav.removeChild(nav.firstChild);
                    menuBtn = null;

                    NAV_ITEMS.filter(function(it) { return it.placement === 'nav'; }).forEach(function(item) {
                        var el;

                        if (item.isMenu) {
                            el = document.createElement('button');
                            el.setAttribute('data-nav-id', 'menu');
                            el.setAttribute('data-menu-open', menuOpen ? 'true' : 'false');
                            if (menuOpen) el.setAttribute('data-active', 'true');
                            el.innerHTML = SVG_HAMBURGER + '<span>' + item.label + '</span>';
                            menuBtn = el;

                            el.addEventListener('click', function(e) {
                                e.stopPropagation();
                                if (editMode) return;
                                if (menuOpen) closeMenu(); else openMenu();
                            });

                        } else if (item.isSidebarItem) {
                            el = document.createElement('a');
                            el.href = item.href || '#';
                            el.setAttribute('data-nav-id', item.id);
                            el.setAttribute('data-active', 'false');
                            el.innerHTML = item.svg + '<span>' + item.label + '</span>';
                            fitIcon(el);

                            el.addEventListener('click', function(e) {
                                if (editMode) { e.preventDefault(); e.stopPropagation(); return; }
                                if (item.sidebarType === 'link' && item.href) {
                                    e.preventDefault();
                                    navigateViaApp(item.href);
                                } else if (item.sidebarType === 'button') {
                                    clickSidebarButton(item.label);
                                }
                            });

                        } else {
                            el = document.createElement('a');
                            el.href = item.href;
                            el.setAttribute('data-nav-id', item.id);
                            el.setAttribute('data-active', 'false');
                            el.innerHTML = item.svg + '<span>' + item.label + '</span>';

                            el.addEventListener('click', function(e) {
                                e.preventDefault();
                                if (editMode) { e.stopPropagation(); return; }
                                if (!isActive(item)) navigateViaApp(item.href);
                                if (menuOpen) closeMenu();
                            });
                        }

                        el.addEventListener('contextmenu', suppressDefault);
                        el.appendChild(dragHandle('seanime-nav-drag-handle', function() { startNavDrag(el, item); }));
                        nav.appendChild(el);
                    });

                    nav.setAttribute('data-nav-count', String(nav.children.length));
                    if (editMode) nav.classList.add('seanime-edit-mode');
                    updateActiveState();
                }

                // Drag & drop
                var dragState = null;

                function createGhost(sourceEl) {
                    var rect  = sourceEl.getBoundingClientRect();
                    var ghost = sourceEl.cloneNode(true);
                    ghost.className = 'seanime-drag-ghost';
                    ghost.style.width  = rect.width  + 'px';
                    ghost.style.height = rect.height + 'px';
                    ghost.style.left   = rect.left   + 'px';
                    ghost.style.top    = rect.top    + 'px';
                    ghost.querySelectorAll('.seanime-nav-drag-handle,.float-drag-handle').forEach(function(h) { h.remove(); });
                    document.body.appendChild(ghost);
                    return ghost;
                }
                function moveGhost(ghost, cx, cy) {
                    ghost.style.left = (cx - parseFloat(ghost.style.width)  / 2) + 'px';
                    ghost.style.top  = (cy - parseFloat(ghost.style.height) / 2) + 'px';
                }
                function clearDropTargets() {
                    document.querySelectorAll('.seanime-drop-target,.seanime-float-drop-target').forEach(function(el) {
                        el.classList.remove('seanime-drop-target', 'seanime-float-drop-target');
                    });
                }
                function navElAt(x, y) {
                    var nav = document.getElementById('__seanime_bottom_nav');
                    if (!nav) return null;
                    var best = null;
                    nav.querySelectorAll('a, button').forEach(function(el) {
                        if (inRect(el.getBoundingClientRect(), x, y)) best = el;
                    });
                    return best;
                }
                function isOverNav(x, y) {
                    var nav = document.getElementById('__seanime_bottom_nav');
                    return !!nav && inRect(nav.getBoundingClientRect(), x, y);
                }
                function inRect(r, x, y) { return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
                function editScrollEl() {
                    var m = document.getElementById('android-floating-menu');
                    return m ? m.querySelector('.seanime-edit-scroll') : null;
                }
                // Only rows/sections that are actually visible inside the scroll area count as drop targets.
                function editHitAt(selector, x, y) {
                    var sc = editScrollEl();
                    if (!sc || !inRect(sc.getBoundingClientRect(), x, y)) return null;
                    var best = null;
                    sc.querySelectorAll(selector).forEach(function(el) {
                        if (inRect(el.getBoundingClientRect(), x, y)) best = el;
                    });
                    return best;
                }
                // Resolves what is under the finger: a bar tile, a panel row or a panel section.
                function dropTargetAt(x, y) {
                    var nt = navElAt(x, y);
                    if (nt) return { zone: 'bar', id: nt.getAttribute('data-nav-id'), el: nt, inNav: true };
                    var row = editHitAt('.float-nav-item[data-section]', x, y);
                    if (row) {
                        if (row.dataset.section === 'bar') return { zone: 'bar', id: row.dataset.navId, el: row };
                        return { zone: 'menu', label: row.dataset.floatLabel, el: row };
                    }
                    var sec = editHitAt('.seanime-edit-sec', x, y);
                    if (sec) return { zone: sec.dataset.section, el: sec };
                    if (isOverNav(x, y)) return { zone: 'bar', el: null, inNav: true };
                    return null;
                }

                function startNavDrag(navEl, item) {
                    var ghost = createGhost(navEl);
                    navEl.style.opacity = '0.3';
                    dragState = { type: 'nav', item: item, originEl: navEl, ghost: ghost, moved: false };
                }
                // Drag from a panel row: 'barrow' carries a nav item, 'menurow' a sidebar item.
                function startRowDrag(row, type, navItem, sidebarItem) {
                    var ghost = createGhost(row);
                    ghost.classList.add('seanime-drag-ghost--row');
                    row.style.opacity = '0.35';
                    dragState = { type: type, item: navItem, sidebarItem: sidebarItem, originEl: row, ghost: ghost, moved: false };
                }

                function onDragMove(cx, cy) {
                    if (!dragState) return;
                    dragState.moved = true;
                    moveGhost(dragState.ghost, cx, cy);
                    clearDropTargets();
                    var t = dropTargetAt(cx, cy);
                    if (t && t.el && t.el !== dragState.originEl) {
                        t.el.classList.add(t.inNav ? 'seanime-drop-target' : 'seanime-float-drop-target');
                    }
                }

                // Removes the ghost and highlights; returns the finished drag.
                function endDrag() {
                    var ds = dragState;
                    dragState = null;
                    clearDropTargets();
                    if (ds.ghost && ds.ghost.parentNode) ds.ghost.parentNode.removeChild(ds.ghost);
                    if (ds.originEl) ds.originEl.style.opacity = '';
                    return ds;
                }

                function onDragEnd(cx, cy) {
                    if (!dragState) return;
                    var ds = endDrag();
                    if (!ds.moved) return;

                    var t = dropTargetAt(cx, cy);
                    if (!t) return;

                    if (ds.type === 'menurow') {
                        if (t.zone === 'bar') {
                            var idx = -1;
                            if (t.id) NAV_ITEMS.forEach(function(it, i) { if (it.id === t.id) idx = i; });
                            addFloatToNav(ds.sidebarItem, idx, null);
                        } else if (t.zone === 'menu' && t.label && t.el !== ds.originEl) {
                            reorderFloatSidebarItems(ds.originEl, t.el);
                        }
                    } else {
                        if (t.zone === 'bar') {
                            if (t.id && t.id !== ds.item.id) reorderNavItems(ds.item.id, t.id);
                        } else if (t.zone === 'menu') {
                            removeNavToFloat(ds.item);
                        }
                    }
                }

                function afterNavChange() {
                    saveNavState();
                    saveFloatOrder(floatSidebarItems.map(function(it) { return it.label; }));
                    refreshNavBar();
                    if (editMode) buildEditFloatPanel();
                }

                function reorderNavItems(idA, idB) {
                    var ia = -1, ib = -1;
                    NAV_ITEMS.forEach(function(it, i) { if (it.id === idA) ia = i; if (it.id === idB) ib = i; });
                    if (ia === -1 || ib === -1) return;
                    var tmp = NAV_ITEMS[ia]; NAV_ITEMS[ia] = NAV_ITEMS[ib]; NAV_ITEMS[ib] = tmp;
                    afterNavChange();
                }

                function reorderFloatSidebarItems(fromRow, toRow) {
                    var fromLabel = fromRow.dataset.floatLabel;
                    var toLabel   = toRow.dataset.floatLabel;
                    var fi = -1, ti = -1;
                    floatSidebarItems.forEach(function(it, i) {
                        if (it.label === fromLabel) fi = i;
                        if (it.label === toLabel)   ti = i;
                    });
                    if (fi === -1 || ti === -1) return;
                    var tmp = floatSidebarItems[fi];
                    floatSidebarItems[fi] = floatSidebarItems[ti];
                    floatSidebarItems[ti] = tmp;
                    saveFloatOrder(floatSidebarItems.map(function(it) { return it.label; }));
                    buildEditFloatPanel();
                }

                // Default insert position: end of the bar, but before the Menu button when that is last.
                function defaultNavInsertIndex() {
                    var last = -1;
                    NAV_ITEMS.forEach(function(it, i) { if (it.placement === 'nav') last = i; });
                    if (last === -1) return NAV_ITEMS.length;
                    return NAV_ITEMS[last].isMenu ? last : last + 1;
                }

                // Bring a menu entry into the bar. Nothing falls out; refuses (with feedback) at MAX_NAV_ITEMS.
                function addFloatToNav(sidebarItem, insertIndex, rowEl) {
                    if (!sidebarItem) return false;
                    if (isAndroidRemovedOfflineItem(sidebarItem)) return false;
                    if (navCount() >= MAX_NAV_ITEMS) {
                        showEditNotice(navText('The bar is full (', 'Leiste ist voll (') + MAX_NAV_ITEMS + '/' + MAX_NAV_ITEMS + ')', rowEl);
                        return false;
                    }
                    var existing = null;
                    NAV_ITEMS.forEach(function(it) { if (!existing && !it.isMenu && sameTarget(it, sidebarItem)) existing = it; });
                    if (existing && existing.placement === 'nav') return false;

                    var idx = (typeof insertIndex === 'number' && insertIndex >= 0) ? insertIndex : defaultNavInsertIndex();
                    var entry;
                    if (existing) {
                        // Same target already known (older state / default item): move it back instead of duplicating.
                        var ei = NAV_ITEMS.indexOf(existing);
                        NAV_ITEMS.splice(ei, 1);
                        if (ei < idx) idx--;
                        existing.placement = 'nav';
                        entry = existing;
                    } else {
                        entry = {
                            id: '__float_' + sidebarItem.label.replace(/\W/g, '_'),
                            href: sidebarItem.href || null,
                            label: sidebarItem.label,
                            matchExact: false,
                            placement: 'nav',
                            isSidebarItem: true,
                            sidebarType: sidebarItem.type,
                            svg: sidebarItem.svg,
                            immovableToFloat: false
                        };
                    }
                    NAV_ITEMS.splice(Math.min(idx, NAV_ITEMS.length), 0, entry);

                    floatSidebarItems = floatSidebarItems.filter(function(it) { return !sameTarget(it, sidebarItem); });
                    var hMap = loadFloatHidden();
                    if (hMap[sidebarItem.label]) { hMap[sidebarItem.label] = false; saveFloatHidden(hMap); }

                    afterNavChange();
                    return true;
                }

                // Give a bar entry back to the menu. The Menu button always stays in the bar.
                function removeNavToFloat(navItem) {
                    if (!navItem) return false;
                    if (navItem.isMenu || navItem.immovableToFloat) {
                        var menuRow = document.querySelector('#android-floating-menu .float-nav-item[data-nav-id="' + navItem.id + '"]');
                        showEditNotice(navText('Menu always stays in the bar', 'Menü bleibt immer in der Leiste'), menuRow);
                        return false;
                    }
                    navItem.placement = 'float';
                    var pill = navItemToFloatPill(navItem);
                    floatSidebarItems = floatSidebarItems.filter(function(it) { return !sameTarget(it, pill); });
                    floatSidebarItems.push(pill);
                    afterNavChange();
                    return true;
                }

                // The texts are set on every open, so they follow a language change.
                function setResetDialogTexts(overlay) {
                    overlay.querySelector('#__seanime_reset_dialog_title').textContent = navText('Reset to defaults?', 'Auf Standard zurücksetzen?');
                    overlay.querySelector('#__seanime_reset_dialog_desc').textContent = navText(
                        'This will restore the default bottom nav and reset your floating menu customizations.',
                        'Die Standard-Navigation unten wird wiederhergestellt und deine Anpassungen am schwebenden Menü werden zurückgesetzt.');
                    var buttons = overlay.querySelectorAll('.__seanime_dialog_btn');
                    buttons[0].textContent = navText('Cancel', 'Abbrechen');
                    buttons[1].textContent = navText('Yes', 'Ja');
                }

                function buildResetDialog() {
                    if (document.getElementById('__seanime_reset_dialog_overlay')) return;

                    var overlay = document.createElement('div');
                    overlay.id = '__seanime_reset_dialog_overlay';

                    var dialog = document.createElement('div');
                    dialog.id = '__seanime_reset_dialog';
                    dialog.setAttribute('role', 'dialog');
                    dialog.setAttribute('aria-modal', 'true');
                    dialog.setAttribute('aria-labelledby', '__seanime_reset_dialog_title');
                    dialog.setAttribute('aria-describedby', '__seanime_reset_dialog_desc');

                    var title = document.createElement('div');
                    title.id = '__seanime_reset_dialog_title';

                    var desc = document.createElement('div');
                    desc.id = '__seanime_reset_dialog_desc';

                    var actions = document.createElement('div');
                    actions.id = '__seanime_reset_dialog_actions';

                    var cancelBtn = document.createElement('button');
                    cancelBtn.className = '__seanime_dialog_btn';

                    var yesBtn = document.createElement('button');
                    yesBtn.className = '__seanime_dialog_btn __seanime_dialog_btn_danger';

                    actions.appendChild(cancelBtn);
                    actions.appendChild(yesBtn);

                    dialog.appendChild(title);
                    dialog.appendChild(desc);
                    dialog.appendChild(actions);

                    overlay.appendChild(dialog);
                    document.body.appendChild(overlay);

                    overlay.addEventListener('click', function() { hideResetDialog(); });
                    dialog.addEventListener('click', function(e) { e.stopPropagation(); });

                    cancelBtn.addEventListener('click', function(e) { e.stopPropagation(); hideResetDialog(); });
                    yesBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        hideResetDialog();
                        resetToDefaults();
                    });

                    overlay.addEventListener('contextmenu', suppressDefault);
                    dialog.addEventListener('contextmenu', suppressDefault);
                }

                function showResetDialog() {
                    buildResetDialog();
                    var overlay = document.getElementById('__seanime_reset_dialog_overlay');
                    if (!overlay) return;
                    setResetDialogTexts(overlay);
                    overlay.classList.add('visible');
                    overlay.querySelector('button').focus();
                }

                function hideResetDialog() {
                    var overlay = document.getElementById('__seanime_reset_dialog_overlay');
                    if (!overlay) return;
                    overlay.classList.remove('visible');
                    var reset = document.getElementById('__seanime_reset_btn');
                    if (reset) reset.focus();
                }

                document.addEventListener('touchmove', function(e) {
                    if (!dragState) return;
                    e.preventDefault();
                    var t = e.touches[0];
                    onDragMove(t.clientX, t.clientY);
                }, { passive: false });
                document.addEventListener('touchend', function(e) {
                    if (!dragState) return;
                    var t = e.changedTouches[0];
                    onDragEnd(t.clientX, t.clientY);
                }, { passive: true });
                document.addEventListener('touchcancel', function() {
                    if (dragState) endDrag();
                }, { passive: true });

                // Runs again whenever the bar was removed from the page.
                function buildNav() {
                    if (document.getElementById('__seanime_bottom_nav')) return;

                    if (!document.getElementById('android-floating-menu')) {
                        var floatMenu = document.createElement('div');
                        floatMenu.id = 'android-floating-menu';
                        floatMenu.style.cssText = 'position:fixed;z-index:999998;display:none;flex-direction:column;';
                        document.body.appendChild(floatMenu);
                    }

                    var nav = document.createElement('nav');
                    nav.id = '__seanime_bottom_nav';
                    nav.addEventListener('contextmenu', suppressDefault);
                    document.body.appendChild(nav);

                    refreshNavBar();
                    buildResetDialog();
                    waitForReady();
                }

                buildNav();

                // A tap outside leaves edit mode or closes the menu.
                document.addEventListener('click', function(e) {
                    function inside(id) {
                        var el = document.getElementById(id);
                        return !!el && el.contains(e.target);
                    }
                    if (editMode) {
                        if (!inside('__seanime_bottom_nav') && !inside('android-floating-menu') && !inside('__seanime_reset_dialog_overlay')) exitEditMode();
                    } else if (menuOpen && !inside('android-floating-menu')) {
                        closeMenu();
                    }
                });

                window.__seanimeCloseNavigation = function() {
                    var reset = document.getElementById('__seanime_reset_dialog_overlay');
                    if (reset && reset.classList.contains('visible')) { hideResetDialog(); return true; }
                    if (editMode) { exitEditMode(); return true; }
                    if (menuOpen) { closeMenu(); return true; }
                    return false;
                };
                document.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape' && !e.defaultPrevented && window.__seanimeCloseNavigation()) {
                        e.preventDefault(); e.stopPropagation();
                    }
                    var reset = document.getElementById('__seanime_reset_dialog_overlay');
                    if (e.key === 'Tab' && reset && reset.classList.contains('visible')) {
                        var buttons = reset.querySelectorAll('button');
                        var next = document.activeElement === buttons[0] ? buttons[1] : buttons[0];
                        e.preventDefault(); next.focus();
                    }
                });

                var resizeThrottle = null;
                window.addEventListener('resize', function() {
                    if (resizeThrottle) return;
                    resizeThrottle = setTimeout(function() {
                        resizeThrottle = null;
                        buildNav();
                        updateNavVisibility();
                    }, 150);
                });

                function onRouteChange() { setTimeout(function() { updateActiveState(); updateNavVisibility(); }, 50); }
                var _push = history.pushState.bind(history);
                history.pushState = function() { _push.apply(history, arguments); onRouteChange(); };
                var _replace = history.replaceState.bind(history);
                history.replaceState = function() { _replace.apply(history, arguments); onRouteChange(); };
                window.addEventListener('popstate', onRouteChange);

                var navVisThrottle = null;
                new MutationObserver(function() {
                    if (!document.getElementById('__seanime_bottom_nav')) {
                        if (navVisThrottle) return;
                        navVisThrottle = setTimeout(function() {
                            navVisThrottle = null;
                            menuBtn = null;
                            buildNav();
                        }, 50);
                    } else if (/\/manga\/entry/.test(window.location.pathname)) {
                        if (navVisThrottle) return;
                        navVisThrottle = setTimeout(function() { navVisThrottle = null; updateNavVisibility(); }, 200);
                    }
                }).observe(document.body, { childList: true, subtree: true });

            }
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }
}
