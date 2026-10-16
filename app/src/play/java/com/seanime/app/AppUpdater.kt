package com.seanime.app

import android.app.Activity
import android.webkit.WebView

/**
 * Google Play variant: the app never updates itself, Google Play does.
 * Same API as the GitHub variant (src/github), but no network access, no JS injection,
 * no APK download and no install flow.
 */
object AppUpdater {
    @Suppress("UNUSED_PARAMETER")
    fun init(activity: Activity, webView: WebView) = Unit

    @Suppress("UNUSED_PARAMETER")
    fun inject(webView: WebView) = Unit

    @Suppress("UNUSED_PARAMETER")
    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray) = Unit
}
