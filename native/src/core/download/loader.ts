// geschrieben nach: docs/EIGENER-KERN.md §4o (nativer Lader, Phase 4b-A), RFC 9110 §13.1.5 (If-Range), §14 (Range) und §15 (Status-Klassen), Android-Doku "User-initiated data transfer"; kein Server-Quelltext

/*
 * The contract between the core and the device's loader. The loader (Kotlin on Android, later Swift) only loads single
 * files while the app is not in front; queue, HLS and joining are the core's work. This file names what crosses the
 * line, reads what the module sends into these shapes, and holds the two rules the core needs to go on after a stop:
 * from where to continue, and whether another try is worth it.
 */

export const LOADER_FAILURE_KINDS = ["CONNECTION", "STORAGE_FULL", "SOURCE_REFUSED", "CANCELLED", "UNKNOWN"] as const
/**
 * CONNECTION: no answer or the transfer broke, also after the loader's own tries. STORAGE_FULL: no room for the file.
 * SOURCE_REFUSED: the source answered with a status that is not the file (httpStatus). CANCELLED: the user stopped the
 * download outside the app (system task list); cancel() of the app sends no event. UNKNOWN: anything else.
 */
export type LoaderFailureKind = typeof LOADER_FAILURE_KINDS[number]

export const LOADER_STATES = ["queued", "running", "done", "failed", "cancelled", "interrupted"] as const
/** interrupted: it was on its way when the app was ended, nothing works on it any more */
export type LoaderState = typeof LOADER_STATES[number]

/**
 * One piece of a file that is joined from several (the segments of an HLS stream), or a whole file of its own.
 * path: the file this part belongs to, when it is not the request's; parts of the same file follow each other.
 * range: only these bytes of the address. key: the part is encrypted with AES-128 (CBC, PKCS7), the loader fetches the
 * key from its address; iv: 32 hex digits. weight: its share of the progress, 1 when missing (0 for small side files).
 */
export type LoaderPart = {
    url: string
    path?: string
    range?: { from: number, length: number }
    key?: { url: string, iv: string }
    weight?: number
    /**
     * A side file the download can do without (a picture of the anime): asked without the request's headers, and passed
     * over when the source does not give it
     */
    extra?: boolean
    /** Headers of this part instead of the request's (a manga page that needs other ones than the first page) */
    headers?: Record<string, string>
}

export type LoaderRequest = {
    id: string
    url: string
    headers?: Record<string, string>
    /** Where the file goes: a path or file address inside the app's own storage */
    path: string
    /** Bytes of an earlier run to keep; the loader asks the source for the rest. Missing or 0: from the start */
    resumeFrom?: number
    /** The source's mark of the file from the earlier run (LoaderStatus.validator): a changed file then comes whole */
    ifRange?: string
    expectedBytes?: number
    /** The line of the notification */
    title: string
    /**
     * The files are joined from these parts in their order, in one run of the loader (one job, one notification);
     * `url` is then only the first part's address. A plain whole file among them goes on from its bytes on disk, a
     * segment starts again.
     */
    parts?: LoaderPart[]
    /** With parts: keep the parts an earlier request of this id finished, when it had as many parts */
    continueParts?: boolean
}

/** fraction: how far a request of several parts is, 0 to 1; missing for a single file (bytes of total say it) */
export type LoaderProgress = { id: string, bytes: number, total: number | null, fraction?: number }
/** resumedFrom: bytes of the earlier run that were kept; 0 when the file came whole */
export type LoaderDone = { id: string, bytes: number, resumedFrom: number }
/** retryAfterMs: the wait the source asked for with its refusal (Retry-After), when it named one */
export type LoaderFailed = { id: string, kind: LoaderFailureKind, httpStatus: number | null, message: string, retryAfterMs?: number }

export type LoaderEvent =
    | ({ type: "progress" } & LoaderProgress)
    | ({ type: "done" } & LoaderDone)
    | ({ type: "failed" } & LoaderFailed)

export type LoaderStatus = {
    id: string
    state: LoaderState
    /** What lies on disk */
    bytes: number
    total: number | null
    validator: string | null
    failure: Omit<LoaderFailed, "id"> | null
}

export type NativeLoader = {
    enqueue(request: LoaderRequest): Promise<void>
    /** The part on disk stays; no event follows */
    cancel(id: string): Promise<void>
    /** null: the loader knows no download of this id */
    status(id: string): Promise<LoaderStatus | null>
    /** Cancels if needed and drops the loader's record; the file stays */
    forget(id: string): Promise<void>
    listen(listener: (event: LoaderEvent) => void): () => void
}

const record = (raw: unknown): Record<string, unknown> | null => typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null

