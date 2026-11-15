// geschrieben nach: Android-Doku HttpURLConnection und StatFs/File.getUsableSpace, RFC 9110 §14 (Range) und §13.1.5 (If-Range), docs/EIGENER-KERN.md §4o; kein Server-Quelltext
package com.seanime.coredownload

import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import android.system.ErrnoException
import android.system.OsConstants
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/** Why a run is taken away: the app cancelled it, the user stopped it in the system, the system wants it later */
internal enum class Stop { CANCEL, USER, SYSTEM }

/** How a run ended; STOPPED: the system gets it back and starts it again */
internal enum class End { DONE, FAILED, CANCELLED, STOPPED }

internal class Run {
    @Volatile
    var stop: Stop? = null

    @Volatile
    var connection: HttpURLConnection? = null

    val ended = CountDownLatch(1)

    /** Also frees a read that waits for the source; from any thread */
    fun halt(reason: Stop) {
        if (stop == null) stop = reason
        val open = connection ?: return
        Thread {
            try {
                open.disconnect()
            } catch (ignored: Exception) {
            }
        }.start()
    }
}

private class StorageProblem(cause: IOException) : RuntimeException(cause)

/**
 * Loads one file on the calling thread, for both ways of the system (job and worker). It always goes on from the bytes
 * on disk: enqueue() has cut or removed the file before, so a run the system starts again continues by itself. At most
 * three runs transfer at once, the others wait for a place.
 */
internal object Loader {
    const val TAG = "CoreDownload"
    private const val PARALLEL = 3
    private const val TRIES = 3
    private val OWN_HEADERS = setOf("range", "if-range", "accept-encoding")
    private val places = Semaphore(PARALLEL, true)
    private val runs = ConcurrentHashMap<String, Run>()

    /** The module, while JavaScript listens */
    @Volatile
    var listener: ((String, Bundle) -> Unit)? = null

    fun active(id: String): Run? = runs[id]

    fun work(context: Context, id: String, outside: () -> Stop?, show: (Long, Long) -> Unit): End {
        runs[id]?.ended?.await(10, TimeUnit.SECONDS)
        val run = Run()
        if (runs.putIfAbsent(id, run) != null) return End.STOPPED
        try {
            val halted: () -> Stop? = { run.stop ?: outside()?.also { run.stop = it } }
            val record = LoaderStore.change(context, id) { if (it.optString("state") != "cancelled") it.put("state", "queued") }
                ?: return End.FAILED
            if (record.optString("state") == "cancelled") return End.CANCELLED
            show(-1L, 0L)
            while (!places.tryAcquire(250, TimeUnit.MILLISECONDS)) {
                val stop = halted()
                if (stop != null) return halt(context, id, stop)
            }
            try {
                return if (record.optInt("partCount") > 0) LoaderParts.transfer(context, id, run, halted, show) else transfer(context, id, run, halted, show)
            } finally {
                places.release()
            }
        } finally {
            runs.remove(id, run)
            run.ended.countDown()
        }
    }

