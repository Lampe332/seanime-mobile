package com.seanime.app.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The new-episode alarm, and restarting it after a reboot or an app update. Only ever runs a check. */
class AiringReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        Thread {
            try {
                AiringNotifier.check(context.applicationContext)
            } finally {
                pending.finish()
            }
        }.start()
    }
}
