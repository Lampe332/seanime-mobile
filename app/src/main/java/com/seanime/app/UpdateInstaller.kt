package com.seanime.app

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/** Durable self-update transaction. Only installed package metadata can complete it. */
object UpdateInstaller {
    private const val SOURCE_REQUEST = 1401
    private const val INSTALL_REQUEST = 1402
    private const val NOTICE = 1403
    private const val CHANNEL = "app_updates"
    private lateinit var context: Context
    private var foreground = WeakReference<Activity>(null)
    private val main = Handler(Looper.getMainLooper())
    private val preparing = AtomicBoolean(false)
    private var confirmationVisible = false
    // In-process device instrumentation only; never exposed to JS, preferences or intents.
    internal var instrumentationUserActionRequired = false
    private val prefs get() = context.getSharedPreferences("app_updater", Context.MODE_PRIVATE)
    private val installer get() = context.packageManager.packageInstaller
    private fun save(status: String) = check(prefs.edit().putString("install_status", status).commit())
    private fun code(): Long = context.packageManager.getPackageInfo(context.packageName, 0).let {
        if (Build.VERSION.SDK_INT >= 28) it.longVersionCode else it.versionCode.toLong()
    }

    fun init(context: Context) {
        this.context = context.applicationContext
        if (prefs.getString("install_status", "") == "preparing" && !preparing.get()) {
            abandon(); fail("Installation preparation interrupted. Retry the verified APK.")
        }
        reconcile()
    }

    @Synchronized fun reconcile(): Boolean {
        val target = prefs.getLong("target_code", -1)
        val before = prefs.getLong("from_code", -1)
        if (UpdateInstallPolicy.installed(before, target, code())) {
            if (prefs.getString("install_status", "") != "installed") {
                check(prefs.edit().putString("install_status", "installed").putBoolean("auto_install", false)
                    .putBoolean("success_unread", true).remove("confirmation_intent").commit())
                File(context.filesDir, "app-update/pending.apk").delete()
            }
            return true
        }
        val status = prefs.getString("install_status", "")
        if (status in listOf("installing", "confirmation")) {
            val id = prefs.getInt("session_id", -1)
            if (id >= 0 && (installer.getSessionInfo(id) == null || System.currentTimeMillis() - prefs.getLong("install_started", 0) > 30 * 60 * 1000)) {
                abandon(); fail("Installation interrupted or cancelled. Retry to install the verified APK.")
            }
        }
        return false
    }

    fun state(download: JSONObject): JSONObject {
        reconcile()
        val status = prefs.getString("install_status", "") ?: ""
        if (status == "installed") return JSONObject().put("status", if (prefs.getBoolean("success_unread", false)) "installed" else "idle")
            .put("version", context.packageManager.getPackageInfo(context.packageName, 0).versionName)
        if (status in listOf("permission", "confirmation", "installing", "failed", "preparing")) {
            return JSONObject(download.toString()).put("verified", download.optString("status") == "complete").put("status", status).put("error", prefs.getString("install_error", ""))
        }
        return download
    }