    private fun transfer(context: Context, id: String, run: Run, halted: () -> Stop?, show: (Long, Long) -> Unit): End {
        val record = LoaderStore.change(context, id) { it.put("state", "running") } ?: return End.FAILED
        val file = File(record.optString("path"))
        val address = record.optString("url")
        val headers = record.optJSONObject("headers")
        var validator = record.optString("validator")
        var tries = 0
        var restarts = 0
        var told = 0L
        var shown = 0L
        var refusals = 0
        var refusedAt = -1L
        while (true) {
            val before = halted()
            if (before != null) return halt(context, id, before)
            val offset = if (file.isFile) file.length() else 0L
            var connection: HttpURLConnection? = null
            try {
                val open = URL(address).openConnection() as HttpURLConnection
                connection = open
                open.connectTimeout = 30_000
                open.readTimeout = 30_000
                if (headers != null) {
                    for (name in headers.keys()) {
                        if (name.lowercase() !in OWN_HEADERS) open.setRequestProperty(name, headers.optString(name))
                    }
                }
                // without this the platform asks for gzip and unpacks it: byte counts and Range would not fit the file
                open.setRequestProperty("Accept-Encoding", "identity")
                if (offset > 0L) {
                    open.setRequestProperty("Range", "bytes=$offset-")
                    if (validator.isNotEmpty()) open.setRequestProperty("If-Range", validator)
                }
                run.connection = open
                val status = open.responseCode
                val plan = answerPlan(offset, status, open.getHeaderField("Content-Range"), open.contentLengthLong)
                if (plan is Plan.Refused) {
                    // a refusal of the moment (429, 5xx): wait as the source asks, longer each time in a row, then ask for the same bytes
                    val asked = retryAfterMs(open.getHeaderField("Retry-After"), System.currentTimeMillis())
                    if (offset > refusedAt) refusals = 0
                    val pause = sourcePause(status, asked, refusals)
                    if (pause < 0L) return fail(context, id, "SOURCE_REFUSED", status, "HTTP $status", asked)
                    refusals += 1
                    refusedAt = offset
                    Log.i(TAG, "the source answered $status, asking again in $pause ms from byte $offset")
                    open.disconnect()
                    val stop = rest(pause, halted)
                    if (stop != null) return halt(context, id, stop)
                    continue
                }
                if (plan is Plan.Complete) return done(context, id, offset)
                if (plan is Plan.Again) {
                    file.delete()
                    validator = ""
                    LoaderStore.change(context, id) { it.put("kept", 0L).put("validator", "") }
                    restarts += 1
                    if (restarts > 2) return fail(context, id, "SOURCE_REFUSED", status, "the source gives neither the rest nor the whole file")
                    continue
                }
                val append = plan is Plan.Append
                val total = when (plan) {
                    is Plan.Append -> plan.total
                    is Plan.Fresh -> plan.total
                    else -> 0L
                }
                val mark = validatorOf(open.getHeaderField("ETag"), open.getHeaderField("Last-Modified"))
                validator = mark
                LoaderStore.change(context, id) {
                    it.put("total", total).put("validator", mark)
                    if (!append) it.put("kept", 0L)
                }
                var bytes = if (append) offset else 0L
                val folder = file.parentFile
                if (total > 0L && folder != null && folder.usableSpace < total - bytes) {
                    return fail(context, id, "STORAGE_FULL", 0, "not enough free space for the file")
                }
                val output = try {
                    FileOutputStream(file, append)
                } catch (error: IOException) {
                    throw StorageProblem(error)
                }
                output.use { out ->
                    open.inputStream.use { input ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val stop = halted()
                            if (stop != null) return halt(context, id, stop)
                            val count = input.read(buffer)
                            if (count < 0) break
                            try {
                                out.write(buffer, 0, count)
                            } catch (error: IOException) {
                                throw StorageProblem(error)
                            }
                            bytes += count
                            val now = SystemClock.elapsedRealtime()
                            if (now - told >= 500L) {
                                told = now
                                val body = Bundle()
                                body.putString("id", id)
                                body.putDouble("bytes", bytes.toDouble())
                                body.putDouble("total", total.toDouble())
                                listener?.invoke("progress", body)
                            }
                            if (now - shown >= 1000L) {
                                shown = now
                                show(bytes, total)
                            }
                        }
                    }
                }
                if (total > 0L && bytes < total) throw IOException("the source ended before the end of the file")
                return done(context, id, bytes)
            } catch (problem: StorageProblem) {
                val cause = problem.cause
                val full = noSpace(cause) || (file.parentFile?.usableSpace ?: Long.MAX_VALUE) < 64L * 1024L
                return fail(context, id, if (full) "STORAGE_FULL" else "UNKNOWN", 0, cause?.message ?: "the file could not be written")
            } catch (error: IOException) {
                val stop = halted()
                if (stop != null) return halt(context, id, stop)
                // a try that brought bytes does not count against the limit
                val have = if (file.isFile) file.length() else 0L
                tries = if (have > offset) 1 else tries + 1
                if (tries > TRIES) return fail(context, id, "CONNECTION", 0, error.message ?: error.javaClass.simpleName)
                for (step in 0 until tries * 8) {
                    val waitStop = halted()
                    if (waitStop != null) return halt(context, id, waitStop)
                    Thread.sleep(250L)
                }
            } catch (error: RuntimeException) {
                return fail(context, id, "UNKNOWN", 0, error.message ?: error.javaClass.simpleName)
            } finally {
                run.connection = null
                try {
                    connection?.disconnect()
                } catch (ignored: Exception) {
                }
            }
        }
    }

    fun noSpace(error: Throwable?): Boolean {
        var at = error
        while (at != null) {
            if (at is ErrnoException && at.errno == OsConstants.ENOSPC) return true
            if (at.message?.contains("ENOSPC") == true) return true
            at = at.cause
        }
        return false
    }

    fun done(context: Context, id: String, bytes: Long): End {
        val record = LoaderStore.change(context, id) {
            it.put("state", "done").put("bytes", bytes)
            it.remove("url")
            it.remove("headers")
        }
        val kept = record?.optLong("kept") ?: 0L
        Log.i(TAG, "done: $bytes bytes, $kept of them kept from an earlier run")
        val body = Bundle()
        body.putString("id", id)
        body.putDouble("bytes", bytes.toDouble())
        body.putDouble("resumedFrom", kept.toDouble())
        listener?.invoke("done", body)
        return End.DONE
    }

    /** Waits on the run's own thread, so no timer of the app is needed; the stop that ended the wait, or null */
    fun rest(ms: Long, halted: () -> Stop?): Stop? {
        val end = SystemClock.elapsedRealtime() + ms
        while (SystemClock.elapsedRealtime() < end) {
            val stop = halted()
            if (stop != null) return stop
            Thread.sleep(250L)
        }
        return null
    }

    /** retryAfter: the wait the source asked for with its refusal in milliseconds, below 1: none */
    fun fail(context: Context, id: String, kind: String, status: Int, message: String, retryAfter: Long = 0L): End {
        val cancelled = kind == "CANCELLED"
        LoaderStore.change(context, id) {
            it.put("state", if (cancelled) "cancelled" else "failed").put("kind", kind).put("httpStatus", status).put("message", message)
            it.remove("url")
            it.remove("headers")
        }
        Log.i(TAG, "failed: $kind" + (if (status > 0) " $status" else ""))
        val body = Bundle()
        body.putString("id", id)
        body.putString("kind", kind)
        body.putInt("httpStatus", status)
        body.putString("message", message)
        if (retryAfter > 0L) body.putDouble("retryAfterMs", retryAfter.toDouble())
        listener?.invoke("failed", body)
        return if (cancelled) End.CANCELLED else End.FAILED
    }

    fun halt(context: Context, id: String, stop: Stop): End {
        if (stop == Stop.USER) return fail(context, id, "CANCELLED", 0, "stopped by the user in the system")
        if (stop == Stop.SYSTEM) {
            LoaderStore.change(context, id) { it.put("state", "queued") }
            return End.STOPPED
        }
        LoaderStore.change(context, id) {
            it.put("state", "cancelled")
            it.remove("url")
            it.remove("headers")
        }
        return End.CANCELLED
    }
}
