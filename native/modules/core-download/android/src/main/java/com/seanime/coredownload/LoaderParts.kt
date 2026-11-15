// geschrieben nach: RFC 8216 §4.3.2.4 (EXT-X-KEY: AES-128 mit CBC und PKCS7 über das ganze Segment) und §4.3.2.2 (Byte-Bereich), RFC 9110 §14 (Range), §13.1.5 (If-Range) und §10.2.3 (Retry-After), Android-Doku javax.crypto.Cipher und HttpURLConnection, docs/EIGENER-KERN.md §4o (Phase 4b-B, Bremse und Neben-Dateien Phase 4b-C1); kein Server-Quelltext
package com.seanime.coredownload

import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.GeneralSecurityException
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * A request of several parts in one run: the segments of a stream joined to one file, and the side files of the same
 * episode (sound, subtitles, pictures). Which parts there are, their order, keys and IVs is the core's work
 * (TypeScript); this only loads each part, undoes AES-128 where the part names a key, and appends it to its file.
 * After every finished part the record says how far it is, so a run started again goes on behind the last whole part;
 * a plain whole file goes on from its bytes on disk (Range), a segment starts again. A source that refuses for the
 * moment (429, 5xx) is waited for on the run's own thread and asked for the same part again (LoaderRules.kt).
 */
internal object LoaderParts {
    private const val TRIES = 3
    private val OWN_HEADERS = setOf("range", "if-range", "accept-encoding")

    private class Refused(val status: Int, val retryAfter: String? = null) : RuntimeException("HTTP $status")

    private class Unusable(message: String) : RuntimeException(message)

    private class StorageProblem(cause: IOException) : RuntimeException(cause)

    private fun isWeb(address: String): Boolean {
        val scheme = try {
            URL(address).protocol
        } catch (error: Exception) {
            ""
        }
        return scheme == "http" || scheme == "https"
    }

    private fun target(parts: JSONArray, index: Int) = File(parts.getJSONObject(index).getString("path"))

    /**
     * The record of a new request: checks the parts, writes them to their file and decides what is kept. What an
     * earlier request of this id finished stays when the caller asks for it, the number of parts is the same and the
     * file still has those bytes; else every file of the request starts empty.
     */
    fun record(context: Context, options: EnqueueOptions, main: File, earlier: JSONObject?, number: Int): JSONObject {
        val given = JSONArray(options.parts)
        val count = given.length()
        require(count in 1..20000) { "parts are missing or too many" }
        val parts = JSONArray()
        val files = LinkedHashSet<String>()
        for (index in 0 until count) {
            val part = given.getJSONObject(index)
            require(isWeb(part.optString("url"))) { "the url of a part is not http or https" }
            val key = part.optJSONObject("key")
            if (key != null) {
                require(isWeb(key.optString("url")) && Regex("^[0-9a-fA-F]{32}$").matches(key.optString("iv"))) { "the key of a part cannot be used" }
            }
            val path = part.optString("path")
            val file = if (path.isEmpty()) main else LoaderWays.ownFile(context, path)
            files.add(file.path)
            parts.put(JSONObject(part.toString()).put("path", file.path))
        }

        var done = 0
        var offset = 0L
        var finished = 0L
        var validator = ""
        var keep = options.continueParts && earlier != null && earlier.optInt("partCount") == count
        if (keep && earlier != null) {
            done = earlier.optInt("partsDone").coerceIn(0, count)
            offset = earlier.optLong("offset")
            finished = earlier.optLong("finished")
            validator = earlier.optString("validator")
            if (done < count) {
                val current = target(parts, done)
                if ((if (current.isFile) current.length() else 0L) < offset) keep = false
            }
        }
        if (!keep) {
            done = 0
            offset = 0L
            finished = 0L
            validator = ""
            for (path in files) File(path).delete()
        }
        for (path in files) File(path).parentFile?.mkdirs()
        LoaderStore.writeParts(context, number, parts.toString())
        return JSONObject()
            .put("url", options.url)
            .put("headers", JSONObject(options.headers as Map<*, *>))
            .put("path", main.path)
            .put("title", options.title)
            .put("partCount", count)
            .put("partsDone", done)
            .put("offset", offset)
            .put("finished", finished)
            .put("validator", validator)
            .put("kept", finished)
            .put("total", 0L)
            .put("state", "queued")
            .put("number", number)
    }

