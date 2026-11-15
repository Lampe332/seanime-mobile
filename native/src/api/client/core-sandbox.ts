// geschrieben nach: docs/EIGENER-KERN.md §4h (Sandkasten für Erweiterungen), §4i (Hilfsfunktionen), §4k (verstecktes WebView) und §4b (Wächter für den Faden der Oberfläche), Doku von expo-file-system (Directory, File); kein Server-Quelltext
import { type CloudflareEvent, type ExtensionBrowser, type HelperFetch, type HiddenBrowser, type SandboxEngine, type SandboxNativeModule, LONGEST_PIECE_MS, type SelfTestPiece, createBlockingWatch, createExtensionBrowser, deviceSandboxEngine, openExtensionSandbox, piecesOverLimit, runSandboxSelfTest } from "@/core"
import { hiddenBrowser } from "@/lib/hidden-browser/hidden-browser"
import * as Application from "expo-application"
import { Directory, File } from "expo-file-system"

/*
 * The sandbox for extensions on the device: the core's engine contract, carried by the app's native module
 * (modules/core-sandbox). Nothing of the app uses a sandbox yet; the callers are the self test and the practice run
 * below, each started by a link of the test app (lib/app-links.ts).
 */

/** A harmless public address for the probe of the door: the search of the Internet Archive, five identifiers */
const SELF_TEST_URL = "https://archive.org/advancedsearch.php?q=title%3A%28dr.+stone%29&fl%5B%5D=identifier&rows=5&output=json"

/** A harmless public page for the probe of ChromeDP: IANA's page about the example domains */
const SELF_TEST_PAGE = "https://www.iana.org/help/example-domains"

/** Where extension code for a practice run is put on the device (adb), inside the app's own folder on the shared storage */
const PRACTICE_FOLDER = "core-practice"

type Watch = ReturnType<typeof createBlockingWatch>

/** The longest time one call into the module held the app's thread before it returned, per method (self test, §4l) */
const longestCall: Record<string, number> = {}

function timed<Args extends unknown[], Result>(name: string, call: (...args: Args) => Result): (...args: Args) => Result {
    return (...args) => {
        const start = performance.now()
        try {
            return call(...args)
        }
        finally {
            longestCall[name] = Math.max(longestCall[name] ?? 0, performance.now() - start)
        }
    }
}

/** The app's hidden browser with every wait of it marked for the watch */
function watchedBrowser(watch: Watch, report?: (event: CloudflareEvent) => void): ExtensionBrowser {
    const browser: HiddenBrowser = {
        open: watch.waiting(async (options: Parameters<HiddenBrowser["open"]>[0]) => {
            const page = await hiddenBrowser.open(options)
            return {
                navigate: watch.waiting((url: string) => page.navigate(url), "page navigate"),
                evaluate: watch.waiting((code: string) => page.evaluate(code), "page evaluate"),
                close: watch.waiting(() => page.close(), "page close"),
            }
        }),
    }
    return createExtensionBrowser(browser, {
        wait: watch.waiting((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))),
        now: () => performance.now(),
        report,
    })
}

/** The helpers' fetch: the app's own network, every wait marked for the watch */
function watchedFetch(watch: Watch): HelperFetch {
    // the marks name what React Native's fetch does on this thread before it waits (3g): not the core's code
    const send = watch.waiting((url: string, init: Parameters<HelperFetch>[1]) => {
        watch.mark("react native fetch()")
        return fetch(url, init as RequestInit)
    }, "network")
    const read = watch.waiting((response: Response) => {
        watch.mark("react native text()")
        return response.text()
    }, "network read")
    return async (url, init) => {
        const response = await send(url, init)
        return { status: response.status, statusText: response.statusText, url: response.url, redirected: response.redirected, headers: response.headers, text: () => read(response) }
    }
}

