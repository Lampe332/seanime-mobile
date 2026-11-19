// geschrieben nach: Android-Doku "User-initiated data transfer" (JobInfo.Builder.setUserInitiated, JobService.setNotification, Stop-Gründe), "Foreground service types" (dataSync), WorkManager "Support for long-running workers" (setForeground, ForegroundInfo), JobScheduler.forNamespace und "Create a notification" (Notification.Builder, BigTextStyle, setContentIntent); docs/EIGENER-KERN.md §4o; kein Server-Quelltext
package com.seanime.coredownload

import android.annotation.TargetApi
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.PersistableBundle
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlin.coroutines.cancellation.CancellationException

/**
 * The two ways the system keeps a download alive while the app is not in front:
 * - Android 14 and later: a user-initiated data transfer job (LoaderJobService), one per download.
 * - Android 7 to 13: a WorkManager worker in the foreground with the service type dataSync (LoaderWorker). Also the
 *   way out when the system refuses the job (it only takes one while the app is visible).
 */
internal object LoaderWays {
    private const val NAMESPACE = "core-download"

    private fun workName(id: String) = "core-download:$id"

    @TargetApi(34)
    private fun jobs(context: Context): JobScheduler =
        (context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler).forNamespace(NAMESPACE)

    /** The file of a path or file address, refused when it is not inside the app's own storage */
    fun ownFile(context: Context, given: String): File {
        val path = if (given.startsWith("file://")) Uri.parse(given).path.orEmpty() else given
        require(path.isNotEmpty()) { "path is missing" }
        val file = File(path).canonicalFile
        val roots = listOfNotNull(context.dataDir) + context.getExternalFilesDirs(null).filterNotNull() + context.externalCacheDirs.filterNotNull()
        require(roots.any { file.path.startsWith(it.canonicalPath + File.separator) }) { "path is outside the app's storage" }
        return file
    }

    fun enqueue(context: Context, options: EnqueueOptions) {
        val app = context.applicationContext
        val id = options.id
        require(id.isNotEmpty() && id.length <= 120) { "id is missing or too long" }
        val scheme = try {
            URL(options.url).protocol
        } catch (error: Exception) {
            ""
        }
        require(scheme == "http" || scheme == "https") { "url is not http or https" }
        val file = ownFile(app, options.path)

        // one download per id: an earlier one ends first, in this process and in the system
        val earlier = LoaderStore.read(app, id)
        val running = Loader.active(id)
        if (running != null) {
            running.halt(Stop.CANCEL)
            running.ended.await(10, TimeUnit.SECONDS)
        }
        if (earlier != null) cancelInSystem(app, id, earlier)

        // several parts in one run (LoaderParts): their files, joined from the parts in order
        if (options.parts.isNotEmpty()) {
            val partsNumber = earlier?.optInt("number", 0)?.takeIf { it > 0 } ?: LoaderStore.nextNumber(app)
            val partsByJob = options.way != "work" && Build.VERSION.SDK_INT >= 34
            LoaderStore.write(app, id, LoaderParts.record(app, options, file, earlier, partsNumber).put("way", if (partsByJob) "job" else "work"))
            if (partsByJob && scheduleJob(app, id, partsNumber, options.expectedBytes.toLong())) return
            if (partsByJob) LoaderStore.change(app, id) { it.put("way", "work") }
            scheduleWork(app, id)
            return
        }

        // the part to keep: cut to what the caller counts on, or gone
        file.parentFile?.mkdirs()
        var keep = options.resumeFrom.toLong()
        if (keep > 0L && file.isFile && file.length() >= keep) {
            RandomAccessFile(file, "rw").use { it.setLength(keep) }
        } else {
            file.delete()
            keep = 0L
        }

        val number = earlier?.optInt("number", 0)?.takeIf { it > 0 } ?: LoaderStore.nextNumber(app)
        val expected = options.expectedBytes.toLong()
        val byJob = options.way != "work" && Build.VERSION.SDK_INT >= 34
        val record = JSONObject()
            .put("url", options.url)
            .put("headers", JSONObject(options.headers as Map<*, *>))
            .put("path", file.path)
            .put("title", options.title)
            .put("validator", if (keep > 0L) options.ifRange else "")
            .put("kept", keep)
            .put("total", 0L)
            .put("state", "queued")
            .put("number", number)
            .put("way", if (byJob) "job" else "work")
        LoaderStore.write(app, id, record)
        if (byJob && scheduleJob(app, id, number, expected)) return
        if (byJob) LoaderStore.change(app, id) { it.put("way", "work") }
        scheduleWork(app, id)
    }

