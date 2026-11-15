// geschrieben nach: eigener Messung am S22 (Phase 3f-4: `extension sandbox: fetch` „after network read, until sandbox answer“ bis 99,8 ms, docs/EIGENER-KERN.md §4m) und dem Vertrag von `__host` in sandbox.ts; keine Vorlage
import { describe, expect, it } from "vitest"
import { type HelperFetch, openExtensionSandbox } from "./helpers"
import { createBlockingWatch, type PieceWhere } from "../../blocking"
import { deviceSandboxEngine, type SandboxNativeModule } from "../sandbox/device-engine"
import { nodeSandboxEngine } from "../sandbox/node-engine"

/** A page as large as a big listing: markup full of quotes, line ends and some text outside ASCII */
function pageOf(bytes: number): string {
    const row = `<div class="item" data-id="7">\n  <a href="/watch/x?ep=1&amp;s=2" title="Folge – „1“">Dr. STONE ☆</a>\t</div>\n`
    return row.repeat(Math.ceil(bytes / row.length))
}

describe("the page fetch answers", () => {
    it("crosses to the module beside the JSON: the thread is not held in proportion to its length (3g)", async () => {
        const page = pageOf(6 * 1024 * 1024)
        const pieces: { milliseconds: number, where: PieceWhere }[] = []
        const watch = createBlockingWatch({
            now: () => performance.now(),
            onPiece: (milliseconds, _what, where) => pieces.push({ milliseconds, where }),
            free: () => new Promise(resolve => setTimeout(resolve, 0)),
        })
        const answers: [number, boolean, string, string][] = []
        let ask: ((call: number, name: string, payload: string) => void) | undefined
        // the module's side as core-sandbox.ts wraps it: every call into it answered from its own thread
        const native: SandboxNativeModule = {
            create: async (_memory, _stack, _time, onHostCall) => {
                ask = onHostCall
                return {
                    run: async () => "",
                    runKept: async () => "",
                    answerHost: watch.waiting(async (call: number, ok: boolean, value: string, body: string) => void answers.push([call, ok, value, body]), "sandbox answer"),
                    close: async () => undefined,
                }
            },
            nativeHeapBytes: async () => 0,
            keepScript: async () => undefined,
        }
        const engine = deviceSandboxEngine(native, async (work, name) => {
            watch.enter(name)
            try {
                await work()
            }
            finally {
                watch.leave()
            }
        })
        const fetcher: HelperFetch = watch.waiting(async (url: string) => ({
            status: 200,
            statusText: "OK",
            url,
            redirected: false,
            headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
            text: watch.waiting(async () => page, "network read"),
        }), "network")
        const sandbox = await openExtensionSandbox(engine, { fetch: fetcher })
        ask?.(1, "fetch", JSON.stringify({ url: "https://example.org/list", method: "GET", headers: {}, redirect: "follow", timeoutMs: 5000 }))
        while (answers.length === 0) await new Promise(resolve => setTimeout(resolve, 5))
        await sandbox.close()

        const piece = pieces.find(({ where }) => where.from === "network read")
        expect(piece?.where.until).toBe("sandbox answer")
        expect(piece?.milliseconds).toBeLessThan(8)
        const [call, ok, value, body] = answers[0]
        expect([call, ok]).toEqual([1, true])
        expect(body).toBe(page)
        const head = JSON.parse(value) as Record<string, unknown>
        expect(head.body).toBeUndefined()
        expect(head.status).toBe(200)
    })

    it("still reaches the extension whole: text, JSON and length", async () => {
        const page = `{"title":"Dr. STONE – „Folge 1“","quote":"\\"x\\"","list":[1,2]}`
        const fetcher: HelperFetch = async url => ({
            status: 200,
            statusText: "OK",
            url,
            redirected: false,
            headers: new Headers({ "content-type": "application/json" }),
            text: async () => (url.endsWith("?empty") ? "" : page),
        })
        const sandbox = await openExtensionSandbox(nodeSandboxEngine, { fetch: fetcher })
        try {
            await sandbox.load(`
                async function probe(url) {
                    const one = await fetch(url)
                    const empty = await fetch(url + "?empty")
                    return [one.text(), one.json().title, one.contentLength, empty.text(), empty.contentLength]
                }
            `)
            const result = await sandbox.call<[string, string, number, string, number]>("probe", "https://example.org/a")
            expect(result[0]).toBe(page)
            expect(result[1]).toBe("Dr. STONE – „Folge 1“")
            expect(result[2]).toBe(Buffer.byteLength(page, "utf8"))
            expect(result.slice(3)).toEqual(["", 0])
        }
        finally {
            await sandbox.close()
        }
    })
})