/** The module is loaded when a sandbox is first asked for, so an app that never opens one never touches it */
async function engineWith(watch: Watch, what: string): Promise<SandboxEngine> {
    const { default: module } = await import("../../../modules/core-sandbox")
    // every call into the module is answered from a thread of its own: real waits for the watch
    const create = watch.waiting((...args: Parameters<SandboxNativeModule["create"]>) => module.create(...args), "sandbox create")
    const native: SandboxNativeModule = {
        create: async (...args) => {
            const box = await create(...args)
            return {
                run: watch.waiting(timed("run", (code: string, name: string) => box.run(code, name)), "sandbox run"),
                runKept: watch.waiting(timed("runKept", (key: string, after: string, name: string) => box.runKept(key, after, name)), "sandbox runKept"),
                answerHost: watch.waiting((call, ok, value, body) => box.answerHost(call, ok, value, body), "sandbox answer"),
                close: watch.waiting(() => box.close(), "sandbox close"),
            }
        },
        nativeHeapBytes: watch.waiting(() => module.nativeHeapBytes()),
        keepScript: watch.waiting(timed("keepScript", (key: string, code: string, append: boolean) => module.keepScript(key, code, append)), "sandbox keepScript"),
    }
    return deviceSandboxEngine(native, async (work, name) => {
        watch.enter(`${what}: ${name}`)
        try {
            await work()
        }
        finally {
            watch.leave()
        }
    })
}

/**
 * What the extensions' part of the core needs of the device (docs/EIGENER-KERN.md §4l): the engine (opened once), the
 * helpers' fetch and the hidden browser, every wait marked for the watch of the requests.
 */
export function extensionTools(watch: Watch): { engine: () => Promise<SandboxEngine>, fetch: HelperFetch, browser: ExtensionBrowser } {
    let engine: Promise<SandboxEngine> | null = null
    return {
        engine: () => engine ??= engineWith(watch, "extension sandbox").catch(error => {
            engine = null
            throw error
        }),
        fetch: watchedFetch(watch),
        browser: watchedBrowser(watch),
    }
}

let running = false

/** Hermes' own counters (garbage collection), where the engine has them */
function hermesCounters(): Record<string, number> {
    const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }).HermesInternal
    return hermes?.getInstrumentedStats?.() ?? {}
}

type LateTick = { at: number, late: number, probe: string, core: number, collections: number, collectionMs: number }

/**
 * A timer of 2 ms on the app's thread, and for every tick more than 8 ms late: during which probe, how much of that
 * time the core held the thread (its pieces), and whether Hermes collected garbage meanwhile (docs/EIGENER-KERN.md §4j).
 */
function watchTimer(spans: [number, number][], probeNow: () => string) {
    const started = performance.now()
    const late: LateTick[] = []
    let longest = 0
    let last = started
    let counters = hermesCounters()
    const ticker = setInterval(() => {
        const now = performance.now()
        const next = hermesCounters()
        const gap = now - last - 2
        longest = Math.max(longest, gap)
        if (gap > 8) {
            let core = 0
            for (const [from, to] of spans) core += Math.max(0, Math.min(to, now) - Math.max(from, last))
            late.push({
                at: last - started,
                late: gap,
                probe: probeNow(),
                core,
                collections: (next.js_numGCs ?? 0) - (counters.js_numGCs ?? 0),
                collectionMs: ((next.js_gcTime ?? 0) - (counters.js_gcTime ?? 0)) * 1000,
            })
        }
        counters = next
        last = now
    }, 2)
    return () => {
        clearInterval(ticker)
        return { longest, late, ms: performance.now() - started }
    }
}

function describeLate(late: LateTick[]): string {
    const worst = [...late].sort((a, b) => b.late - a.late).slice(0, 5)
    const inCore = late.filter(tick => tick.core > tick.late / 2).length
    const withCollection = late.filter(tick => tick.collections > 0).length
    return `${late.length} ticks more than 8 ms late (${inCore} mostly while the core held the thread, ${withCollection} with a garbage collection of Hermes); worst: ${worst.map(tick => `${tick.late.toFixed(1)} ms at ${tick.at.toFixed(0)} ms in "${tick.probe}" (core ${tick.core.toFixed(1)} ms, ${tick.collections} collections ${tick.collectionMs.toFixed(1)} ms)`).join("; ") || "none"}`
}