    private fun connectionTo(address: String, headers: JSONObject?, run: Run): HttpURLConnection {
        val connection = URL(address).openConnection() as HttpURLConnection
        connection.connectTimeout = 30_000
        connection.readTimeout = 30_000
        if (headers != null) {
            for (name in headers.keys()) {
                if (name.lowercase() !in OWN_HEADERS) connection.setRequestProperty(name, headers.optString(name))
            }
        }
        // without this the platform asks for gzip and unpacks it: byte counts and Range would not fit the file
        connection.setRequestProperty("Accept-Encoding", "identity")
        run.connection = connection
        return connection
    }

    /** The 16 bytes of an AES-128 key, fetched once per address and run */
    private fun keyOf(address: String, headers: JSONObject?, run: Run, known: HashMap<String, ByteArray>): ByteArray {
        val have = known[address]
        if (have != null) return have
        val connection = connectionTo(address, headers, run)
        try {
            val status = connection.responseCode
            if (status != 200) throw Refused(status, connection.getHeaderField("Retry-After"))
            if (connection.contentLengthLong > 1024L) throw Unusable("the key is not 16 bytes long")
            val key = connection.inputStream.use { it.readBytes() }
            if (key.size != 16) throw Unusable("the key is not 16 bytes long")
            known[address] = key
            return key
        } finally {
            run.connection = null
            try {
                connection.disconnect()
            } catch (ignored: Exception) {
            }
        }
    }

    private fun bytesOf(hex: String): ByteArray = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    /** The file as long as its finished parts are, or gone when it has none */
    private fun cut(file: File, length: Long) {
        if (length <= 0L) {
            file.delete()
            return
        }
        if (file.isFile && file.length() > length) RandomAccessFile(file, "rw").use { it.setLength(length) }
    }

