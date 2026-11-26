// geschrieben nach: Expo Modules API (Module, ModuleDefinition, AsyncFunction.runOnQueue(Queues.MAIN), OnActivityEntersForeground/-Background, OnUserLeavesActivity) und der Android-Doku Activity.setRecentsScreenshotEnabled (API 33) / WindowManager.LayoutParams.FLAG_SECURE; Muster: modules/core-download
package com.seanime.applockrecents

import android.app.Activity
import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/*
 * The app lock keeps the app's content out of the recent apps screen while its switch is on (src/lib/app-lock/app-lock.ts).
 * Android 13 and later: the activity gives the system no screenshot for recents; normal screenshots keep working.
 * Before Android 13 there is no such switch: FLAG_SECURE only while the app is away (from leaving to coming back), so
 * recents gets a blank picture and screenshots inside the app keep working. The activity can be recreated, so the wish
 * is kept here and applied again whenever it comes to the front.
 */
class AppLockRecentsModule : Module() {
    @Volatile
    private var hidden = false
    private var ownsSecureFlag = false

    override fun definition() = ModuleDefinition {
        Name("SeanimeAppLockRecents")

        AsyncFunction("setRecentsHidden") { value: Boolean ->
            hidden = value
            appContext.currentActivity?.let { apply(it, away = false) }
        }.runOnQueue(Queues.MAIN)

        OnActivityEntersForeground {
            appContext.currentActivity?.let { apply(it, away = false) }
        }

        // Home and the recents button: before onPause, so the flag is set before the system takes its picture
        OnUserLeavesActivity {
            appContext.currentActivity?.let { apply(it, away = true) }
        }

        OnActivityEntersBackground {
            appContext.currentActivity?.let { apply(it, away = true) }
        }
    }

    private fun apply(activity: Activity, away: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.setRecentsScreenshotEnabled(!hidden)
            return
        }
        // the account prompts set FLAG_SECURE themselves (expo-screen-capture): only a flag set here is cleared here
        val window = activity.window
        val secure = WindowManager.LayoutParams.FLAG_SECURE
        if (hidden && away) {
            if ((window.attributes.flags and secure) == 0) {
                window.addFlags(secure)
                ownsSecureFlag = true
            }
        }
        else if (ownsSecureFlag) {
            window.clearFlags(secure)
            ownsSecureFlag = false
        }
    }
}
