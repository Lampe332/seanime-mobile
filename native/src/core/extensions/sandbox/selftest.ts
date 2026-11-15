// geschrieben nach: Plan „Eigener Kern" Stufe 3a (Grenzen nachweisen: Zeit, Speicher, Stapel, kein Zugriff nach außen, getrennte Sandkästen, Brücke zum Wirt); eigene Proben, keine Vorlage

/*
 * The sandbox proves its limits: the same probes against every engine, under Node in the logic tests and on the device
 * through a link of the test app (docs/EIGENER-KERN.md §4h). Each probe opens sandboxes of its own and closes them.
 */

import type { PieceWhere } from "../../blocking"
import type { ExtensionBrowser } from "../browser/cloudflare"
import { type ExtensionSandbox, type HelperFetch, openExtensionSandbox } from "../helpers/helpers"
import { type HostFunctions, type Sandbox, type SandboxEngine, type SandboxLimits, SandboxError, openSandbox } from "./sandbox"

/** A piece of the self test as the watch of the app's thread saw it, with the probe that ran meanwhile */
export type SelfTestPiece = { milliseconds: number, probe: string, where: PieceWhere }

/**
 * The pieces over the limit as log lines: which probe ran, after which wait the piece began, at which it ended, and its
 * named sections. The count alone did not say where the self test held the thread too long (8-ms round 2, §4r).
 */
export function piecesOverLimit(pieces: SelfTestPiece[], limit: number): string[] {
    return pieces.filter(piece => piece.milliseconds > limit).map(({ milliseconds, probe, where }) => {
        const sections = where.sections.length > 1 ? `; ${where.sections.filter(section => section.milliseconds >= 0.5).map(section => `${section.name} ${section.milliseconds.toFixed(1)}`).join(", ")}` : ""
        return `${milliseconds.toFixed(1)} ms in ${probe} (after ${where.from}, until ${where.until}${sections})`
    })
}

export type SelfTestLine = { probe: string, ok: boolean, ms: number, detail: string }
export type SelfTestReport = { ok: boolean, ms: number, lines: SelfTestLine[] }

export type SelfTestParts = {
    /** A clock in milliseconds */
    now: () => number
    /** The app's network: the probe of the door fetches `url` through it */
    fetchText: (url: string) => Promise<{ status: number, body: string }>
    url: string
    /** The app's network as the helpers for extensions use it (phase 3b): the probe of the helpers fetches `url` through it */
    fetch: HelperFetch
    /** The app's hidden browser, where there is one (phase 3d): the probe of ChromeDP reads `pageUrl` with it */
    browser?: ExtensionBrowser
    /** A harmless public page; only its title is read, the probe brings what it clicks and types into */
    pageUrl?: string
    /** How many sandboxes the last probe opens and closes */
    cycles?: number
    /** On the device: marks a wait of the app's side for the watch of the app's thread (core/blocking.ts) */
    waiting?: <Result>(wait: () => Promise<Result>) => () => Promise<Result>
    /** Called when a probe starts, with its name: the device's timer measure says during which probe a timer was late */
    onProbe?: (name: string) => void
}

/** What a sandbox must not have unless the app puts it there */
const ABSENT = ["require", "process", "module", "std", "os", "Deno", "XMLHttpRequest", "WebSocket", "fetch", "setTimeout", "setInterval", "console"]

const CODE = `
function add(a, b) { return a + b }
async function later(value) { await null; return { value: value } }
class Thing { hello() { return "hello" } }
const things = { count: 2, twice: function (n) { return n * this.count } }
function nothing() {}
function boom() { throw new TypeError("boom") }
function spin() { for (;;) {} }
async function spinLater() { await null; for (;;) {} }
function bomb() { const all = []; const piece = "x".repeat(1 << 20); for (;;) all.push(piece + all.length) }
function deep(n) { return deep(n + 1) + 1 }
function reach() { const found = {}; for (const name of ${JSON.stringify(ABSENT)}) found[name] = typeof globalThis[name]; return found }
async function tryImport(name) { try { await import(name); return "loaded" } catch (error) { return "refused" } }
function keep(value) { globalThis.keptValue = value; return typeof keptValue }
function hasKept() { return typeof globalThis.keptValue }
async function ask(name, payload) { return await host.ask(name, payload) }
async function askAll(values) { return await Promise.all(values.map(function (value) { return host.ask("echo", value) })) }
async function askCaught(name) { try { await host.ask(name, null); return "answered" } catch (error) { return "caught: " + error.message } }
async function fetchLength(url) { const answer = await host.ask("fetch", { url: url }); return { status: answer.status, length: answer.body.length } }
`