    @TargetApi(34)
    private fun scheduleJob(context: Context, id: String, number: Int, expected: Long): Boolean {
        val extras = PersistableBundle()
        extras.putString("id", id)
        return try {
            val job = JobInfo.Builder(number, ComponentName(context, LoaderJobService::class.java))
                .setUserInitiated(true)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setEstimatedNetworkBytes(if (expected > 0L) expected else JobInfo.NETWORK_BYTES_UNKNOWN.toLong(), 0L)
                .setExtras(extras)
                .build()
            val taken = jobs(context).schedule(job) == JobScheduler.RESULT_SUCCESS
            if (!taken) Log.w(Loader.TAG, "the system did not take the job, the worker loads instead")
            taken
        } catch (error: RuntimeException) {
            // SecurityException: the app is not visible or the permission is missing
            Log.w(Loader.TAG, "the system refused the job (${error.javaClass.simpleName}), the worker loads instead")
            false
        }
    }

    private fun scheduleWork(context: Context, id: String) {
        val request = OneTimeWorkRequest.Builder(LoaderWorker::class.java)
            .setInputData(Data.Builder().putString("id", id).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(workName(id), ExistingWorkPolicy.REPLACE, request)
    }

    private fun cancelInSystem(context: Context, id: String, record: JSONObject) {
        if (record.optString("way") == "job" && Build.VERSION.SDK_INT >= 34) {
            jobs(context).cancel(record.optInt("number"))
        } else {
            WorkManager.getInstance(context).cancelUniqueWork(workName(id))
        }
    }

    private fun heldBySystem(context: Context, id: String, record: JSONObject): Boolean {
        if (record.optString("way") == "job" && Build.VERSION.SDK_INT >= 34) {
            return jobs(context).getPendingJob(record.optInt("number")) != null
        }
        return try {
            WorkManager.getInstance(context).getWorkInfosForUniqueWork(workName(id)).get(5, TimeUnit.SECONDS).any { !it.state.isFinished }
        } catch (error: Exception) {
            false
        }
    }

    /** The part on disk stays. Returns when the run has let go of the file. */
    fun cancel(context: Context, id: String) {
        val app = context.applicationContext
        val record = LoaderStore.read(app, id) ?: return
        val running = Loader.active(id)
        running?.halt(Stop.CANCEL)
        cancelInSystem(app, id, record)
        running?.ended?.await(10, TimeUnit.SECONDS)
        LoaderStore.change(app, id) {
            val state = it.optString("state")
            if (state == "queued" || state == "running") {
                it.put("state", "cancelled")
                it.remove("url")
                it.remove("headers")
            }
        }
    }

    /**
     * "interrupted": the record says the download was on its way, but neither this process nor the system holds it any
     * more (the app was ended). bytes is what lies on disk.
     */
    fun status(context: Context, id: String): Map<String, Any?>? {
        val app = context.applicationContext
        val record = LoaderStore.read(app, id) ?: return null
        var state = record.optString("state")
        if ((state == "queued" || state == "running") && Loader.active(id) == null) {
            state = if (heldBySystem(app, id, record)) "queued" else "interrupted"
        }
        val file = File(record.optString("path"))
        return mapOf(
            "id" to id,
            "state" to state,
            // several parts: the bytes of the finished parts, over all their files
            "bytes" to (if (record.optInt("partCount") > 0) record.optLong("finished") else if (file.isFile) file.length() else 0L).toDouble(),
            "total" to record.optLong("total").toDouble(),
            "validator" to record.optString("validator"),
            "kind" to record.optString("kind"),
            "httpStatus" to record.optInt("httpStatus"),
            "message" to record.optString("message"),
        )
    }

    fun forget(context: Context, id: String) {
        cancel(context, id)
        LoaderStore.remove(context.applicationContext, id)
    }
}

/** The plain notification of one download: title, bar, percent. The channel is named in English like the app. */
internal object LoaderNotice {
    private const val CHANNEL = "core-downloads"

