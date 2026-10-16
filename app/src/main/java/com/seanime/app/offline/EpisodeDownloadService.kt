package com.seanime.app.offline

import android.app.Notification
import android.app.PendingIntent
import android.content.Intent
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.scheduler.PlatformScheduler
import com.seanime.app.AppLanguage
import com.seanime.app.R

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class EpisodeDownloadService : DownloadService(7001, 1000, "episode-downloads", R.string.download_channel, 0) {
    override fun getDownloadManager() = EpisodeDownloads.get(this).manager
    override fun getScheduler() = PlatformScheduler(this, 7002)
    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification {
        val open = PendingIntent.getActivity(this, 7001, Intent(this, OfflineActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return DownloadNotificationHelper(this, "episode-downloads").buildProgressNotification(
            this, android.R.drawable.stat_sys_download, open, AppLanguage.run { init(this@EpisodeDownloadService); tr("Saving episodes to your phone", "Folgen werden auf dem Handy gespeichert") }, downloads, notMetRequirements)
    }
}
