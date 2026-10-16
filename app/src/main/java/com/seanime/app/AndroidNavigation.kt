package com.seanime.app

object AndroidNavigation {
    val backScript = """
        (function() {
            if (window.__seanimeCloseNavigation && window.__seanimeCloseNavigation()) return true;
            // Give an open transient menu first refusal before closing its reader.
            var transient = document.querySelector('[role="menu"][data-state="open"], [data-radix-popper-content-wrapper] [role="dialog"]');
            if (transient) {
                transient.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true, cancelable:true}));
                return true;
            }
            var event = new Event('seanime:android-back', {cancelable:true});
            if (!window.dispatchEvent(event)) return true;
            var menuButton = document.querySelector('#__seanime_bottom_nav button[data-menu-open="true"]');
            if (menuButton) { menuButton.click(); return true; }
            var overlay = document.querySelector('.UI-Drawer__content[data-state="open"], .UI-Modal__content[data-state="open"]');
            if (overlay) {
                overlay.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true, cancelable:true}));
                return true;
            }
            return false;
        })();
    """.trimIndent()
}