/**
 * Test and scratch app only (a link): every probe of the sandbox's limits on this device, with the result of each in
 * the log, and how long the sandbox held the app's thread in one piece while they ran.
 */
export async function runCoreSandboxSelfTest(): Promise<void> {
    if (running) return
    running = true
    const what = "sandbox self test"
    const pieces: number[] = []
    const spans: [number, number][] = []
    // where each piece ran, so a piece over the limit is found in the log (8-ms round 2)
    const placed: SelfTestPiece[] = []
    let probe = "idle"
    const watch = createBlockingWatch({
        now: () => performance.now(),
        onPiece: (milliseconds, _what, where) => {
            pieces.push(milliseconds)
            placed.push({ milliseconds, probe, where })
            const end = performance.now()
            spans.push([end - milliseconds, end])
        },
        free: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
    })
    // first the app alone for 3 s, no core work: how late the timer is anyway
    const idleStop = watchTimer(spans, () => probe)
    await new Promise(resolve => setTimeout(resolve, 3000))
    const idle = idleStop()
    console.log(`[CoreSandbox] info timer while idle: a 2 ms timer of the app was late by ${idle.longest.toFixed(1)} ms at most in ${idle.ms.toFixed(0)} ms; ${describeLate(idle.late)}`)
    // the whole app's thread, whoever holds it: how late a timer of 2 ms fires while the probes run
    probe = "start"
    const stopTimer = watchTimer(spans, () => probe)
    const countersBefore = hermesCounters()
    const get = watch.waiting((url: string) => fetch(url))
    const read = watch.waiting((response: Response) => response.text())
    const appFetch = watchedFetch(watch)
    console.log("[CoreSandbox] info self test started")
    watch.enter(what)
    try {
        const engine = await engineWith(watch, what)
        const report = await runSandboxSelfTest(engine, {
            now: () => performance.now(),
            fetchText: async url => {
                const response = await get(url)
                return { status: response.status, body: await read(response) }
            },
            url: SELF_TEST_URL,
            fetch: appFetch,
            browser: watchedBrowser(watch),
            pageUrl: SELF_TEST_PAGE,
            waiting: wait => watch.waiting(wait),
            onProbe: name => {
                probe = name
            },
        })
        watch.leave()
        const timer = stopTimer()
        const countersAfter = hermesCounters()
        for (const line of report.lines) {
            console.log(`[CoreSandbox] info ${line.ok ? "ok" : "FAILED"} ${line.probe} (${line.ms.toFixed(0)} ms): ${line.detail}`)
        }
        const passed = report.lines.filter(line => line.ok).length
        const longest = Math.max(0, ...pieces)
        const over = pieces.filter(milliseconds => milliseconds > LONGEST_PIECE_MS).length
        console.log(`[CoreSandbox] info self test ${report.ok ? "passed" : "FAILED"}: ${passed} of ${report.lines.length} probes in ${report.ms.toFixed(0)} ms`)
        console.log(`[CoreSandbox] ${over ? "warn" : "info"} the sandbox held the app's thread in ${pieces.length} pieces, longest ${longest.toFixed(1)} ms, ${over} over the ${LONGEST_PIECE_MS} ms allowed; a 2 ms timer of the app was late by ${timer.longest.toFixed(1)} ms at most`)
        for (const line of piecesOverLimit(placed, LONGEST_PIECE_MS)) console.log(`[CoreSandbox] warn piece over ${LONGEST_PIECE_MS} ms: ${line}`)
        console.log(`[CoreSandbox] info longest single call into the module on the app's thread: ${Object.entries(longestCall).map(([name, ms]) => `${name} ${ms.toFixed(2)} ms`).join(", ")}`)
        console.log(`[CoreSandbox] info timer during the test: ${describeLate(timer.late)}; Hermes collected garbage ${(countersAfter.js_numGCs ?? 0) - (countersBefore.js_numGCs ?? 0)} times for ${(((countersAfter.js_gcTime ?? 0) - (countersBefore.js_gcTime ?? 0)) * 1000).toFixed(1)} ms in all${countersAfter.js_numGCs === undefined ? ` (Hermes counters here: ${Object.keys(countersAfter).join(", ") || "none"})` : ""}`)
    }
    catch (error) {
        watch.leave()
        stopTimer()
        console.log(`[CoreSandbox] warn self test could not run: ${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
        running = false
    }
}

/**
 * Test and scratch app only (a link): runs extension code that was brought to the device for this one test, with the
 * real network and the hidden browser. Every `.js` file of the practice folder is loaded into a sandbox of its own and
 * its function `practice()` called; the result, what Cloudflare's check did and how long the sandbox held the app's
 * thread go to the log. No extension code is part of the app; the files are deleted from the device after the test.
 */
export async function runCoreSandboxPractice(): Promise<void> {
    if (running) return
    running = true
    const what = "sandbox practice"
    const pieces: number[] = []
    const spans: [number, number][] = []
    const watch = createBlockingWatch({
        now: () => performance.now(),
        onPiece: milliseconds => {
            pieces.push(milliseconds)
            const end = performance.now()
            spans.push([end - milliseconds, end])
        },
        free: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
    })
    let probe = "start"
    const stopTimer = watchTimer(spans, () => probe)
    try {
        const folder = new Directory(`file:///storage/emulated/0/Android/data/${Application.applicationId}/files/${PRACTICE_FOLDER}`)
        const files = folder.exists ? folder.list().filter((entry): entry is File => entry instanceof File && entry.name.endsWith(".js")).sort((a, b) => a.name.localeCompare(b.name)) : []
        console.log(`[CoreSandbox] info practice started: ${files.length} files in ${PRACTICE_FOLDER}`)
        const appFetch = watchedFetch(watch)
        const engine = await engineWith(watch, what)
        for (const file of files) {
            probe = file.name
            const events: CloudflareEvent[] = []
            const code = await file.text()
            const start = performance.now()
            watch.enter(what)
            let sandbox: Awaited<ReturnType<typeof openExtensionSandbox>> | null = null
            try {
                sandbox = await openExtensionSandbox(engine, {
                    fetch: appFetch,
                    browser: watchedBrowser(watch, event => events.push(event)),
                    // real extensions with the real network: a catalogue of some MB needs more than the 64 MB of trial 2 (§4k)
                    limits: { timeMs: 120_000, memoryBytes: 256 * 1024 * 1024 },
                    now: () => performance.now(),
                    log: (level, text) => console.log(`[CoreSandbox] info practice ${file.name} console.${level}: ${text.slice(0, 300)}`),
                })
                await sandbox.load(code, file.name)
                const result = await sandbox.call("practice")
                console.log(`[CoreSandbox] info practice ${file.name} ok (${(performance.now() - start).toFixed(0)} ms): ${JSON.stringify(result).slice(0, 900)}`)
            }
            catch (error) {
                console.log(`[CoreSandbox] warn practice ${file.name} FAILED (${(performance.now() - start).toFixed(0)} ms): ${error instanceof Error ? error.message : String(error)}`)
            }
            finally {
                await sandbox?.close().catch(() => undefined)
                watch.leave()
            }
            for (const event of events) {
                console.log(`[CoreSandbox] info practice ${file.name} cloudflare ${event.outcome} at ${event.host} after ${event.ms.toFixed(0)} ms: ${event.detail}`)
            }
            if (!events.length) console.log(`[CoreSandbox] info practice ${file.name} cloudflare: no check met`)
        }
        const timer = stopTimer()
        const longest = Math.max(0, ...pieces)
        const over = pieces.filter(milliseconds => milliseconds > LONGEST_PIECE_MS).length
        console.log(`[CoreSandbox] ${over ? "warn" : "info"} practice done: the sandbox held the app's thread in ${pieces.length} pieces, longest ${longest.toFixed(1)} ms, ${over} over the ${LONGEST_PIECE_MS} ms allowed; a 2 ms timer of the app was late by ${timer.longest.toFixed(1)} ms at most; ${describeLate(timer.late)}`)
    }
    catch (error) {
        stopTimer()
        console.log(`[CoreSandbox] warn practice could not run: ${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
        running = false
    }
}