    fun id(number: Int) = 47_110_000 + number

    /**
     * `text`: the line under the title instead of "<percent> %" (the torrent client's notice, TorrentKeep.kt); `link`:
     * tapping opens it in the app instead of just opening the app.
     */
    fun build(context: Context, title: String, bytes: Long, total: Long, text: String? = null, link: String? = null): Notification {
        if (Build.VERSION.SDK_INT >= 26) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL) == null) {
                val channel = NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW)
                channel.setShowBadge(false)
                manager.createNotificationChannel(channel)
            }
        }
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
        // the app's own small icon while its module is in the build, else the system's download arrow
        val own = context.resources.getIdentifier("ic_stat_seanime", "drawable", context.packageName)
        builder.setSmallIcon(if (own != 0) own else android.R.drawable.stat_sys_download)
        builder.setContentTitle(title)
        builder.setOngoing(true)
        builder.setOnlyAlertOnce(true)
        if (total > 0L && bytes >= 0L) {
            val percent = (bytes * 100L / total).toInt().coerceIn(0, 100)
            builder.setProgress(100, percent, false)
            builder.setContentText(text ?: "$percent %")
        } else {
            builder.setProgress(0, 0, true)
            if (text != null) builder.setContentText(text)
        }
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (link != null) {
            val open = android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            builder.setContentIntent(PendingIntent.getActivity(context, link.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        } else if (launch != null) {
            builder.setContentIntent(PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        }
        return builder.build()
    }

    /** The channel of the end notices, the one the app's JavaScript posted them on (download-notifications.ts) */
    private const val END_CHANNEL = "episode-downloads"

    /**
     * The notice at the end of an episode, looking as the one of expo-notifications did: same channel (quiet), same
     * place (tag "episode-download-<id>", number 0: it takes the place of an older notice of the episode), the app's
     * small icon, title, text that opens in full, gone once tapped; tapping opens `link` in the app (the Downloads page).
     */
    fun end(context: Context, id: String, title: String, text: String, channelName: String, link: String): Boolean {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!manager.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(END_CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(END_CHANNEL, channelName, NotificationManager.IMPORTANCE_LOW))
        }
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, END_CHANNEL) else Notification.Builder(context)
        val own = context.resources.getIdentifier("ic_stat_seanime", "drawable", context.packageName)
        builder.setSmallIcon(if (own != 0) own else android.R.drawable.stat_sys_download_done)
        builder.setContentTitle(title)
        builder.setContentText(text)
        builder.setStyle(Notification.BigTextStyle().bigText(text))
        builder.setAutoCancel(true)
        val open = android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        builder.setContentIntent(PendingIntent.getActivity(context, id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        manager.notify("episode-download-$id", 0, builder.build())
        Log.i(Loader.TAG, "end notice shown")
        return true
    }
}

/** Android 14 and later: the system runs the download as a user-initiated data transfer and shows it in its task list. */
@TargetApi(34)
class LoaderJobService : JobService() {

    override fun onStartJob(params: JobParameters): Boolean {
        val id = params.extras.getString("id") ?: return false
        val record = LoaderStore.read(this, id) ?: return false
        val number = record.optInt("number")
        val title = record.optString("title")
        val app = applicationContext
        // the system asks for the notification at once
        setNotification(params, LoaderNotice.id(number), LoaderNotice.build(app, title, -1L, 0L), JobService.JOB_END_NOTIFICATION_POLICY_REMOVE)
        Thread({
            val end = Loader.work(app, id, { null }) { bytes, total ->
                try {
                    setNotification(params, LoaderNotice.id(number), LoaderNotice.build(app, title, bytes, total), JobService.JOB_END_NOTIFICATION_POLICY_REMOVE)
                    if (bytes > 0L) updateTransferredNetworkBytes(params, bytes, 0L)
                } catch (ignored: Exception) {
                    // the job is already over
                }
            }
            try {
                jobFinished(params, end == End.STOPPED)
            } catch (ignored: Exception) {
            }
        }, "core-download-$number").start()
        return true
    }

    /** true: the system starts the job again later (lost network, its own limits); the run then goes on from the part on disk */
    override fun onStopJob(params: JobParameters): Boolean {
        val id = params.extras.getString("id") ?: return false
        val reason = when (params.stopReason) {
            JobParameters.STOP_REASON_USER -> Stop.USER
            JobParameters.STOP_REASON_CANCELLED_BY_APP -> Stop.CANCEL
            else -> Stop.SYSTEM
        }
        Loader.active(id)?.halt(reason)
        return reason == Stop.SYSTEM
    }
}

/** Android 7 to 13: a WorkManager worker, carried by WorkManager's foreground service with the type dataSync. */
class LoaderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext
        val id = inputData.getString("id") ?: return Result.failure()
        val record = LoaderStore.read(app, id) ?: return Result.failure()
        val number = record.optInt("number")
        val title = record.optString("title")
        val notice = LoaderNotice.id(number)
        try {
            val first = LoaderNotice.build(app, title, -1L, 0L)
            setForeground(if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(notice, first, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(notice, first))
        } catch (error: IllegalStateException) {
            if (error is CancellationException) throw error
            // Android 12 and later refuse a foreground service started while the app is not in front: the work goes on without it
            Log.w(Loader.TAG, "no foreground for the worker (${error.javaClass.simpleName})")
        }
        val manager = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val end = try {
            withContext(Dispatchers.IO) {
                Loader.work(app, id, { if (isStopped) Stop.SYSTEM else null }) { bytes, total ->
                    try {
                        manager.notify(notice, LoaderNotice.build(app, title, bytes, total))
                    } catch (ignored: Exception) {
                    }
                }
            }
        } finally {
            manager.cancel(notice)
        }
        return when (end) {
            End.DONE -> Result.success()
            End.STOPPED -> Result.retry()
            else -> Result.failure()
        }
    }
}

