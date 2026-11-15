// geschrieben nach: docs/EIGENER-KERN.md §4o (nativer Lader, Phase 4b-A), Muster core-sandbox.ts und core-manga-check.ts, Doku von expo-file-system (File, Paths); kein Server-Quelltext
import { type LoaderEvent, type LoaderRequest, type NativeLoader, continuedRequest, rangeOutcome, readLoaderEvent, readLoaderStatus } from "@/core"
import { logger } from "@/lib/helpers/debug"
import { File, Paths } from "expo-file-system"

/*
 * The device's loader for single files: the core's contract (core/download/loader.ts), carried by the app's native
 * module (modules/core-download). The downloads of the core (core/offline, area offline) load through it (core-offline.ts); the self test below is started by a
 * link of the test app (lib/app-links.ts).
 */

export type DeviceLoader = NativeLoader & {
    /** Lower-case hex of a file inside the app's own storage, computed by the module */
    sha256(path: string): Promise<string>
    /** Removes a folder inside the app's own storage with everything in it, on the module's thread */
    removeFolder(path: string): Promise<void>
    /** Whether a file inside the app's own storage is there, asked off the app's thread */
    has(path: string): Promise<boolean>
    /** The notice at the end of an episode, shown by the device (no timer of the app needed); tapping opens `link` */
    notice(id: string, title: string, text: string, channel: string, link: string): Promise<boolean>
    /** The listeners of onWake hear after about so many milliseconds, also when the app rests by then; below 0: not any more */
    wakeIn(ms: number): Promise<void>
    onWake(listener: () => void): () => void
}

const EVENTS = ["progress", "done", "failed"] as const

/**
 * The module is loaded when a loader is first asked for, so an app that never downloads this way never touches it.
 * way "work": WorkManager also on Android 14 and later, where the loader would take a user-initiated job (self test).
 */
export async function deviceLoader(way: "" | "work" = ""): Promise<DeviceLoader> {
    const { default: module } = await import("../../../modules/core-download")
    return {
        enqueue: request => module.enqueue({
            id: request.id,
            url: request.url,
            headers: request.headers ?? {},
            path: request.path,
            title: request.title,
            resumeFrom: request.resumeFrom ?? 0,
            ifRange: request.ifRange ?? "",
            expectedBytes: request.expectedBytes ?? 0,
            // as text: the list is long, and the module reads it with the system's JSON
            parts: request.parts?.length ? JSON.stringify(request.parts.map(part => ({
                url: part.url,
                path: part.path ?? "",
                weight: part.weight ?? 1,
                ...(part.range ? { from: part.range.from, length: part.range.length } : {}),
                ...(part.key ? { key: part.key } : {}),
                ...(part.extra ? { extra: true } : {}),
                ...(part.headers ? { headers: part.headers } : {}),
            }))) : "",
            continueParts: request.continueParts === true,
            way,
        }),
        cancel: id => module.cancel(id),
        status: async id => readLoaderStatus(await module.status(id)),
        forget: id => module.forget(id),
        sha256: path => module.sha256(path),
        removeFolder: async path => void await module.removeFolder(path),
        has: path => module.has(path),
        notice: (id, title, text, channel, link) => module.notice(id, title, text, channel, link),
        wakeIn: async ms => void await module.wakeIn(ms),
        onWake(listener) {
            const subscription = module.addListener("wake", () => listener())
            return () => subscription.remove()
        },
        listen(listener) {
            const subscriptions = EVENTS.map(type => module.addListener(type, raw => {
                const event = readLoaderEvent(type, raw)
                if (event) listener(event)
            }))
            return () => subscriptions.forEach(subscription => subscription.remove())
        },
    }
}

export type DownloadSelfTest = {
    url: string
    /** Sent as Referer when not empty */
    referer: string
    /** Expected hash, lower-case hex; "": only logged */
    sha256: string
    /** Expected size; null: only logged */
    size: number | null
    /** Percent of the file after which the download is cancelled once and continued; 0: no stop */
    stopAt: number
    way: "" | "work"
}

const log = (text: string) => logger("CoreDownload").info(text)