/** An extension's use of the light helpers (docs/EIGENER-KERN.md §4i) */
const HELPER_CODE = `
async function probeHelpers(url) {
    const r = await fetch(url, { headers: { Accept: "application/json", "X-Probe": "1" } })
    const data = r.json()
    return {
        status: r.status, ok: r.ok, type: r.headers.get("content-type"), keys: Object.keys(data).length, text: r.text().length,
        sha: CryptoJS.SHA256("abc").toString(),
        aes: CryptoJS.AES.decrypt(CryptoJS.AES.encrypt("probe ü", "key").toString(), "key").toString(CryptoJS.enc.Utf8),
        base64: Buffer.from("héllo").toString("base64"), atob: atob("Zm9vYmFy"), btoa: btoa("foobar"),
        url: new URL("../b?x=1", "https://example.test/a/c").href, params: new URLSearchParams({ q: "dr. stone" }).toString(),
    }
}
`

/** An extension's use of the medium helpers (docs/EIGENER-KERN.md §4j): one short check each, timed one by one */
const MEDIUM_CODE = `
function probeDoc() {
    const $ = LoadDoc('<ul><li class="a" data-id="1"><a href="/x">One</a></li><li>Two &amp; more</li></ul>')
    return $("li").map(function (i, el) { return el.text() }).join(",") + "|" + $("a").attr("href") + "|" + $("li.a").data("id")
}
function probeFeed() {
    const feed = $goFeed.parse('<rss version="2.0"><channel><title>T</title><item><title>I</title><link>https://example.test/1</link></item></channel></rss>')
    return feed.feedType + "|" + feed.title + "|" + feed.items[0].link
}
function probeHabari() {
    const m = $habari.parse("[SubsPlease] Dr. Stone - 05 (1080p) [ABCD1234].mkv")
    return [m.release_group, m.title, m.episode_number[0], m.video_resolution, m.file_checksum].join("|")
}
function probeTorrent(b64) { return $torrentUtils.getMagnetLinkFromTorrentData(b64) }
`
/**
 * An extension's use of ChromeDP (docs/EIGENER-KERN.md §4k): one page, read and used with the steps of the contract.
 * What is clicked and typed into are elements the probe puts there itself, so the page's own content does not matter.
 */
const BROWSER_CODE = `
async function probeNoBrowser() { try { await ChromeDP.newBrowser(); return "opened" } catch (error) { return error.message } }
async function probeBrowser(url) {
    const browser = await ChromeDP.newBrowser({ timeout: 30 })
    const out = {}
    try {
        const start = Date.now()
        await browser.navigate(url)
        await browser.waitVisible("body")
        out.loadMs = Date.now() - start
        out.title = await browser.text("title")
        out.sameTitle = (await browser.evaluate("document.title")) === out.title
        await browser.evaluate("(function () { var i = document.createElement('input'); i.id = 'probe-in'; i.value = 'ab'; var b = document.createElement('button'); b.id = 'probe-b'; b.textContent = 'b'; b.setAttribute('data-n', '0'); b.addEventListener('click', function () { b.setAttribute('data-n', String(Number(b.getAttribute('data-n')) + 1)) }); document.body.appendChild(i); document.body.appendChild(b); return true })()")
        await browser.waitReady("#probe-b")
        await browser.click("#probe-b")
        out.clicked = await browser.attribute("#probe-b", "data-n")
        out.none = await browser.attribute("#probe-b", "data-none")
        await browser.sendKeys("#probe-in", "cd")
        out.typed = await browser.evaluate("document.getElementById('probe-in').value")
        out.outer = await browser.outerHTML("#probe-b")
        out.inner = await browser.innerHTML("#probe-b")
        out.sum = await browser.evaluate("new Promise(function (done) { setTimeout(function () { done(1 + 2) }, 10) })")
        out.html = (await browser.outerHTML("html")).length
        try { await browser.fullScreenshot(); out.shot = "taken" } catch (error) { out.shot = "refused" }
    }
    finally {
        await browser.close()
    }
    try { await browser.text("title"); out.closed = "answered" } catch (error) { out.closed = "refused" }
    return out
}
`
/** "d4:infod4:name3:abcee": a torrent whose info dictionary is d4:name3:abce, SHA-1 0c3b1833… */
const TINY_TORRENT = "ZDQ6aW5mb2Q0Om5hbWUzOmFiY2Vl"
const TINY_MAGNET = "magnet:?xt=urn:btih:0c3b1833b425f70628722acc387340ffe0214cf5&dn=abc"