/**
 * The wait before a new try of the core's queue. While no download runs, the system puts the process to rest and the
 * app's timers with it; delayed work comes back by itself (WorkManager, setInitialDelay). It only tells JavaScript
 * that the time has come (event `wake`) and stays for a while, so the process is awake until the core has found the
 * next source and handed it to the loader. A process that was ended meanwhile has no JavaScript to tell: the queue
 * then goes on when the app is opened.
 */
class WakeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val listener = Loader.listener
        Log.i(Loader.TAG, "wake: the wait is over" + (if (listener == null) ", nobody listens" else ""))
        if (listener == null) return Result.success()
        listener("wake", android.os.Bundle())
        kotlinx.coroutines.delay(STAYS_MS)
        return Result.success()
    }

    companion object {
        private const val NAME = "core-download:wake"
        private const val STAYS_MS = 30_000L

        /** ms below 0: the wait is not needed any more */
        fun plan(context: Context, ms: Long): Boolean {
            val manager = WorkManager.getInstance(context.applicationContext)
            if (ms < 0L) {
                manager.cancelUniqueWork(NAME)
                return false
            }
            val request = OneTimeWorkRequest.Builder(WakeWorker::class.java).setInitialDelay(ms, TimeUnit.MILLISECONDS).build()
            manager.enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, request)
            return true
        }
    }
}