const clean = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "<address>").replace(/\/?\d{1,3}(\.\d{1,3}){3}(:\d+)?/g, "<host>").slice(0, 160)

/** No answer of the loader for this long ends the self test */
const PATIENCE_MS = 15 * 60_000

/*
 * Test and scratch app only (link `core?download=selftest&url=<address>[&referer=<address>][&sha256=<hex>][&size=<bytes>]
 * [&stop=<percent>][&way=work]`): loads one file into the app's cache folder, cancels it once on the way (default
 * after 25 %, `stop=0` for never), reads the status, continues with the request the core's rule builds from it, then
 * compares size and SHA-256 with what the link names and removes the file. Numbers only in the log; no address.
 */
export async function runCoreDownloadSelfTest(test: DownloadSelfTest): Promise<void> {
    const file = new File(Paths.cache, "core-download-selftest.bin")
    const id = `selftest-${Date.now()}`
    let loader: DeviceLoader | null = null
    let unlisten = () => {}
    try {
        loader = await deviceLoader(test.way)
        if (file.exists) file.delete()
        const request: LoaderRequest = {
            id,
            url: test.url,
            headers: test.referer ? { Referer: test.referer } : {},
            path: file.uri,
            title: "Download self test",
            ...(test.size ? { expectedBytes: test.size } : {}),
        }
        const started = Date.now()
        let stopAt = test.stopAt
        let reached: (bytes: number) => void = () => {}
        let ended: (event: LoaderEvent | null) => void = () => {}
        const stopPoint = new Promise<number>(resolve => { reached = resolve })
        const end = () => new Promise<LoaderEvent | null>(resolve => {
            ended = resolve
            setTimeout(() => resolve(null), PATIENCE_MS)
        })
        unlisten = loader.listen(event => {
            if (event.id !== id) return
            if (event.type !== "progress") return ended(event)
            if (stopAt > 0 && event.total !== null && event.bytes >= event.total * stopAt / 100) {
                stopAt = 0
                reached(event.bytes)
            }
        })

        log(`self test start, way: ${test.way || "of the system version"}, stop at ${test.stopAt} %`)
        let last = end()
        let askedFrom = 0
        await loader.enqueue(request)
        if (test.stopAt > 0) {
            const first = await Promise.race([stopPoint, last])
            if (typeof first === "number") {
                await loader.cancel(id)
                const status = await loader.status(id)
                log(`cancelled after ${first} bytes: state ${status?.state ?? "none"}, on disk ${status?.bytes ?? 0}, total ${status?.total ?? "unknown"}, mark of the source ${status?.validator ? "yes" : "no"} (${Date.now() - started} ms)`)
                const again = continuedRequest(request, status)
                askedFrom = again.resumeFrom ?? 0
                last = end()
                await loader.enqueue(again)
                log(`continued, asked from byte ${askedFrom}`)
            }
            else {
                log("the download ended before the stop point")
            }
        }

        const event = await last
        if (event === null) {
            log(`self test: no end after ${PATIENCE_MS / 1000} s`)
        }
        else if (event.type === "failed") {
            log(`self test failed: ${event.kind}${event.httpStatus ? ` ${event.httpStatus}` : ""} ${clean(event.message)} (${Date.now() - started} ms)`)
        }
        else if (event.type === "done") {
            const hash = await loader.sha256(file.uri)
            const size = test.size === null ? "not given" : event.bytes === test.size ? "equal" : "DIFFERENT"
            const same = test.sha256 === "" ? "not given" : hash === test.sha256 ? "equal" : "DIFFERENT"
            log(`self test done: ${event.bytes} bytes (size ${size}), sha256 ${hash.slice(0, 16)} (hash ${same}), asked from ${askedFrom}, kept ${event.resumedFrom}: ${rangeOutcome(askedFrom, event)}, ${Date.now() - started} ms`)
        }
    }
    catch (error) {
        log(`self test broke: ${clean(error)}`)
    }
    finally {
        unlisten()
        try {
            await loader?.forget(id)
            if (file.exists) file.delete()
            log(`self test file removed: ${file.exists ? "no" : "yes"}`)
        }
        catch (error) {
            log(`self test cleanup broke: ${clean(error)}`)
        }
    }
}
