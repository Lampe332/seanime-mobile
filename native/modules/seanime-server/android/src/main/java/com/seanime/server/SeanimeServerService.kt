package com.seanime.server

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet

/** Snapshot of the local Go server, mirrored to JS by [SeanimeServerModule]. */
data class ServerStatus(val state: String, val message: String, val port: Int)

/** Process-wide server state; the service writes it, the module forwards changes to JS. */
object ServerState {
    @Volatile var current = ServerStatus("idle", "Not started", SeanimeServerService.PORT)
        private set
    private val listeners = CopyOnWriteArraySet<(ServerStatus) -> Unit>()

    fun addListener(listener: (ServerStatus) -> Unit) { listeners.add(listener) }
    fun removeListener(listener: (ServerStatus) -> Unit) { listeners.remove(listener) }

    fun update(state: String, message: String) {
        val next = ServerStatus(state, message, SeanimeServerService.PORT)
        if (next == current) return
        current = next
        listeners.forEach { it(next) }
    }
}

/** Language of the notification texts; same preference keys as the old app (com.seanime.app.AppLanguage). */
internal object ServerLanguage {
    private const val PREFS = "seanime_app"
    private const val KEY = "language"
    @Volatile private var german = false

    fun init(context: Context) {
        german = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "en") == "de"
    }

    fun set(context: Context, language: String) {
        german = language == "de"
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, if (german) "de" else "en").apply()
    }

    fun tr(en: String, de: String): String = if (german) de else en
}

/** Runs the Go server (libseanime.so) as a child process inside a foreground service. Port of the old app's SeanimeService.kt. */
class SeanimeServerService : Service() {

    @Volatile private var process: Process? = null
    @Volatile private var stopping = false
    @Volatile private var portRetries = 0
    private var lastStatus: String = "Starting local server"

    companion object {
        // One source for the port: native/app-variants.json (the test package uses its own, so it never collides with
        // the real app; the release uses the one of the app it replaces) → app.config.js → plugins/with-server-port.js → gradle property
        // seanime.serverPort → BuildConfig (module build.gradle). The JS side reads the same file (api/client/server-url.ts).
        const val PORT = BuildConfig.SERVER_PORT
        private const val CHANNEL_ID = "seanime_channel"
        private const val NOTIF_ID = 1
        private const val ACTION_STOP_SERVICE = "STOP_SEANIME_SERVICE"
        private const val MAX_PORT_RETRIES = 10
        private const val TAG = "SeanimeService"
    }

    // All Android users (profiles) share one loopback interface, so a server left running in a profile the
    // user switched away from keeps 127.0.0.1:<port> and the app in the new profile cannot start its own.
    private val userBackgroundReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            Log.i(TAG, "User switched away from this profile; stopping local server")
            stopSelf()
        }
    }

    // A widget refresh can start this service without the app UI, which is where the language is usually loaded.
    override fun onCreate() {
        super.onCreate()
        ServerLanguage.init(this)
        val filter = IntentFilter(Intent.ACTION_USER_BACKGROUND)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(userBackgroundReceiver, filter, RECEIVER_NOT_EXPORTED)
        else registerReceiver(userBackgroundReceiver, filter)
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
        val stopIntent = Intent(this, SeanimeServerService::class.java).apply {
            action = ACTION_STOP_SERVICE
        }
        val pendingStopIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopAction = Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, ServerLanguage.tr("Exit", "Beenden"), pendingStopIntent).build()
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 1, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder
            .setContentTitle("Seanime")
            .setContentText(when {
                status.startsWith("Error:") -> ServerLanguage.tr("Seanime could not start. Open the app again.", "Seanime konnte nicht gestartet werden. App erneut öffnen.")
                status.startsWith("Server stopped") -> ServerLanguage.tr("Seanime stopped. Open the app to restart.", "Seanime wurde beendet. Zum Neustart App öffnen.")
                else -> ServerLanguage.tr("Seanime is running in the background", "Seanime läuft im Hintergrund")
            })
            .setSmallIcon(R.drawable.ic_stat_seanime)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setPriority(Notification.PRIORITY_LOW)
            .setLocalOnly(true)
            .setOngoing(true)
            .apply { if (openIntent != null) setContentIntent(openIntent) }
            .addAction(stopAction)
            .build()
    }

    private fun promoteToForeground(status: String) {
        if (lastStatus != status) Log.i(TAG, status)
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
            // PackageManager extracts the executable from the APK into this read-only directory
            // (needs useLegacyPackaging / extractNativeLibs, set in app.json via expo-build-properties).
            val binary = File(applicationInfo.nativeLibraryDir, "libseanime.so")
            if (!binary.exists()) {
                promoteToForeground("Error: Binary missing in native lib dir")
                ServerState.update("error", "Binary missing in native lib dir")
                return
            }

            promoteToForeground("Starting local server")
            ServerState.update("starting", "Starting local server")

            val pb = ProcessBuilder(binary.absolutePath, "--datadir", filesDir.absolutePath,
                "--host", "127.0.0.1", "--port", PORT.toString())
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
                    var portBusy = false
                    started.inputStream.bufferedReader().use { reader ->
                        reader.forEachLine {
                            Log.i("SeanimeBackend", it)
                            if (it.contains("address already in use")) portBusy = true
                            // "Seanime started at" is logged once the HTTP listener runs (a failed bind exits before it);
                            // "server-ready" (AniList data loaded) only shows at trace level, kept as in the old service.
                            if (!portBusy && (it.contains("Seanime started at") || it.contains("server-ready"))) {
                                portRetries = 0
                                ServerState.update("ready", "Listening on 127.0.0.1:$PORT")
                            }
                        }
                    }
                    val exitCode = started.waitFor()
                    if (!stopping && process === started) {
                        process = null
                        // Right after a profile switch the other profile's server may still be shutting down.
                        if (portBusy && portRetries < MAX_PORT_RETRIES) {
                            portRetries++
                            promoteToForeground("Port $PORT busy, retry $portRetries/$MAX_PORT_RETRIES")
                            ServerState.update("retrying", "Port $PORT busy, retry $portRetries/$MAX_PORT_RETRIES")
                            Thread.sleep(1000)
                            if (!stopping) startBinary()
                        } else {
                            val message = if (portBusy) "Error: port $PORT is used by Seanime in another profile"
                                else "Server stopped (exit $exitCode). Open Seanime to restart."
                            promoteToForeground(message)
                            ServerState.update(if (portBusy) "error" else "stopped", message)
                        }
                    }
                } catch (e: Exception) {
                    if (!stopping) Log.e(TAG, "Backend output monitor failed", e)
                }
            }.apply { name = "SeanimeBackendOutput"; isDaemon = true; start() }

        } catch (e: Exception) {
            promoteToForeground("Error: ${e.message?.take(60)}")
            ServerState.update("error", e.message?.take(200) ?: "Unknown error")
        }
    }

    override fun onDestroy() {
        stopping = true
        unregisterReceiver(userBackgroundReceiver)
        process?.destroy()
        process = null
        ServerState.update("stopped", "Server stopped")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val channel = NotificationChannel(CHANNEL_ID, ServerLanguage.tr("Seanime server", "Seanime-Server"), NotificationManager.IMPORTANCE_LOW)
        channel.description = ServerLanguage.tr("Optional notice for background playback and downloads", "Optionaler Hinweis für Wiedergabe und Downloads im Hintergrund")
        channel.setSound(null, null)
        channel.enableVibration(false)
        channel.setShowBadge(false)
        // Keep the channel ID stable so a user's disabled category stays disabled.
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
    }
}
