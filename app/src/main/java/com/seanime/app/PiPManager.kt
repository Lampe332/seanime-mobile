package com.seanime.app

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.util.UUID

class PiPManager(private val activity: Activity, private val webView: WebView) {

    private val controlAction = activity.packageName + ".PIP_CONTROL"
    // Before Android 13 runtime receivers cannot be private; the per-process token rejects foreign broadcasts.
    private val controlToken = UUID.randomUUID().toString()
    private var playing = true
    private var receiverRegistered = false

    private val controlReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.getStringExtra(EXTRA_TOKEN) != controlToken) return
            val action = PiPControls.fromName(intent.getStringExtra(EXTRA_ACTION)) ?: return
            webView.evaluateJavascript(PiPControls.script(action), null)
        }
    }

    @android.annotation.TargetApi(Build.VERSION_CODES.O)
    private fun buildParams(): PictureInPictureParams {
        val actions = PiPControls.actionsFor(activity.maxNumPictureInPictureActions).map { action ->
            val (icon, title) = when (action) {
                PiPControls.Action.REWIND -> R.drawable.ic_pip_rewind to AppLanguage.tr("Back 10 seconds", "10 Sekunden zurück")
                PiPControls.Action.FORWARD -> R.drawable.ic_pip_forward to AppLanguage.tr("Forward 10 seconds", "10 Sekunden vor")
                PiPControls.Action.TOGGLE ->
                    if (playing) R.drawable.ic_pip_pause to AppLanguage.tr("Pause", "Pause")
                    else R.drawable.ic_pip_play to AppLanguage.tr("Play", "Abspielen")
            }
            val intent = Intent(controlAction).setPackage(activity.packageName)
                .putExtra(EXTRA_ACTION, action.name)
                .putExtra(EXTRA_TOKEN, controlToken)
            val pending = PendingIntent.getBroadcast(activity, action.requestCode, intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            RemoteAction(Icon.createWithResource(activity, icon), title, title, pending)
        }
        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .setActions(actions)
        // Video content: avoid the cross-fade of a blurry snapshot while the window resizes.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setSeamlessResizeEnabled(false)
        return builder.build()
    }

    private fun setReceiverRegistered(register: Boolean) {
        if (register == receiverRegistered) return
        if (register) {
            val filter = IntentFilter(controlAction)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.registerReceiver(controlReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                activity.registerReceiver(controlReceiver, filter)
            }
        } else {
            activity.unregisterReceiver(controlReceiver)
        }
        receiverRegistered = register
    }

    fun destroy() = setReceiverRegistered(false)

    // Set while a PiP window exists; expanding resumes the activity, closing the window only stops it.
    private var pipSession = false

    fun onResume() { pipSession = false }

    fun onStop() {
        if (!pipSession) return
        pipSession = false
        webView.evaluateJavascript("document.querySelectorAll('video').forEach(function(v){v.pause()})", null)
    }

    private companion object {
        const val EXTRA_ACTION = "action"
        const val EXTRA_TOKEN = "token"
    }

    inner class PiPBridge {
        @JavascriptInterface
        fun enterPiP(isPlaying: Boolean) {
            activity.runOnUiThread {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    playing = isPlaying
                    setReceiverRegistered(true)
                    if (!activity.enterPictureInPictureMode(buildParams()) && !activity.isInPictureInPictureMode) {
                        setReceiverRegistered(false)
                    }
                }
            }
        }

        /** Called on the PiP video's play/pause events so the button mirrors the real state. */
        @JavascriptInterface
        fun setPiPPlaying(isPlaying: Boolean) {
            activity.runOnUiThread {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || playing == isPlaying) return@runOnUiThread
                playing = isPlaying
                if (activity.isInPictureInPictureMode) activity.setPictureInPictureParams(buildParams())
            }
        }

        @JavascriptInterface
        fun exitPiP() {
            activity.runOnUiThread {
                val intent = Intent(activity, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                activity.startActivity(intent)
            }
        }
    }

    fun registerBridge() {
        webView.addJavascriptInterface(PiPBridge(), "AndroidBridge")
    }

    fun injectHijacker() {
        val js = """
            (function() {
                window.__androidPiPActive = window.__androidPiPActive || false;
                if (window.__seanimePiPControlsObserver) return;

                function hijackVideoControls() {
                    const buttons = document.querySelectorAll('button[data-vc-element="control-button"]:not([data-pip-hijacked])');
                    
                    buttons.forEach(btn => {
                        const isPiPButton = btn.querySelector('path[d^="M11 19h-6"]'); 
                        
                        if (isPiPButton) {
                            btn.setAttribute('data-pip-hijacked', 'true');
                            btn.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                
                                if (window.__androidPiPActive) {
                                    AndroidBridge.exitPiP();
                                } else {
                                    const video = document.querySelector('video');
                                    AndroidBridge.enterPiP(!!video && !video.paused);
                                }
                            }, true); 
                        }
                    });
                }

                const observer = new MutationObserver(() => hijackVideoControls());
                window.__seanimePiPControlsObserver = observer;
                observer.observe(document.body, { childList: true, subtree: true });
                hijackVideoControls();
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    fun onPiPModeChanged(isInPictureInPictureMode: Boolean) {
        if (isInPictureInPictureMode) {
            pipSession = true
            webView.evaluateJavascript("""
                (function() {
                    window.__androidPiPActive = true;
                    if (window.__seanimePiPVideo) return;
                    
                    const menu = document.getElementById('android-floating-menu');
                    if (menu) menu.style.setProperty('display', 'none', 'important');
                    
                    let style = document.getElementById('pip-overlay-style') || document.createElement('style');
                    style.id = 'pip-overlay-style';
                    style.innerHTML = `
                        html, body {
                            width: 100% !important;
                            height: 100% !important;
                            margin: 0 !important;
                            padding: 0 !important;
                            background: black !important;
                            overflow: hidden !important;
                        }
                        body > *:not(video) {
                            display: none !important;
                            visibility: hidden !important;
                            pointer-events: none !important;
                        }
                        video {
                            position: fixed !important;
                            top: 0 !important;
                            left: 0 !important;
                            width: 100% !important;
                            height: 100% !important;
                            object-fit: contain !important;
                            background: black !important;
                            z-index: 9999999 !important;
                            margin: 0 !important;
                            padding: 0 !important;
                            border: none !important;
                            visibility: visible !important;
                        }
                    `;
                    document.head.appendChild(style);

                    const video = document.querySelector('video');
                    if (video) {
                        window.__seanimePiPVideo = video;
                        video.__pipOriginalParent = video.parentElement;
                        video.__pipOriginalNextSibling = video.nextSibling;

                        if (video.parentElement !== document.body) {
                            document.body.appendChild(video);
                        }

                        // PiP window buttons: the player handles them when mounted, otherwise the video directly.
                        window.__seanimePiPCommand = function(command, seconds) {
                            if (window.__seanimePiPVideo !== video) return;
                            const detail = { command: command, seconds: seconds, video: video, handled: false };
                            window.dispatchEvent(new CustomEvent('seanime:pip-command', { detail: detail }));
                            if (detail.handled) return;
                            if (command === 'toggle') {
                                if (video.paused) video.play().catch(function() {}); else video.pause();
                            } else if (command === 'seek' && isFinite(video.duration) && video.duration > 0) {
                                video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
                            }
                        };
                        const controls = new AbortController();
                        window.__seanimePiPControls = controls;
                        const report = function() { AndroidBridge.setPiPPlaying(!video.paused); };
                        video.addEventListener('play', report, { signal: controls.signal });
                        video.addEventListener('pause', report, { signal: controls.signal });
                        report();
                    }
                })();
            """.trimIndent(), null)
        } else {
            setReceiverRegistered(false)
            webView.evaluateJavascript("""
                (function() {
                    window.__androidPiPActive = false;
                    window.__seanimePiPControls?.abort();
                    delete window.__seanimePiPControls;
                    delete window.__seanimePiPCommand;

                    const video = window.__seanimePiPVideo;
                    try {
                        if (video && video.__pipOriginalParent) {
                            const parent = video.__pipOriginalParent;
                            const next = video.__pipOriginalNextSibling;
                            if (parent.isConnected) {
                                if (next && next.parentNode === parent) parent.insertBefore(video, next);
                                else parent.appendChild(video);
                            } else {
                                // The player was closed or replaced while PiP was active.
                                video.pause();
                                video.remove();
                            }
                        }
                    } finally {
                        if (video) {
                            delete video.__pipOriginalParent;
                            delete video.__pipOriginalNextSibling;
                        }
                        delete window.__seanimePiPVideo;
                        document.getElementById('pip-overlay-style')?.remove();
                    }

                    // Reset viewport zoom
                    const viewport = document.querySelector('meta[name="viewport"]');
                    if (viewport) {
                        viewport.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
                    }
                    
                    window.scrollTo(0, 0);
                    document.documentElement.scrollTop = 0;
                    document.body.scrollTop = 0;
                    
                    setTimeout(() => {
                        window.dispatchEvent(new Event('resize'));
                    }, 100);
                })();
            """.trimIndent(), null)
        }
    }
}
