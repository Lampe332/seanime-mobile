// geschrieben nach: RFC 9110 §14 (Range, Content-Range, 206, 416) und §13.1.5 (If-Range); docs/EIGENER-KERN.md §4o; kein Server-Quelltext
package com.seanime.coredownload

/** What to do with the answer of the source, decided from its status and headers alone (no Android in this file). */
internal sealed class Plan {
    /** The body goes behind the part on disk; total is the whole file, 0 when the source did not say */
    data class Append(val total: Long) : Plan()

    /** The body is the whole file: a part on disk is dropped */
    data class Fresh(val total: Long) : Plan()

    /** The part on disk already is the whole file */
    object Complete : Plan()

    /** The part on disk does not fit what the source sends: drop it and ask without Range */
    object Again : Plan()

    object Refused : Plan()
}

private val PART = Regex("""^bytes\s+(\d+)-(\d+)/(\d+|\*)$""", RegexOption.IGNORE_CASE)
private val UNSATISFIED = Regex("""^bytes\s+\*/(\d+)$""", RegexOption.IGNORE_CASE)

/**
 * offset: bytes on disk, asked for with "Range: bytes=offset-" (0: no Range sent). length: Content-Length, below 0 when
 * missing. A source without ranges answers 200 with the whole file; so does one whose file changed (If-Range).
 */
internal fun answerPlan(offset: Long, status: Int, contentRange: String?, length: Long): Plan {
    val range = contentRange?.trim().orEmpty()
    if (status == 200) return Plan.Fresh(if (length > 0L) length else 0L)
    if (status == 206) {
        val part = PART.find(range)
        val first = part?.groupValues?.get(1)?.toLongOrNull()
        if (part == null || first == null || first != offset) return if (offset > 0L) Plan.Again else Plan.Refused
        val named = part.groupValues[3].toLongOrNull()
        val total = named ?: (if (length > 0L) offset + length else 0L)
        return if (offset > 0L) Plan.Append(total) else Plan.Fresh(total)
    }
    if (status == 416 && offset > 0L) {
        val whole = UNSATISFIED.find(range)?.groupValues?.get(1)?.toLongOrNull()
        return if (whole != null && whole == offset) Plan.Complete else Plan.Again
    }
    return Plan.Refused
}

/*
 * The brake for a source that limits requests (429) or is busy for the moment (408, 425, 5xx): the same two rules as
 * retryAfterMs and sourcePause in src/core/download/loader.ts, where the tests are (RFC 9110 §10.2.3, Retry-After).
 */

/** The pauses before the source is asked again; every refusal in a row that brought no byte takes the next one */
internal val SOURCE_PAUSES_MS = longArrayOf(5_000L, 15_000L, 45_000L)

/** A source that asks for a longer wait is not waited for inside the run */
internal const val LONGEST_SOURCE_PAUSE_MS = 120_000L

/** Retry-After, seconds or a date, as milliseconds from now; -1 when missing or unreadable */
internal fun retryAfterMs(value: String?, now: Long): Long {
    val given = value?.trim().orEmpty()
    if (given.isEmpty()) return -1L
    if (given.length <= 9 && given.all { it in '0'..'9' }) return given.toLong() * 1000L
    return try {
        val date = java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", java.util.Locale.US).parse(given)
        if (date == null) -1L else maxOf(0L, date.time - now)
    } catch (error: Exception) {
        -1L
    }
}

/** How long to wait before asking again after a refusal with this status; -1: not again in this run */
internal fun sourcePause(status: Int, retryAfter: Long, refusalsInARow: Int): Long {
    val ofTheMoment = status == 408 || status == 425 || status == 429 || status >= 500
    if (!ofTheMoment || refusalsInARow < 0 || refusalsInARow >= SOURCE_PAUSES_MS.size) return -1L
    if (retryAfter > LONGEST_SOURCE_PAUSE_MS) return -1L
    return maxOf(retryAfter, SOURCE_PAUSES_MS[refusalsInARow])
}

/** What If-Range may carry (RFC 9110 §13.1.5): a strong entity tag, else the date of the last change, else nothing */
internal fun validatorOf(entityTag: String?, lastModified: String?): String {
    val tag = entityTag?.trim().orEmpty()
    if (tag.length > 2 && tag.startsWith("\"") && tag.endsWith("\"")) return tag
    return lastModified?.trim().orEmpty()
}
