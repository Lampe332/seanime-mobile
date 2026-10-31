package com.seanime.app.offline

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.scheduler.PlatformScheduler
import androidx.media3.exoplayer.scheduler.Requirements
import com.seanime.app.AppLanguage
import com.seanime.app.R

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class EpisodeDownloadService : DownloadService(7001, 1000, EpisodeDownloads.CHANNEL, R.string.download_channel, 0) {
    // Android may restart this service without the app UI, which is where the language is usually loaded.
    override fun onCreate() {
        AppLanguage.init(this)
        super.onCreate()
        // the base class names the channel from resources (English); the app's language wins
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(EpisodeDownloads.channel())
        // after a reboot or "Exit" the local server is not running, but proxied downloads need it
        EpisodeDownloads.get(this).ensureServer(includeFailed = false)
    }
    override fun getDownloadManager() = EpisodeDownloads.get(this).manager
    override fun getScheduler() = PlatformScheduler(this, 7002)
    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification {
        val open = PendingIntent.getActivity(this, 7001, Intent(this, OfflineActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val message = when {
            (notMetRequirements and Requirements.NETWORK_UNMETERED) != 0 -> AppLanguage.tr("Waiting for Wi-Fi", "Wartet auf WLAN")
            (notMetRequirements and Requirements.NETWORK) != 0 -> AppLanguage.tr("Waiting for internet", "Wartet auf Internet")
            else -> AppLanguage.tr("Saving episodes to your phone", "Folgen werden auf dem Handy gespeichert")
        }
        return DownloadNotificationHelper(this, EpisodeDownloads.CHANNEL).buildProgressNotification(
            this, android.R.drawable.stat_sys_download, open, message, downloads, notMetRequirements)
    }
}
