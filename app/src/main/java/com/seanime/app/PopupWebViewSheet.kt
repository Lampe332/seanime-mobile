package com.seanime.app

import android.app.Activity
import android.app.Dialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.FrameLayout.LayoutParams
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import java.net.URI

/** External links open in this bottom sheet instead of replacing the app's own page. */
object PopupWebViewSheet {
    private var activeDialog: Dialog? = null

    fun dismissFor(activity: Activity) {
        if (activeDialog?.ownerActivity === activity) activeDialog?.dismiss()
    }

    fun show(activity: Activity, url: String) {
        if (activity.isFinishing || activity.isDestroyed) return
        activeDialog?.dismiss()
        var backAction: (() -> Unit)? = null
        val dialog = object : Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen) {
            // API 33+ is handled by the OnBackInvokedDispatcher registered below.
            @android.annotation.SuppressLint("GestureBackNavigation")
            @Deprecated("Used for Android versions before API 33")
            override fun onBackPressed() { backAction?.invoke() ?: super.onBackPressed() }
        }
        dialog.setOwnerActivity(activity)
        activeDialog = dialog

        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val screenH = activity.resources.displayMetrics.heightPixels
        val match = ViewGroup.LayoutParams.MATCH_PARENT
        val wrap = ViewGroup.LayoutParams.WRAP_CONTENT

        val root = FrameLayout(activity).apply { setBackgroundColor(Color.parseColor("#99000000")) }
        val card = FrameLayout(activity).apply {
            layoutParams = LayoutParams(match, (screenH * 0.88).toInt()).apply { gravity = Gravity.BOTTOM }
            val radius = 24 * density
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#0f0f14"))
                cornerRadii = floatArrayOf(radius, radius, radius, radius, 0f, 0f, 0f, 0f)
                setStroke(1, Color.parseColor("#1a1a2e"))
            }
        }
        val handle = View(activity).apply {
            layoutParams = LayoutParams(dp(48), dp(4)).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                topMargin = dp(10)
            }
            background = GradientDrawable().apply { setColor(Color.parseColor("#44ffffff")); cornerRadius = 99f }
        }

        val topBarTop = dp(24)
        val topBarHeight = dp(52)
        val topBar = FrameLayout(activity).apply { layoutParams = LayoutParams(match, topBarHeight).apply { topMargin = topBarTop } }
        val hostLabel = TextView(activity).apply {
            text = hostFrom(url)
            setTextColor(Color.parseColor("#88ffffff"))
            textSize = 13f
            typeface = android.graphics.Typeface.DEFAULT
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.MIDDLE
            layoutParams = LayoutParams(wrap, wrap).apply { gravity = Gravity.CENTER }
        }
        val closeButton = TextView(activity).apply {
            text = "✕"
            setTextColor(Color.parseColor("#88ffffff"))
            textSize = 17f
            contentDescription = "Close external page"
            gravity = Gravity.CENTER
            layoutParams = LayoutParams(dp(48), dp(48)).apply {
                gravity = Gravity.CENTER_VERTICAL or Gravity.END
                rightMargin = dp(20)
            }
            setOnClickListener { dismissWithAnim(dialog, card, screenH) }
        }
        topBar.addView(hostLabel)
        topBar.addView(closeButton)

        val dividerTop = topBarTop + topBarHeight
        val divider = View(activity).apply {
            layoutParams = LayoutParams(match, 1).apply { topMargin = dividerTop }
            setBackgroundColor(Color.parseColor("#1affffff"))
        }
        val progressHeight = dp(3)
        val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            layoutParams = LayoutParams(match, progressHeight).apply { topMargin = dividerTop + 1 }
            max = 100
            progressDrawable?.colorFilter = PorterDuffColorFilter(Color.parseColor("#818cf8"), PorterDuff.Mode.SRC_IN)
        }

        val popupWebView = WebView(activity).apply {
            layoutParams = LayoutParams(match, match).apply { topMargin = dividerTop + 1 + progressHeight }
            setBackgroundColor(Color.parseColor("#0f0f14"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            settings.setSupportZoom(true)
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
        }
        popupWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                if (!request.isForMainFrame || uri.scheme == "http" || uri.scheme == "https") return false
                try {
                    val external = if (uri.scheme == "intent") Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                        else Intent(Intent.ACTION_VIEW, uri)
                    external.addCategory(Intent.CATEGORY_BROWSABLE)
                    external.component = null
                    external.selector = null
                    activity.startActivity(external)
                } catch (_: ActivityNotFoundException) {
                    Toast.makeText(activity, "No installed app can open this link", Toast.LENGTH_SHORT).show()
                } catch (_: SecurityException) {
                    Toast.makeText(activity, "Android blocked opening this link", Toast.LENGTH_SHORT).show()
                } catch (_: java.net.URISyntaxException) {
                    Toast.makeText(activity, "This link is invalid", Toast.LENGTH_SHORT).show()
                }
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                hostLabel.text = hostFrom(url ?: "")
                progress.visibility = View.VISIBLE
                progress.progress = 0
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progress.visibility = View.GONE
            }
        }
        popupWebView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress.progress = newProgress
                if (newProgress >= 100) progress.visibility = View.GONE
            }
        }
        popupWebView.loadUrl(url)

        backAction = {
            if (popupWebView.canGoBack()) popupWebView.goBack()
            else dismissWithAnim(dialog, card, screenH)
        }
        dialog.setOnDismissListener {
            if (activeDialog === dialog) activeDialog = null
            popupWebView.stopLoading()
            (popupWebView.parent as? ViewGroup)?.removeView(popupWebView)
            popupWebView.destroy()
            backAction = null
        }

        card.addView(handle)
        card.addView(topBar)
        card.addView(divider)
        card.addView(progress)
        card.addView(popupWebView)
        root.addView(card)
        root.setOnClickListener { dismissWithAnim(dialog, card, screenH) }
        card.setOnClickListener { } // taps on the card must not reach the scrim

        dialog.setContentView(root)
        dialog.window?.apply {
            setLayout(match, match)
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            statusBarColor = Color.TRANSPARENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setDecorFitsSystemWindows(false)
        }

        card.translationY = screenH.toFloat()
        dialog.show()
        if (Build.VERSION.SDK_INT >= 33) {
            dialog.onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) { backAction?.invoke() }
        }
        card.animate().translationY(0f).setDuration(320).setInterpolator(DecelerateInterpolator(2f)).start()
    }

    private fun dismissWithAnim(dialog: Dialog, card: FrameLayout, screenH: Int) {
        card.animate()
            .translationY(screenH.toFloat())
            .setDuration(260)
            .setInterpolator(DecelerateInterpolator(1.5f))
            .withEndAction { dialog.dismiss() }
            .start()
    }

    private fun hostFrom(url: String): String = try {
        URI(url).host ?: url
    } catch (_: Exception) {
        url
    }
}