function expect(condition: boolean, text: string) {
    if (!condition) throw new Error(text)
}

/** The kind of error a call ends in, "none" when it does not fail */
async function kindOf(call: Promise<unknown>): Promise<string> {
    try {
        await call
        return "none"
    }
    catch (error) {
        return error instanceof SandboxError ? error.kind : `not a sandbox error: ${String(error)}`
    }
}

export async function runSandboxSelfTest(engine: SandboxEngine, { now, fetchText, url, fetch, browser, pageUrl, cycles = 30, waiting = wait => wait, onProbe = () => undefined }: SelfTestParts): Promise<SelfTestReport> {
    const lines: SelfTestLine[] = []
    const started = now()

    async function fresh(limits?: Partial<SandboxLimits>, host?: HostFunctions): Promise<Sandbox> {
        const sandbox = await openSandbox(engine, { limits, host })
        try {
            await sandbox.load(CODE, "selftest.js")
        }
        catch (error) {
            await sandbox.close().catch(() => undefined)
            throw error
        }
        return sandbox
    }

    async function probe(name: string, limits: Partial<SandboxLimits> | undefined, host: HostFunctions | undefined, run: (sandbox: Sandbox) => Promise<string>) {
        onProbe(name)
        const start = now()
        let sandbox: Sandbox | null = null
        try {
            sandbox = await fresh(limits, host)
            const detail = await run(sandbox)
            lines.push({ probe: name, ok: true, ms: now() - start, detail })
        }
        catch (error) {
            lines.push({ probe: name, ok: false, ms: now() - start, detail: error instanceof Error ? error.message : String(error) })
        }
        finally {
            await sandbox?.close().catch(() => undefined)
        }
    }

    {
        onProbe("open")
        const start = now()
        try {
            const sandbox = await openSandbox(engine)
            const opened = now() - start
            await sandbox.close()
            lines.push({ probe: "open", ok: true, ms: opened, detail: `a sandbox opened in ${opened.toFixed(1)} ms` })
        }
        catch (error) {
            lines.push({ probe: "open", ok: false, ms: now() - start, detail: String(error) })
        }
    }

    await probe("call", undefined, undefined, async sandbox => {
        expect(await sandbox.call("add", 2, 3) === 5, "add(2, 3) is not 5")
        expect((await sandbox.call<{ value: string }>("later", "ü   \"")).value === "ü   \"", "a promise's value did not come back as it went in")
        expect(await sandbox.call("things.twice", 4) === 8, "a method lost its object")
        await sandbox.load(`function useThing() { return new Thing().hello() }`, "second.js")
        expect(await sandbox.call("useThing") === "hello", "a class of the first script is not there for the second")
        expect(await sandbox.call("nothing") === null, "a function without a result does not give null")
        return "arguments and results as JSON, a promise waited for, declarations kept between scripts"
    })

    await probe("thrown", undefined, undefined, async sandbox => {
        let text = ""
        const kind = await kindOf(sandbox.call("boom").catch((error: unknown) => {
            text = String((error as Error).message)
            throw error
        }))
        expect(kind === "thrown" && text.includes("boom"), `kind ${kind}, text ${text}`)
        expect(await kindOf(sandbox.call("nothingThere")) === "thrown", "a missing function is not reported as thrown")
        expect(await sandbox.call("add", 1, 1) === 2, "the sandbox does not go on after an error")
        return `kind thrown, "${text.split("\n")[0].slice(0, 60)}", sandbox goes on`
    })

    await probe("time", { timeMs: 300 }, undefined, async sandbox => {
        const start = now()
        const kind = await kindOf(sandbox.call("spin"))
        const took = now() - start
        expect(kind === "time", `an endless loop ended as ${kind}`)
        expect(took >= 250 && took < 3000, `an endless loop was stopped after ${took.toFixed(0)} ms with a limit of 300 ms`)
        const startLater = now()
        const kindLater = await kindOf(sandbox.call("spinLater"))
        const tookLater = now() - startLater
        expect(kindLater === "time" && tookLater < 3000, `an endless loop after an await ended as ${kindLater} after ${tookLater.toFixed(0)} ms`)
        expect(await sandbox.call("add", 1, 1) === 2, "the sandbox does not go on after it was stopped")
        return `endless loop stopped after ${took.toFixed(0)} ms, after an await after ${tookLater.toFixed(0)} ms (limit 300 ms), sandbox goes on`
    })

    {
        let release = () => undefined as void
        const stall = waiting(() => new Promise<null>(resolve => { release = () => resolve(null) }))
        await probe("time while the app answers", { timeMs: 300 }, { stall }, async sandbox => {
            const start = now()
            const kind = await kindOf(sandbox.call("ask", "stall"))
            const took = now() - start
            release()
            expect(kind === "time" && took >= 250 && took < 3000, `kind ${kind} after ${took.toFixed(0)} ms`)
            return `a call waiting for the app was stopped after ${took.toFixed(0)} ms (limit 300 ms)`
        })
    }

    await probe("memory", { memoryBytes: 16 * 1024 * 1024 }, undefined, async sandbox => {
        const start = now()
        const kind = await kindOf(sandbox.call("bomb"))
        const took = now() - start
        expect(kind === "memory", `a memory bomb ended as ${kind}`)
        const after = await kindOf(sandbox.call("add", 1, 1))
        expect(after === "closed", `after the memory limit the sandbox is ${after}, not closed`)
        return `memory bomb stopped at the limit of 16 MB after ${took.toFixed(0)} ms, sandbox closed`
    })

    await probe("stack", undefined, undefined, async sandbox => {
        const kind = await kindOf(sandbox.call("deep", 0))
        expect(kind === "stack", `an endless recursion ended as ${kind}`)
        expect(await sandbox.call("add", 1, 1) === 2, "the sandbox does not go on after the stack error")
        return "endless recursion ended as a stack error, sandbox goes on"
    })

    await probe("nothing of the outside", undefined, undefined, async sandbox => {
        const found = await sandbox.call<Record<string, string>>("reach")
        const there = ABSENT.filter(name => found[name] !== "undefined")
        expect(there.length === 0, `inside the sandbox there is: ${there.map(name => `${name} (${found[name]})`).join(", ")}`)
        for (const name of ["std", "os", "fs", "node:fs", "./other.js"]) {
            const outcome = await sandbox.call("tryImport", name)
            expect(outcome === "refused", `import("${name}") was ${String(outcome)}`)
        }
        return `none of ${ABSENT.join(", ")}; import of std, os, fs and a file refused`
    })

    await probe("apart", undefined, undefined, async first => {
        const second = await fresh()
        try {
            expect(await first.call("keep", { secret: 1 }) === "object", "a global value was not kept in its own sandbox")
            expect(await second.call("hasKept") === "undefined" && await first.call("hasKept") === "object", "a second sandbox sees the first one's global value")
        }
        finally {
            await second.close()
        }
        return "a global value of one sandbox is not there in another"
    })

    {
        const host: HostFunctions = {
            echo: payload => payload,
            fail: () => {
                throw new Error("the app says no")
            },
            fetch: async payload => fetchText(String((payload as { url: unknown }).url)),
        }
        await probe("door to the app", undefined, host, async sandbox => {
            expect(JSON.stringify(await sandbox.call("ask", "echo", { a: [1, "ü", null] })) === `{"a":[1,"ü",null]}`, "an answer of the app did not arrive as sent")
            expect(JSON.stringify(await sandbox.call("askAll", [1, 2, 3])) === "[1,2,3]", "three questions at once were not answered each")
            const refused = await sandbox.call<string>("askCaught", "fail")
            expect(refused.startsWith("caught: ") && refused.includes("the app says no"), `a refusal of the app arrived as: ${refused}`)
            const unknown = await sandbox.call<string>("askCaught", "nothingThere")
            expect(unknown.startsWith("caught: "), `a question the app has no answer for: ${unknown}`)
            return "answers as JSON, three at once, a refusal arrives inside as an error"
        })
        await probe("fetch through the app", undefined, host, async sandbox => {
            const start = now()
            const answer = await sandbox.call<{ status: number, length: number }>("fetchLength", url)
            expect(answer.status === 200 && answer.length > 0, `status ${answer.status}, ${answer.length} characters`)
            return `status ${answer.status}, ${answer.length} characters in ${(now() - start).toFixed(0)} ms`
        })
    }

    {
        onProbe("helpers")
        const start = now()
        let sandbox: ExtensionSandbox | null = null
        try {
            const loads: number[] = []
            for (let i = 0; i < 3; i++) {
                const plain = await openExtensionSandbox(engine, { fetch, now })
                loads.push(plain.helpersMs)
                await plain.close()
            }
            const sent: Record<string, string>[] = []
            sandbox = await openExtensionSandbox(engine, { fetch: (address, init) => { sent.push(init.headers); return fetch(address, init) }, now })
            loads.push(sandbox.helpersMs)
            await sandbox.load(HELPER_CODE, "helpers-probe.js")
            const fetchStart = now()
            const r = await sandbox.call<Record<string, unknown>>("probeHelpers", url)
            const fetchMs = now() - fetchStart
            expect(r.status === 200 && r.ok === true && String(r.type).includes("json") && Number(r.keys) > 0, `fetch: status ${String(r.status)}, ok ${String(r.ok)}, type ${String(r.type)}, ${String(r.keys)} keys`)
            expect(sent.length === 1 && sent[0].Accept === "application/json" && sent[0]["X-Probe"] === "1", `the headers did not reach the app: ${JSON.stringify(sent)}`)
            expect(r.sha === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", `SHA-256 of "abc" is ${String(r.sha)}`)
            expect(r.aes === "probe ü", `AES round trip gave ${String(r.aes)}`)
            expect(r.base64 === "aMOpbGxv" && r.atob === "foobar" && r.btoa === "Zm9vYmFy", `Base64: ${String(r.base64)}, ${String(r.atob)}, ${String(r.btoa)}`)
            expect(r.url === "https://example.test/b?x=1" && r.params === "q=dr.+stone", `URL: ${String(r.url)}, ${String(r.params)}`)
            const most = Math.max(...loads)
            const mean = loads.reduce((sum, ms) => sum + ms, 0) / loads.length
            lines.push({ probe: "helpers", ok: true, ms: now() - start, detail: `helpers loaded in ${mean.toFixed(1)} ms on average, ${most.toFixed(1)} ms at most (${loads.length} sandboxes); fetch with headers and JSON ${String(r.status)}, ${String(r.text)} characters in ${fetchMs.toFixed(0)} ms; SHA-256, AES, Buffer, atob/btoa, URL right` })
        }
        catch (error) {
            lines.push({ probe: "helpers", ok: false, ms: now() - start, detail: error instanceof Error ? error.message : String(error) })
        }
        finally {
            await sandbox?.close().catch(() => undefined)
        }
    }

    {
        onProbe("medium helpers")
        const start = now()
        let sandbox: ExtensionSandbox | null = null
        try {
            sandbox = await openExtensionSandbox(engine, { fetch, now })
            const base = sandbox.helpersMs
            await sandbox.load(MEDIUM_CODE, "medium-probe.js")
            const doc = sandbox.docHelpersMs() ?? Number.NaN
            const timed = async (name: string, ...args: unknown[]) => {
                const callStart = now()
                const value = await sandbox!.call<string>(name, ...args)
                return { value, ms: now() - callStart }
            }
            const html = await timed("probeDoc")
            const feed = await timed("probeFeed")
            const habari = await timed("probeHabari")
            const torrent = await timed("probeTorrent", TINY_TORRENT)
            expect(html.value === "One,Two & more|/x|1", `LoadDoc: ${html.value}`)
            expect(feed.value === "rss|T|https://example.test/1", `$goFeed: ${feed.value}`)
            expect(habari.value === "SubsPlease|Dr. Stone|05|1080p|ABCD1234", `$habari: ${habari.value}`)
            expect(torrent.value === TINY_MAGNET, `$torrentUtils: ${torrent.value}`)
            const ms = (value: number) => value.toFixed(1)
            lines.push({ probe: "medium helpers", ok: true, ms: now() - start, detail: `light helpers ${ms(base)} ms, LoadDoc/Doc/$goFeed loaded in ${ms(doc)} ms (${ms(base + doc)} ms together); LoadDoc ${ms(html.ms)} ms, $goFeed ${ms(feed.ms)} ms, $habari ${ms(habari.ms)} ms, $torrentUtils ${ms(torrent.ms)} ms, all right` })
        }
        catch (error) {
            lines.push({ probe: "medium helpers", ok: false, ms: now() - start, detail: error instanceof Error ? error.message : String(error) })
        }
        finally {
            await sandbox?.close().catch(() => undefined)
        }
    }

    {
        onProbe("ChromeDP")
        const start = now()
        let sandbox: ExtensionSandbox | null = null
        try {
            sandbox = await openExtensionSandbox(engine, { fetch, now, browser })
            await sandbox.load(BROWSER_CODE, "browser-probe.js")
            if (!browser || !pageUrl) {
                const said = await sandbox.call<string>("probeNoBrowser")
                expect(said.includes("not available here"), `without a hidden browser ChromeDP said: ${said}`)
                lines.push({ probe: "ChromeDP", ok: true, ms: now() - start, detail: "no hidden browser here, and ChromeDP says so" })
            }
            else {
                const r = await sandbox.call<Record<string, unknown>>("probeBrowser", pageUrl)
                expect(typeof r.title === "string" && r.title !== "" && r.sameTitle === true, `the page's title is ${JSON.stringify(r.title)}, the same by evaluate: ${String(r.sameTitle)}`)
                expect(r.clicked === "1" && r.none === null, `after one click the button counted ${String(r.clicked)}, a missing attribute is ${String(r.none)}`)
                expect(r.typed === "abcd", `sendKeys left ${String(r.typed)} in the field`)
                expect(String(r.outer).startsWith("<button") && r.inner === "b", `outerHTML ${String(r.outer).slice(0, 40)}, innerHTML ${String(r.inner)}`)
                expect(r.sum === 3 && Number(r.html) > 100, `evaluate with a promise gave ${String(r.sum)}, the page has ${String(r.html)} characters`)
                expect(r.shot === "refused" && r.closed === "refused", `a screenshot was ${String(r.shot)}, a step after close ${String(r.closed)}`)
                lines.push({ probe: "ChromeDP", ok: true, ms: now() - start, detail: `page "${String(r.title)}" loaded and visible in ${Number(r.loadMs).toFixed(0)} ms; text, evaluate (promise waited for), click, attribute, sendKeys, innerHTML, outerHTML (${String(r.html)} characters) right; screenshot refused as documented; closed` })
            }
        }
        catch (error) {
            lines.push({ probe: "ChromeDP", ok: false, ms: now() - start, detail: error instanceof Error ? error.message : String(error) })
        }
        finally {
            await sandbox?.close().catch(() => undefined)
        }
    }

    {
        onProbe("open and close")
        const start = now()
        try {
            const before = await engine.memoryInUse?.()
            for (let cycle = 0; cycle < cycles; cycle++) {
                const sandbox = await fresh()
                expect(await sandbox.call("add", cycle, 1) === cycle + 1, "a sandbox of the row gave a wrong result")
                await sandbox.close()
            }
            const after = await engine.memoryInUse?.()
            const each = (now() - start) / cycles
            if (before === undefined || after === undefined) {
                lines.push({ probe: "open and close", ok: true, ms: now() - start, detail: `${cycles} sandboxes opened, used and closed, ${each.toFixed(1)} ms each; memory not measured here` })
            }
            else {
                const grown = after - before
                // one sandbox with the probes loaded holds some hundred KB: without freeing, the row would hold far more
                const ok = grown < 4 * 1024 * 1024
                lines.push({ probe: "open and close", ok, ms: now() - start, detail: `${cycles} sandboxes opened, used and closed, ${each.toFixed(1)} ms each; memory outside of JavaScript ${(grown / 1024).toFixed(0)} KB more than before` })
            }
        }
        catch (error) {
            lines.push({ probe: "open and close", ok: false, ms: now() - start, detail: error instanceof Error ? error.message : String(error) })
        }
    }

    return { ok: lines.every(line => line.ok), ms: now() - started, lines }
}
