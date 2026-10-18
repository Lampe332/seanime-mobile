package com.seanime.app.audit

import android.app.Instrumentation
import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.webkit.WebView
import android.graphics.Bitmap
import java.io.File
import com.seanime.app.MainActivity
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Runs explicit audit probes in the installed release, without enabling WebView debugging. */
class SourceRemovalInstrumentation : Instrumentation() {
    private lateinit var args: Bundle
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        args = arguments ?: Bundle()
        start()
    }
    override fun onStart() {
        val result = Bundle()
        try {
            val activity = startActivitySync(Intent(targetContext, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val field = MainActivity::class.java.getDeclaredField("webView").apply { isAccessible = true }
            val view = field.get(activity) as WebView
            Thread.sleep(args.getString("waitMs", "8000").toLong())
            args.getString("setup")?.let { encoded ->
                val setup = String(Base64.decode(encoded, Base64.DEFAULT), Charsets.UTF_8)
                runOnMainSync { view.evaluateJavascript(setup, null) }
                Thread.sleep(args.getString("settleMs", "5000").toLong())
            }
            val script = String(Base64.decode(args.getString("script", ""), Base64.DEFAULT), Charsets.UTF_8)
            val done = CountDownLatch(1)
            runOnMainSync {
                view.evaluateJavascript(script) { value -> result.putString("stream", value + "\n"); done.countDown() }
            }
            check(done.await(20, TimeUnit.SECONDS)) { "WebView probe timed out" }
            args.getString("screenshot")?.let { name ->
                check(name.matches(Regex("[a-zA-Z0-9_-]+")))
                val bitmap = uiAutomation.takeScreenshot()
                File(targetContext.getExternalFilesDir(null), "$name.png").outputStream().use {
                    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
                }
                bitmap.recycle()
            }
            finish(-1, result)
        } catch (failure: Throwable) {
            result.putString("stream", "FAIL: $failure\n")
            finish(0, result)
        }
    }
}