    fun acknowledge() {
        if (reconcile()) prefs.edit().putBoolean("success_unread", false).commit()
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTICE)
    }

    fun authorize() {
        if (!isInstalling()) {
            abandon()
            check(prefs.edit().putBoolean("auto_install", true).putString("install_status", "")
                .remove("install_error").remove("confirmation_intent").commit())
        }
    }

    fun newDownload() {
        check(prefs.edit().remove("target_code").remove("from_code").remove("session_id").commit())
    }

    fun isInstalling() = prefs.getString("install_status", "") in listOf("preparing", "installing", "confirmation")

    fun onResume(activity: Activity) {
        if (!::context.isInitialized) return
        foreground = WeakReference(activity)
        reconcile()
    }

    fun onPause(activity: Activity) {
        if (foreground.get() === activity) foreground.clear()
    }

    fun onVerified() {
        if (!prefs.getBoolean("auto_install", false) || isInstalling()) return
        main.post {
            val activity = foreground.get() ?: return@post
            if (!activity.isFinishing && !activity.isDestroyed && prefs.getBoolean("auto_install", false)) proceed(activity)
        }
    }

    fun requestRetry() {
        main.post {
            val activity = foreground.get() ?: return@post
            if (prefs.getString("install_status", "") == "confirmation") {
                val uri = prefs.getString("confirmation_intent", null) ?: return@post
                if (confirmationVisible) return@post
                try { confirmationVisible = true; activity.startActivityForResult(Intent.parseUri(uri, Intent.URI_INTENT_SCHEME), INSTALL_REQUEST) }
                catch (e: Exception) { fail(e.message ?: "Cannot open confirmation") }
            } else if (!isInstalling()) {
                authorize(); proceed(activity)
            }
        }
    }

    private fun proceed(activity: Activity) {
        if (isInstalling()) return
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            // Consume automatic continuation before leaving; only the matching result may continue.
            check(prefs.edit().putString("install_status", "permission").putBoolean("auto_install", false).commit())
            try {
                activity.startActivityForResult(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}")), SOURCE_REQUEST)
            } catch (e: Exception) { fail(e.message ?: "Cannot open install permission") }
            return
        }
        if (!preparing.compareAndSet(false, true)) return
        save("preparing")
        thread(name = "app-update-install") {
            var sessionId = -1
            try {
                val file = File(context.filesDir, "app-update/pending.apk")
                check(file.isFile && file.length() == prefs.getLong("bytes", -1)) { "Verified APK missing. Download again." }
                val digest = MessageDigest.getInstance("SHA-256")
                file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) } }
                check(digest.digest().joinToString("") { "%02x".format(it) } == prefs.getString("sha256", "")) { "APK changed after validation" }
                check(prefs.getLong("target_code", -1) > code()) { "APK is no longer newer" }
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                    setAppPackageName(context.packageName)
                    setSize(file.length())
                    if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(if (instrumentationUserActionRequired) PackageInstaller.SessionParams.USER_ACTION_REQUIRED else PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                    if (Build.VERSION.SDK_INT >= 33) setPackageSource(PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE)
                }
                sessionId = installer.createSession(params)
                // Persist before commit: the process may die as soon as Android replaces this package.
                check(prefs.edit().putInt("session_id", sessionId).putLong("from_code", code())
                    .putString("install_status", "installing").putBoolean("auto_install", false)
                    .putLong("install_started", System.currentTimeMillis()).commit())
                installer.openSession(sessionId).use { session ->
                    session.openWrite("base.apk", 0, file.length()).use { output ->
                        file.inputStream().use { it.copyTo(output) }; session.fsync(output)
                    }
                    val callback = Intent(context, UpdateInstallReceiver::class.java).setAction("${context.packageName}.UPDATE_RESULT")
                        .putExtra("expected_session", sessionId)
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                    session.commit(PendingIntent.getBroadcast(context, sessionId, callback, flags).intentSender)
                }
            } catch (e: Exception) {
                if (sessionId >= 0) try { installer.abandonSession(sessionId) } catch (_: Exception) { }
                fail(e.message ?: "Installation failed")
            } finally { preparing.set(false) }
        }
    }

    fun onActivityResult(request: Int, result: Int): Boolean {
        if (!::context.isInitialized) return false
        if (request == SOURCE_REQUEST) {
            if (Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()) {
                save(""); prefs.edit().putBoolean("auto_install", true).commit()
            } else fail(AppLanguage.tr("Install permission denied. You can retry.", "Installationsfreigabe verweigert. Du kannst es erneut versuchen."))
            return true
        }
        if (request == INSTALL_REQUEST) {
            confirmationVisible = false
            if (result == Activity.RESULT_CANCELED && !reconcile() && prefs.getString("install_status", "") == "confirmation") {
                abandon(); fail(AppLanguage.tr("Installation cancelled. You can retry the verified APK.", "Installation abgebrochen. Die geprüfte APK kann erneut verwendet werden."))
            }
            return true
        }
        return false
    }

    fun result(intent: Intent) {
        val expected = prefs.getInt("session_id", -1)
        if (intent.getIntExtra("expected_session", -2) != expected || intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -2) != expected) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        android.util.Log.i("SeanimeUpdate", "session=$expected status=$status installed=${code()} target=${prefs.getLong("target_code", -1)}")
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION") val confirmation = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (confirmation == null) { fail("Android did not provide an installation confirmation"); return }
                check(prefs.edit().putString("install_status", "confirmation").putString("confirmation_intent", confirmation.toUri(Intent.URI_INTENT_SCHEME)).commit())
                main.post {
                    val activity = foreground.get()
                    if (activity != null && !activity.isFinishing && !activity.isDestroyed) {
                        try { confirmationVisible = true; activity.startActivityForResult(confirmation, INSTALL_REQUEST) }
                        catch (_: Exception) { notifyOpen(false) }
                    } else notifyOpen(false)
                }
            }
            PackageInstaller.STATUS_SUCCESS -> { if (reconcile()) replaced() }
            else -> fail(intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Installation cancelled or failed (Android $status)")
        }
    }

    fun fail(message: String) {
        check(prefs.edit().putString("install_status", "failed").putString("install_error", message)
            .putBoolean("auto_install", false).remove("confirmation_intent").commit())
    }

    private fun abandon() {
        val id = prefs.getInt("session_id", -1)
        if (id >= 0) try { installer.abandonSession(id) } catch (_: Exception) { }
    }

    fun replaced() {
        if (!reconcile() || !prefs.getBoolean("success_unread", false)) return
        // MY_PACKAGE_REPLACED is not a general background-activity-start exemption.
        // Offer a direct Activity PendingIntent. A regular start also reconciles and confirms.
        notifyOpen(true)
    }

    private fun notifyOpen(installed: Boolean) {
        AppLanguage.init(context)
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, AppLanguage.tr("App updates", "App-Updates"), NotificationManager.IMPORTANCE_DEFAULT))
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val open = PendingIntent.getActivity(context, NOTICE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
        manager.notify(NOTICE, builder.setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(if (installed) AppLanguage.tr("Update installed", "Update installiert") else AppLanguage.tr("Installation confirmation required", "Installationsbestätigung erforderlich"))
            .setContentText(AppLanguage.tr("Open app", "App öffnen")).setContentIntent(open)
            .addAction(Notification.Action.Builder(null, AppLanguage.tr("Open app", "App öffnen"), open).build())
            .setAutoCancel(true).build())
    }
}

class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { UpdateInstaller.init(context); UpdateInstaller.result(intent) }
}

class UpdateReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            UpdateInstaller.init(context); UpdateInstaller.replaced()
        }
    }
}