/** A count of bytes: whole, not negative; anything else is null */
function count(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

const text = (value: unknown): string => typeof value === "string" ? value : ""

function failureKind(value: unknown): LoaderFailureKind {
    return (LOADER_FAILURE_KINDS as readonly unknown[]).includes(value) ? value as LoaderFailureKind : "UNKNOWN"
}

/** The module writes 0 for "no status" and for "total not known" */
const positive = (value: unknown): number | null => count(value) || null

/** What the module sent under an event name, in the contract's shape; null when it is not one of the three or has no id */
export function readLoaderEvent(type: string, raw: unknown): LoaderEvent | null {
    const body = record(raw)
    const id = text(body?.id)
    if (!body || id === "") return null
    if (type === "progress") {
        const bytes = count(body.bytes)
        if (bytes === null) return null
        const fraction = typeof body.fraction === "number" && Number.isFinite(body.fraction) ? Math.min(1, Math.max(0, body.fraction)) : null
        return fraction === null ? { type, id, bytes, total: positive(body.total) } : { type, id, bytes, total: positive(body.total), fraction }
    }
    if (type === "done") {
        const bytes = count(body.bytes)
        return bytes === null ? null : { type, id, bytes, resumedFrom: Math.min(count(body.resumedFrom) ?? 0, bytes) }
    }
    if (type === "failed") {
        const failed = { type, id, kind: failureKind(body.kind), httpStatus: positive(body.httpStatus), message: text(body.message) } as const
        const wait = positive(body.retryAfterMs)
        return wait === null ? failed : { ...failed, retryAfterMs: wait }
    }
    return null
}

export function readLoaderStatus(raw: unknown): LoaderStatus | null {
    const body = record(raw)
    const id = text(body?.id)
    const state = body?.state
    if (!body || id === "" || !(LOADER_STATES as readonly unknown[]).includes(state)) return null
    const failed = state === "failed" || (state === "cancelled" && body.kind === "CANCELLED")
    return {
        id,
        state: state as LoaderState,
        bytes: count(body.bytes) ?? 0,
        total: positive(body.total),
        validator: text(body.validator) || null,
        failure: failed ? { kind: failureKind(body.kind), httpStatus: positive(body.httpStatus), message: text(body.message) } : null,
    }
}

/**
 * The request that goes on with a download after a stop. The part on disk is kept when the loader left one behind
 * (cancelled, interrupted, or failed on the way) and it is not already more than the file; the source's mark goes
 * along, so that a file that changed in between comes whole instead of being glued to the old part. In every other
 * case the request starts from the beginning.
 */
export function continuedRequest(request: LoaderRequest, status: LoaderStatus | null): LoaderRequest {
    const { resumeFrom: _from, ifRange: _mark, ...plain } = request
    if (!status || status.id !== request.id || status.bytes <= 0) return plain
    if (status.state !== "cancelled" && status.state !== "interrupted" && status.state !== "failed") return plain
    if (status.total !== null && status.bytes > status.total) return plain
    return status.validator ? { ...plain, resumeFrom: status.bytes, ifRange: status.validator } : { ...plain, resumeFrom: status.bytes }
}

/**
 * What the source made of a continued request: "whole" when none was asked for, "continued" when it sent the rest
 * (206), "started-over" when it sent the whole file again (no ranges, or the file changed).
 */
export function rangeOutcome(askedFrom: number, done: Pick<LoaderDone, "resumedFrom">): "whole" | "continued" | "started-over" {
    if (askedFrom <= 0) return "whole"
    return done.resumedFrom > 0 ? "continued" : "started-over"
}

/**
 * Whether the same request may bring the file at a later time. A broken connection: yes. A refusal: only for the
 * statuses that describe the moment (408, 425, 429 and the 5xx), not for 401/403/404/410, where the address or its
 * headers are wrong. A full storage, a stop by the user and the unknown: no.
 */
export function worthAnotherTry(failed: Pick<LoaderFailed, "kind" | "httpStatus">): boolean {
    if (failed.kind === "CONNECTION") return true
    if (failed.kind !== "SOURCE_REFUSED" || failed.httpStatus === null) return false
    return failed.httpStatus === 408 || failed.httpStatus === 425 || failed.httpStatus === 429 || failed.httpStatus >= 500
}

/*
 * The brake for a source that limits requests (429) or is busy for the moment (408, 425, 5xx). The loader carries it
 * out inside its run, where a wait needs no timer of the app: it asks again for the same bytes (Range for a whole
 * file, the same segment of a stream), never from the start. LoaderRules.kt holds the same two rules for Kotlin.
 */

/** The loader's pauses before it asks again; every refusal in a row that brought no byte takes the next one */
export const SOURCE_PAUSES_MS = [5_000, 15_000, 45_000]
/** A source that asks for a longer wait is not waited for inside the run: the download fails and names the wait */
export const LONGEST_SOURCE_PAUSE_MS = 2 * 60_000

/** Retry-After (RFC 9110 §10.2.3), seconds or a date, as milliseconds from `now`; null when missing or unreadable */
export function retryAfterMs(value: string | null | undefined, now: number): number | null {
    const given = (value ?? "").trim()
    if (given === "") return null
    if (/^\d{1,9}$/.test(given)) return Number(given) * 1000
    // an HTTP date begins with the day's name; anything else that only looks like a number or a date is not one
    if (!/^[A-Za-z]{3}/.test(given)) return null
    const date = Date.parse(given)
    return Number.isNaN(date) ? null : Math.max(0, date - now)
}

/**
 * How long to wait before the source is asked again after it refused with `status`: never shorter than it asked for
 * (`retryAfter`, null when it named nothing), and longer with every refusal in a row. null: not again in this run:
 * the status is not one of the moment, the refusals in a row are used up, or the source asks for too long a wait.
 */
export function sourcePause(status: number, retryAfter: number | null, refusalsInARow: number): number | null {
    if (!worthAnotherTry({ kind: "SOURCE_REFUSED", httpStatus: status })) return null
    if (refusalsInARow < 0 || refusalsInARow >= SOURCE_PAUSES_MS.length) return null
    if (retryAfter !== null && retryAfter > LONGEST_SOURCE_PAUSE_MS) return null
    return Math.max(retryAfter ?? 0, SOURCE_PAUSES_MS[refusalsInARow]!)
}
