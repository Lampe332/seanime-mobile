package com.seanime.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.io.File

class SeanimeService : Service() {

    @Volatile private var process: Process? = null
    @Volatile private var stopping = false
    private var lastStatus: String = "Starting local server"

    private companion object {
        const val CHANNEL_ID = "seanime_channel"
        const val NOTIF_ID = 1
        const val ACTION_STOP_SERVICE = "STOP_SEANIME_SERVICE"
    }

    // A widget refresh can start this service without the app UI, which is where the language is usually loaded.
    override fun onCreate() {
        super.onCreate()
        AppLanguage.init(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP_SERVICE) {
            stopSelf()
            return START_NOT_STICKY
        }

        stopping = false
        createNotificationChannel()

        promoteToForeground(lastStatus)
        startBinary()

        return START_STICKY
    }

    private fun buildNotification(status: String): Notification {
        val stopIntent = Intent(this, SeanimeService::class.java).apply {
            action = ACTION_STOP_SERVICE
        }
        val pendingStopIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopAction = Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Exit", pendingStopIntent).build()
        val openIntent = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder
            .setContentTitle("Seanime")
            .setContentText(when {
                status.startsWith("Error:") -> AppLanguage.tr("Seanime could not start. Open the app again.", "Seanime konnte nicht gestartet werden. App erneut öffnen.")
                status.startsWith("Server stopped") -> AppLanguage.tr("Seanime stopped. Open the app to restart.", "Seanime wurde beendet. Zum Neustart App öffnen.")
                else -> AppLanguage.tr("Seanime is running in the background", "Seanime läuft im Hintergrund")
            })
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setPriority(Notification.PRIORITY_LOW)
            .setLocalOnly(true)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .addAction(stopAction)
            .build()
    }

    private fun promoteToForeground(status: String) {
        if (lastStatus != status) Log.i("SeanimeService", status)
        lastStatus = status
        val notification = buildNotification(status)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun startBinary() {
        process?.let {
            try { it.exitValue() } catch (_: IllegalThreadStateException) { return }
        }
        try {
            // Android 10+ forbids executing files from the writable app data directory.
            // PackageManager extracts the executable from the APK into this read-only directory.
            val binary = File(applicationInfo.nativeLibraryDir, "libseanime.so")
            if (!binary.exists()) {
                promoteToForeground("Error: Binary missing in native lib dir")
                return
            }

            promoteToForeground("Starting local server")

            val pb = ProcessBuilder(binary.absolutePath, "--datadir", filesDir.absolutePath,
                "--host", "127.0.0.1", "--port", "43211")
                .directory(filesDir)
                .redirectErrorStream(true)

            pb.environment().apply {
                put("LD_LIBRARY_PATH", applicationInfo.nativeLibraryDir)
                put("GODEBUG", "netdns=cgo")
                put("HOME", filesDir.absolutePath)
                put("SEANIME_DATA_DIR", filesDir.absolutePath)
                put("TMPDIR", cacheDir.absolutePath)
            }

            val started = pb.start()
            process = started
            promoteToForeground("Local server process started")

            Thread {
                try {
                    started.inputStream.bufferedReader().use { reader ->
                        reader.forEachLine { Log.i("SeanimeBackend", it) }
                    }
                    val exitCode = started.waitFor()
                    if (!stopping && process === started) {
                        process = null
                        promoteToForeground("Server stopped (exit $exitCode). Open Seanime to restart.")
                    }
                } catch (e: Exception) {
                    if (!stopping) Log.e("SeanimeService", "Backend output monitor failed", e)
                }
            }.apply { name = "SeanimeBackendOutput"; isDaemon = true; start() }

        } catch (e: Exception) {
            promoteToForeground("Error: ${e.message?.take(60)}")
        }
    }

    override fun onDestroy() {
        stopping = true
        process?.destroy()
        process = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val channel = NotificationChannel(CHANNEL_ID, "Seanime Server", NotificationManager.IMPORTANCE_LOW)
        channel.description = AppLanguage.tr("Optional notice for background playback and downloads", "Optionaler Hinweis für Wiedergabe und Downloads im Hintergrund")
        channel.setSound(null, null)
        channel.enableVibration(false)
        channel.setShowBadge(false)
        // Keep the channel ID stable so a user's disabled category stays disabled.
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
    }
}
