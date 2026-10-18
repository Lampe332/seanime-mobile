package com.seanime.app

import android.webkit.WebView

/** Removes the floating launcher injected by the embedded hoster player from Android pages. */
object UIHosterPlayerPatch {
    fun inject(webView: WebView) {
        webView.evaluateJavascript(js, null)
    }

    private val js = """
        (function() {
            var selector = '[id^="pe-host-"]';
            var stateKey = '__seanimeHosterPlayerRemoval';
            var state = window[stateKey];

            function removeLauncher(el) {
                if (!el || !el.parentNode) return;
                var doc = el.ownerDocument;
                var parent = el.parentElement;
                el.remove();
                while (parent && parent !== doc.body && parent !== doc.documentElement &&
                       parent.children.length === 0 && !parent.textContent.trim()) {
                    var next = parent.parentElement;
                    parent.remove();
                    parent = next;
                }
            }

            if (!state) {
                var observedRoots = new WeakSet();
                var observedFrames = new WeakSet();

                function scan(root) {
                    if (!root || !root.querySelectorAll) return;
                    if (root.nodeType === 1 && root.matches(selector)) removeLauncher(root);
                    Array.from(root.querySelectorAll(selector)).forEach(removeLauncher);

                    root.querySelectorAll('iframe').forEach(function(frame) {
                        if (!observedFrames.has(frame)) {
                            observedFrames.add(frame);
                            frame.addEventListener('load', function() {
                                try { observe(frame.contentDocument); } catch (e) {}
                            });
                        }
                        try { observe(frame.contentDocument); } catch (e) {}
                    });

                    root.querySelectorAll('*').forEach(function(el) {
                        if (el.shadowRoot) observe(el.shadowRoot);
                    });
                }

                function observe(root) {
                    if (!root) return;
                    scan(root);
                    if (observedRoots.has(root)) return;
                    observedRoots.add(root);
                    new MutationObserver(function(records) {
                        records.forEach(function(record) {
                            record.addedNodes.forEach(scan);
                        });
                    }).observe(root, { childList: true, subtree: true });
                }

                state = window[stateKey] = { scan: scan, observe: observe };
                observe(document.documentElement || document);
            } else {
                state.scan(document.documentElement || document);
            }
        })();
    """.trimIndent()
}
