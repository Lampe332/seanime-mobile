package com.seanime.app

import android.webkit.WebView

/** One vector catalogue shared with the embedded frontend. Never copy sidebar styling into navigation. */
object MobileIcons {
    fun inject(view: WebView) {
        val definitions = view.context.assets.open("icons.json").bufferedReader().use { it.readText() }
        view.evaluateJavascript("""
            (function() {
                var definitions = $definitions;
                function svg(name) {
                    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (definitions.paths[name] || definitions.paths.fallback) + '</svg>';
                }
                function forItem(item) {
                    var path = '';
                    try { path = new URL(item.href, location.origin).pathname; } catch(e) {}
                    var name = definitions.ids[item.id] || definitions.routes[path] || definitions.actions[item.label];
                    if (item.href && item.href.indexOf('id=seanime-download-notifier') >= 0) name = 'notifier';
                    return name ? svg(name) : '';
                }
                function clean(source) {
                    var root = new DOMParser().parseFromString(source || '', 'image/svg+xml').documentElement;
                    if (root.localName !== 'svg' || root.querySelector('parsererror')) return svg('fallback');
                    var allowed = ['svg','g','path','circle','rect','line','polyline','polygon','ellipse'];
                    var attrs = ['viewBox','d','cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','width','height','points','fill','fill-rule','clip-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','transform'];
                    [root].concat(Array.from(root.querySelectorAll('*'))).forEach(function(el) {
                        if (allowed.indexOf(el.localName) < 0) { el.remove(); return; }
                        Array.from(el.attributes).forEach(function(a) { if (attrs.indexOf(a.name) < 0) el.removeAttribute(a.name); });
                    });
                    if (!root.querySelector('path,circle,rect,line,polyline,polygon,ellipse')) return svg('fallback');
                    var bounds = (root.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
                    if (bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0) return svg('fallback');
                    root.setAttribute('aria-hidden','true');
                    return root.outerHTML;
                }
                window.__seanimeIcons = {svg:svg, forItem:forItem, clean:clean};
            })();
        """.trimIndent(), null)
    }
}
