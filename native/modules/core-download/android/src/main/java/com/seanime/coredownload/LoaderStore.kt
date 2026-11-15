// geschrieben nach: Android-Doku SharedPreferences; docs/EIGENER-KERN.md §4o (Stand eines Downloads über das Ende der App hinaus); kein Server-Quelltext
package com.seanime.coredownload

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.io.File

/**
 * One record per download id in the app's private preferences: what was asked for (address, headers, path, title) and
 * how far it got (state, total, the source's mark of the file, the failure). It outlives the app's process, so that a
 * job the system starts again finds its request and status() can answer after a restart. Address and headers are
 * removed once a download ended.
 */
internal object LoaderStore {
    private const val FILE = "core_download"
    private const val NEXT = "next"
    private const val NUMBERS = 9000

    private fun preferences(context: Context): SharedPreferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    private fun key(id: String) = "d:$id"

    @Synchronized
    fun read(context: Context, id: String): JSONObject? {
        val text = preferences(context).getString(key(id), null) ?: return null
        return try {
            JSONObject(text)
        } catch (error: Exception) {
            null
        }
    }

    @Synchronized
    fun write(context: Context, id: String, record: JSONObject) {
        preferences(context).edit().putString(key(id), record.toString()).commit()
        // an ended download has no address any more: the addresses of its parts go with it
        if (!record.has("url")) partsFile(context, record.optInt("number")).delete()
    }

    private fun partsFile(context: Context, number: Int) = File(File(context.filesDir, "core-download"), number.toString() + ".parts")

    /** The parts of a request of several parts, in a file of their own: they are too many for the record */
    @Synchronized
    fun writeParts(context: Context, number: Int, parts: String) {
        val file = partsFile(context, number)
        file.parentFile?.mkdirs()
        file.writeText(parts)
    }

    @Synchronized
    fun readParts(context: Context, number: Int): String? {
        val file = partsFile(context, number)
        return if (file.isFile) file.readText() else null
    }

    /** Reads, changes and writes one record in one step; null when there is none */
    @Synchronized
    fun change(context: Context, id: String, change: (JSONObject) -> Unit): JSONObject? {
        val record = read(context, id) ?: return null
        change(record)
        write(context, id, record)
        return record
    }

    @Synchronized
    fun remove(context: Context, id: String) {
        read(context, id)?.let { partsFile(context, it.optInt("number")).delete() }
        preferences(context).edit().remove(key(id)).commit()
    }

    /** A small number of its own for a download: the id of its job and of its notification */
    @Synchronized
    fun nextNumber(context: Context): Int {
        val number = preferences(context).getInt(NEXT, 0) % NUMBERS + 1
        preferences(context).edit().putInt(NEXT, number).commit()
        return number
    }
}