    fun transfer(context: Context, id: String, run: Run, halted: () -> Stop?, show: (Long, Long) -> Unit): End {
        val record = LoaderStore.change(context, id) { it.put("state", "running") } ?: return End.FAILED
        val text = LoaderStore.readParts(context, record.optInt("number"))
            ?: return Loader.fail(context, id, "UNKNOWN", 0, "the parts of the request are gone")
        val parts = try {
            JSONArray(text)
        } catch (error: Exception) {
            return Loader.fail(context, id, "UNKNOWN", 0, "the parts of the request cannot be read")
        }
        val headers = record.optJSONObject("headers")
        val count = parts.length()
        var weightAll = 0.0
        for (index in 0 until count) weightAll += parts.getJSONObject(index).optDouble("weight", 1.0)
        var done = record.optInt("partsDone").coerceIn(0, count)
        var base = record.optLong("offset")
        var finished = record.optLong("finished")
        var validator = record.optString("validator")
        var weightDone = 0.0
        for (index in 0 until done) weightDone += parts.getJSONObject(index).optDouble("weight", 1.0)
        val keys = HashMap<String, ByteArray>()
        var told = 0L
        var shown = 0L
        var tries = 0
        var restarts = 0
        // refusals of the moment in a row that brought no byte: each waits longer than the one before
        var refusals = 0

        while (done < count) {
            val before = halted()
            if (before != null) return Loader.halt(context, id, before)
            val part = parts.getJSONObject(done)
            val file = target(parts, done)
            val weight = part.optDouble("weight", 1.0)
            val keyed = part.optJSONObject("key")
            val from = if (part.has("from")) part.optLong("from") else -1L
            val length = part.optLong("length")
            // a side file the episode can do without (a picture): asked without the source's headers, never waited for,
            // passed over when it does not come
            val extra = part.optBoolean("extra")
            // a plain whole file goes on from its bytes on disk; a segment is small and starts again
            val resumable = keyed == null && from < 0L
            val onDisk = if (file.isFile) file.length() else 0L
            if (onDisk < base) return Loader.fail(context, id, "UNKNOWN", 0, "the parts on disk are gone")
            var have = 0L
            if (resumable) have = onDisk - base else if (onDisk > base) cut(file, base)
            var connection: HttpURLConnection? = null
            var undone = false
            var passOver = false
            try {
                val cipher = if (keyed != null) {
                    val made = Cipher.getInstance("AES/CBC/PKCS5Padding")
                    val key = keyOf(keyed.optString("url"), headers, run, keys)
                    made.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(bytesOf(keyed.optString("iv"))))
                    made
                } else {
                    null
                }
                // a part may bring its own headers (the pages of a manga chapter); else the request's
                val open = connectionTo(part.optString("url"), if (extra) null else (part.optJSONObject("headers") ?: headers), run)
                connection = open
                if (extra) {
                    open.connectTimeout = 15_000
                    open.readTimeout = 15_000
                }
                if (from >= 0L) {
                    open.setRequestProperty("Range", "bytes=" + from + "-" + (from + length - 1L))
                } else if (have > 0L) {
                    open.setRequestProperty("Range", "bytes=" + have + "-")
                    if (validator.isNotEmpty()) open.setRequestProperty("If-Range", validator)
                }
                val status = open.responseCode
                // the bytes the body brings, below 1: the source did not say
                val expected = open.contentLengthLong
                var skip = false
                if (from >= 0L) {
                    if (status != 206) throw Refused(status, open.getHeaderField("Retry-After"))
                } else {
                    val plan = answerPlan(have, status, open.getHeaderField("Content-Range"), expected)
                    if (plan is Plan.Refused) throw Refused(status, open.getHeaderField("Retry-After"))
                    if (plan is Plan.Again) {
                        cut(file, base)
                        validator = ""
                        restarts += 1
                        if (restarts > 2) throw Refused(status)
                        continue
                    }
                    if (plan is Plan.Complete) skip = true
                    if (plan is Plan.Fresh && have > 0L) {
                        cut(file, base)
                        have = 0L
                    }
                    if (resumable && !skip) {
                        val mark = validatorOf(open.getHeaderField("ETag"), open.getHeaderField("Last-Modified"))
                        if (mark != validator) {
                            validator = mark
                            LoaderStore.change(context, id) { it.put("validator", mark) }
                        }
                    }
                }
                var received = 0L
                var written = have
                if (!skip) {
                    val folder = file.parentFile
                    if (resumable && expected > 0L && folder != null && folder.usableSpace < expected) {
                        return Loader.fail(context, id, "STORAGE_FULL", 0, "not enough free space for the file")
                    }
                    val output = try {
                        FileOutputStream(file, true)
                    } catch (error: IOException) {
                        throw StorageProblem(error)
                    }
                    output.use { out ->
                        open.inputStream.use { input ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val stop = halted()
                                if (stop != null) return Loader.halt(context, id, stop)
                                val read = input.read(buffer)
                                if (read < 0) break
                                received += read.toLong()
                                val plain = if (cipher != null) cipher.update(buffer, 0, read) else null
                                try {
                                    if (cipher == null) out.write(buffer, 0, read) else if (plain != null) out.write(plain)
                                } catch (error: IOException) {
                                    throw StorageProblem(error)
                                }
                                written += if (cipher == null) read.toLong() else (plain?.size ?: 0).toLong()
                                val now = SystemClock.elapsedRealtime()
                                if (now - told >= 500L) {
                                    told = now
                                    val within = if (expected > 0L) (have + received).toDouble() / (have + expected).toDouble() else 0.0
                                    val fraction = if (weightAll > 0.0) ((weightDone + weight * within) / weightAll).coerceIn(0.0, 1.0) else 0.0
                                    val bytes = finished + written
                                    val total = if (fraction > 0.001) (bytes.toDouble() / fraction).toLong() else 0L
                                    val body = Bundle()
                                    body.putString("id", id)
                                    body.putDouble("bytes", bytes.toDouble())
                                    body.putDouble("total", total.toDouble())
                                    body.putDouble("fraction", fraction)
                                    Loader.listener?.invoke("progress", body)
                                    if (now - shown >= 1000L) {
                                        shown = now
                                        show(bytes, total)
                                    }
                                }
                            }
                            if (expected > 0L && received < expected) throw IOException("the source ended before the end of the part")
                            if (cipher != null) {
                                val last = try {
                                    cipher.doFinal()
                                } catch (error: GeneralSecurityException) {
                                    undone = true
                                    throw IOException("the part could not be decrypted")
                                }
                                try {
                                    out.write(last)
                                } catch (error: IOException) {
                                    throw StorageProblem(error)
                                }
                            }
                        }
                    }
                }
                val length_now = if (file.isFile) file.length() else 0L
                finished += length_now - base
                weightDone += weight
                done += 1
                base = if (done < count && target(parts, done) == file) length_now else 0L
                validator = ""
                tries = 0
                restarts = 0
                refusals = 0
                val next = done
                val offset = base
                val sum = finished
                LoaderStore.change(context, id) { it.put("partsDone", next).put("offset", offset).put("finished", sum).put("validator", "") }
            } catch (refused: Refused) {
                if (extra) {
                    passOver = true
                } else {
                    // wait as the source asks, longer each time in a row, then ask for the same part: nothing starts from the beginning
                    val asked = retryAfterMs(refused.retryAfter, System.currentTimeMillis())
                    val pause = sourcePause(refused.status, asked, refusals)
                    if (pause < 0L) return Loader.fail(context, id, "SOURCE_REFUSED", refused.status, "HTTP " + refused.status, asked)
                    refusals += 1
                    Log.i(Loader.TAG, "the source answered " + refused.status + " for part " + (done + 1) + " of " + count + ", asking again in " + pause + " ms")
                    try {
                        connection?.disconnect()
                    } catch (ignored: Exception) {
                    }
                    val stop = Loader.rest(pause, halted)
                    if (stop != null) return Loader.halt(context, id, stop)
                }
            } catch (unusable: Unusable) {
                return Loader.fail(context, id, "UNKNOWN", 0, unusable.message ?: "a part cannot be used")
            } catch (problem: StorageProblem) {
                val cause = problem.cause
                val full = Loader.noSpace(cause) || (file.parentFile?.usableSpace ?: Long.MAX_VALUE) < 64L * 1024L
                return Loader.fail(context, id, if (full) "STORAGE_FULL" else "UNKNOWN", 0, cause?.message ?: "the file could not be written")
            } catch (error: IOException) {
                val stop = halted()
                if (stop != null) return Loader.halt(context, id, stop)
                if (extra) {
                    passOver = true
                } else {
                    // a try that brought bytes of a whole file does not count against the limit
                    val now = if (file.isFile) file.length() else 0L
                    if (resumable && now > onDisk) refusals = 0
                    tries = if (resumable && now > onDisk) 1 else tries + 1
                    if (tries > TRIES) return Loader.fail(context, id, if (undone) "UNKNOWN" else "CONNECTION", 0, error.message ?: error.javaClass.simpleName)
                    for (step in 0 until tries * 8) {
                        val waitStop = halted()
                        if (waitStop != null) return Loader.halt(context, id, waitStop)
                        Thread.sleep(250L)
                    }
                }
            } catch (error: RuntimeException) {
                if (!extra) return Loader.fail(context, id, "UNKNOWN", 0, error.message ?: error.javaClass.simpleName)
                passOver = true
            } finally {
                run.connection = null
                try {
                    connection?.disconnect()
                } catch (ignored: Exception) {
                }
            }
            if (passOver) {
                // what came of the side file goes; the next part takes its turn
                cut(file, base)
                Log.i(Loader.TAG, "a side file did not come (part " + (done + 1) + " of " + count + "), the download goes on without it")
                weightDone += weight
                done += 1
                if (done >= count || target(parts, done) != file) base = 0L
                validator = ""
                tries = 0
                restarts = 0
                val next = done
                val offset = base
                LoaderStore.change(context, id) { it.put("partsDone", next).put("offset", offset).put("validator", "") }
            }
        }
        return Loader.done(context, id, finished)
    }
}
