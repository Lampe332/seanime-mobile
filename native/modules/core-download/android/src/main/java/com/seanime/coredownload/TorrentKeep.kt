// geschrieben nach: Android-Doku "Foreground services" (startForeground mit Typ dataSync, Android 14+), "Keep the device awake" (PARTIAL_WAKE_LOCK); docs/EIGENER-KERN.md §4q Phase 6f; kein Server-Quelltext
package com.seanime.coredownload

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/*
 * Phase 6f: the torrent client of the core downloads in the torrent module's own thread (C++, core-torrent). Without
 * the server's service nothing keeps the app's process in front of the system while the app is in the background, so
 * Android freezes it and the download stands. This service only holds the process: an ongoing notice of the channel
 * the loader already uses (LoaderNotice) and a partial wake lock, while a torrent of the client downloads. It does no
 * work itself; the core starts it with `keepTorrents(true, …)` and ends it with `keepTorrents(false, …)`.
 */
class TorrentKeepService : Service() {
    private var lock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra("title") ?: "Torrent download"
        val notice = LoaderNotice.build(this, title, -1L, 0L)
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTICE, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(NOTICE, notice)
        if (lock == null) {
            val power = getSystemService(Context.POWER_SERVICE) as PowerManager
            lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "seanime:torrent-client").also { it.acquire(LOCK_MS) }
        }
        // the process was ended by the system: the core starts the service again when it resumes its torrents
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        // Android 15: a dataSync service gets about six hours a day; past that the download rests until the app is opened
        stopSelf()
    }

    override fun onDestroy() {
        lock?.let { if (it.isHeld) it.release() }
        lock = null
        super.onDestroy()
    }

    companion object {
        private val NOTICE = LoaderNotice.id(9_999)
        /** The longest a wake lock is held without being renewed by a new start */
        private const val LOCK_MS = 6L * 60L * 60L * 1000L

        fun keep(context: Context, on: Boolean, title: String): Boolean {
            val intent = Intent(context, TorrentKeepService::class.java).putExtra("title", title)
            if (!on) return context.stopService(intent)
            return try {
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
                true
            } catch (failure: Exception) {
                // Android 12 and later refuse a start from the background; the next start in front does it
                false
            }
        }
    }
}
