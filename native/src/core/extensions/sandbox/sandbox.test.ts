// geschrieben nach: Plan „Eigener Kern" Stufe 3a; prüft den Vertrag des Sandkastens gegen QuickJS als WebAssembly (ohne Netz)
import { describe, expect, it } from "vitest"
import { deviceSandboxEngine, type SandboxHostCall, type SandboxNativeModule } from "./device-engine"
import { nodeSandboxEngine } from "./node-engine"
import { DEFAULT_SANDBOX_LIMITS, EngineFailure, SandboxError, openSandbox, sandboxErrorFrom } from "./sandbox"
import { piecesOverLimit, runSandboxSelfTest } from "./selftest"

async function kindOf(call: Promise<unknown>): Promise<string> {
    try {
        await call
        return "none"
    }
    catch (error) {
        return error instanceof SandboxError ? error.kind : `other: ${String(error)}`
    }
}

describe("sandbox under Node (QuickJS as WebAssembly)", () => {
    it("passes every probe of the self test", async () => {
        const asked: string[] = []
        const report = await runSandboxSelfTest(nodeSandboxEngine, {
            now: () => performance.now(),
            // no network in the tests: the app's side of the door answers from here
            fetchText: async url => {
                asked.push(url)
                return { status: 200, body: `{"found":3}` }
            },
            url: "https://example.invalid/search?q=x",
            fetch: async (url, init) => {
                asked.push(`${init.method} ${url}`)
                return {
                    status: 200, statusText: "OK", url, redirected: false,
                    headers: new Headers({ "Content-Type": "application/json" }),
                    text: async () => `{"found":3}`,
                }
            },
            cycles: 20,
        })
        expect(report.lines.filter(line => !line.ok)).toEqual([])
        expect(report.lines.map(line => line.probe)).toEqual([
            "open", "call", "thrown", "time", "time while the app answers", "memory", "stack", "nothing of the outside", "apart",
            "door to the app", "fetch through the app", "helpers", "medium helpers", "ChromeDP", "open and close",
        ])
        expect(report.ok).toBe(true)
        expect(asked).toEqual(["https://example.invalid/search?q=x", "GET https://example.invalid/search?q=x"])
    }, 30_000)

    it("uses the limits of trial 2 unless told otherwise", () => {
        expect(DEFAULT_SANDBOX_LIMITS).toEqual({ memoryBytes: 64 * 1024 * 1024, stackBytes: 512 * 1024, timeMs: 60_000 })
    })

    it("keeps apart what went wrong: thrown, time, memory, stack, closed", async () => {
        const sandbox = await openSandbox(nodeSandboxEngine, { limits: { timeMs: 200, memoryBytes: 8 * 1024 * 1024 } })
        await sandbox.load(`
            function fine() { return 1 }
            function throws() { throw new RangeError("out of range") }
            async function rejects() { throw new Error("later") }
            function loops() { while (true) {} }
            function deep() { return deep() + 1 }
            function grows() { const all = []; const piece = "x".repeat(1 << 20); for (;;) all.push(piece + all.length) }
        `)
        expect(await kindOf(sandbox.call("throws"))).toBe("thrown")
        await expect(sandbox.call("throws")).rejects.toThrow(/RangeError: out of range/)
        await expect(sandbox.call("rejects")).rejects.toThrow(/later/)
        expect(await kindOf(sandbox.call("loops"))).toBe("time")
        expect(await kindOf(sandbox.call("deep"))).toBe("stack")
        expect(await sandbox.call("fine")).toBe(1)
        expect(await kindOf(sandbox.call("grows"))).toBe("memory")
        // closed by the memory limit
        expect(await kindOf(sandbox.call("fine"))).toBe("closed")
        expect(await kindOf(sandbox.load("1"))).toBe("closed")
        await sandbox.close()
    }, 30_000)

    it("reports code that cannot be read, and a script that fails while loading", async () => {
        const sandbox = await openSandbox(nodeSandboxEngine, { limits: { timeMs: 200 } })
        expect(await kindOf(sandbox.load("function ("))).toBe("thrown")
        expect(await kindOf(sandbox.load(`throw new Error("at load")`))).toBe("thrown")
        expect(await kindOf(sandbox.load(`for (;;) {}`))).toBe("time")
        await sandbox.close()
    })

    it("calls only what is a function's name, never code", async () => {
        const sandbox = await openSandbox(nodeSandboxEngine)
        await sandbox.load(`globalThis.touched = false; function touched() { return globalThis.touched }; const box = { inner: { f: function () { return 7 } } }`)
        for (const path of ["(globalThis.touched = true, touched)", "touched)()//", "a b", "", "box..inner", "box[0]"]) {
            expect(await kindOf(sandbox.call(path)), path).toBe("thrown")
        }
        expect(await sandbox.call("box.inner.f")).toBe(7)
        await sandbox.close()
        expect(await kindOf(sandbox.call("box.inner.f"))).toBe("closed")
        // closing twice is fine
        await sandbox.close()
    })

    it("hands arguments in as data: text that looks like code stays text", async () => {
        const sandbox = await openSandbox(nodeSandboxEngine)
        await sandbox.load(`function same(value) { return value }`)
        const tricky = { "__proto__": 1, text: `"); globalThis.broken = true; ("`, line: "a b c", back: "\\" }
        expect(JSON.stringify(await sandbox.call("same", tricky))).toBe(JSON.stringify(tricky))
        await sandbox.load(`function isBroken() { return typeof globalThis.broken }`)
        expect(await sandbox.call("isBroken")).toBe("undefined")
        await sandbox.close()
    })

    it("lets the code inside ask the app, and only for what the app offers", async () => {
        const seen: unknown[] = []
        const sandbox = await openSandbox(nodeSandboxEngine, {
            host: {
                double: async payload => {
                    seen.push(payload)
                    await new Promise(resolve => setTimeout(resolve, 5))
                    return (payload as number) * 2
                },
                nothing: () => undefined,
            },
        })
        await sandbox.load(`
            async function twice(n) { return await host.ask("double", await host.ask("double", n)) }
            async function nothing() { return await host.ask("nothing") }
            async function unknown() { return await host.ask("toString") }
            function raw() { return typeof __host + " " + Object.isFrozen(host) }
        `)
        expect(await sandbox.call("twice", 3)).toBe(12)
        expect(seen).toEqual([3, 6])
        expect(await sandbox.call("nothing")).toBeNull()
        await expect(sandbox.call("unknown")).rejects.toThrow(/the app offers no "toString"/)
        expect(await sandbox.call("raw")).toBe("function true")
        await sandbox.close()
    })

    it("runs one call after the other in a sandbox, and sandboxes side by side", async () => {
        const first = await openSandbox(nodeSandboxEngine, { host: { wait: () => new Promise(resolve => setTimeout(() => resolve(null), 20)) } })
        const second = await openSandbox(nodeSandboxEngine)
        await first.load(`let running = 0; async function slow(n) { running++; const seen = running; await host.ask("wait"); running--; return [n, seen] }`)
        await second.load(`function quick() { return "quick" }`)
        const order: string[] = []
        const all = await Promise.all([
            first.call("slow", 1).then(value => (order.push("slow 1"), value)),
            first.call("slow", 2).then(value => (order.push("slow 2"), value)),
            second.call("quick").then(value => (order.push("quick"), value)),
        ])
        expect(all).toEqual([[1, 1], [2, 1], "quick"])
        expect(order).toEqual(["quick", "slow 1", "slow 2"])
        await first.close()
        await second.close()
    })
})

describe("pieces of the self test over the limit (8-ms round 2)", () => {
    it("names the probe, the waits around the piece and its sections; shorter pieces are left out", () => {
        const lines = piecesOverLimit([
            { milliseconds: 3, probe: "door", where: { from: "start", until: "network", sections: [{ name: "start", milliseconds: 3 }] } },
            { milliseconds: 16.5, probe: "helpers", where: { from: "sandbox call", until: "end", sections: [{ name: "sandbox call", milliseconds: 4.2 }, { name: "answer", milliseconds: 12.3 }] } },
        ], 8)
        expect(lines).toEqual(["16.5 ms in helpers (after sandbox call, until end; sandbox call 4.2, answer 12.3)"])
    })
})

describe("kind of a sandbox error", () => {
    it("is read from what the engine says", () => {
        expect(sandboxErrorFrom(new EngineFailure("time", "stopped")).kind).toBe("time")
        expect(sandboxErrorFrom(new EngineFailure("closed", "gone")).kind).toBe("closed")
        expect(sandboxErrorFrom(new EngineFailure("error", "InternalError: out of memory")).kind).toBe("memory")
        expect(sandboxErrorFrom(new EngineFailure("error", "InternalError: stack overflow")).kind).toBe("stack")
        expect(sandboxErrorFrom(new EngineFailure("error", "RangeError: Maximum call stack size exceeded")).kind).toBe("stack")
        expect(sandboxErrorFrom(new EngineFailure("error", "InternalError: interrupted")).kind).toBe("time")
        expect(sandboxErrorFrom(new EngineFailure("error", "TypeError: x is not a function")).kind).toBe("thrown")
        expect(sandboxErrorFrom("plain text").kind).toBe("thrown")
    })
})

describe("sandbox engine of the device", () => {
    /** The native module's side as the engine sees it: a box per sandbox, codes in the text of its rejections, questions through the callback handed in */
    function moduleOf() {
        const answers: unknown[][] = []
        const calls: unknown[][] = []
        let boxes = 0
        const kept = new Map<string, string>()
        // as it arrives on the device: the layer between may put its own words in front of the module's
        const coded = (code: string, message: string) => new Error(`CoreSandboxBox.run(...): ${code}: ${message}`)
        const native: SandboxNativeModule = {
            create: async (memoryBytes, stackBytes, timeMs, onHostCall) => {
                const box = ++boxes
                calls.push(["create", memoryBytes, stackBytes, timeMs])
                const ask = (call: SandboxHostCall) => onHostCall(call.call, call.name, call.payload)
                return {
                    run: async (code, name) => {
                        calls.push(["run", box, name])
                        if (code.includes("too long")) throw coded("ERR_SANDBOX_TIME", "stopped after 300 ms")
                        if (code.includes("gone")) throw coded("ERR_SANDBOX_CLOSED", "the sandbox is closed")
                        if (code.includes("bomb")) throw coded("ERR_SANDBOX", "InternalError: out of memory")
                        if (code.includes("throws")) throw coded("ERR_SANDBOX", "TypeError: x is not a function")
                        if (code.includes("asks")) {
                            ask({ call: 1, name: "echo", payload: `"hi"` })
                            ask({ call: 2, name: "missing", payload: "null" })
                            await new Promise(resolve => setTimeout(resolve, 5))
                        }
                        return `"done"`
                    },
                    runKept: async (key, after, name) => {
                        calls.push(["runKept", box, key, after, name])
                        if (!kept.has(key)) throw coded("ERR_SANDBOX", `no script is kept under "${key}"`)
                        return ""
                    },
                    answerHost: async (...args) => void answers.push([box, ...args]),
                    close: async () => {
                        calls.push(["close", box])
                        // a question that was on its way when the box closed
                        ask({ call: 3, name: "echo", payload: "1" })
                    },
                }
            },
            nativeHeapBytes: async () => 1234,
            keepScript: async (key, code, append) => {
                calls.push(["keepScript", key, code.length])
                kept.set(key, append ? (kept.get(key) ?? "") + code : code)
            },
        }
        return { native, answers, calls }
    }

    it("passes limits, code and answers through, and reads the module's error codes", async () => {
        const { native, answers, calls } = moduleOf()
        const pieces: string[] = []
        const engine = deviceSandboxEngine(native, async work => {
            pieces.push("in")
            await work()
            pieces.push("out")
        })
        const sandbox = await openSandbox(engine, { limits: { timeMs: 300 }, host: { echo: payload => payload } })
        expect(calls[0]).toEqual(["create", 64 * 1024 * 1024, 512 * 1024, 300])
        await sandbox.load("function asks() {}", "asks.js")
        expect(answers.sort((a, b) => Number(a[1]) - Number(b[1]))).toEqual([[1, 1, true, `"hi"`, ""], [1, 2, false, `the app offers no "missing"`, ""]])
        expect(pieces).toEqual(["in", "in", "out", "out"])
        expect(await kindOf(sandbox.load("too long"))).toBe("time")
        expect(await kindOf(sandbox.load("gone"))).toBe("closed")
        expect(await engine.memoryInUse?.()).toBe(1234)
        const thrown = await sandbox.load("throws").then(() => undefined, (error: unknown) => error as SandboxError)
        expect(thrown?.kind).toBe("thrown")
        expect(thrown?.message).toBe("TypeError: x is not a function")
        expect(await kindOf(sandbox.load("bomb"))).toBe("memory")
        // out of memory closes the sandbox; the question that arrives after that is not answered
        expect(calls.at(-1)).toEqual(["close", 1])
        await new Promise(resolve => setTimeout(resolve, 5))
        expect(answers).toHaveLength(2)
        // every sandbox has a box of its own
        const second = await openSandbox(engine)
        await second.close()
        expect(calls.at(-1)).toEqual(["close", 2])
    })

    it("hands a kept script over once and then only its key, in every sandbox (§4l)", async () => {
        const { native, calls } = moduleOf()
        const engine = deviceSandboxEngine(native)
        const big = "x".repeat(100_000)
        for (let index = 0; index < 3; index++) {
            const sandbox = await openSandbox(engine)
            await sandbox.loadKept("helpers", big, `(${index})`, "helpers.js")
            await sandbox.close()
        }
        // handed over in parts of 24 KB, once
        expect(calls.filter(call => call[0] === "keepScript")).toEqual([["keepScript", "helpers", 24_576], ["keepScript", "helpers", 24_576], ["keepScript", "helpers", 24_576], ["keepScript", "helpers", 24_576], ["keepScript", "helpers", 1_696]])
        expect(calls.filter(call => call[0] === "runKept").map(call => call.slice(2))).toEqual([0, 1, 2].map(index => ["helpers", `(${index})
;void 0`, "helpers.js"]))
        // a character outside the BMP is not cut in two
        const emoji = await openSandbox(engine)
        const odd = `${"a".repeat(24_575)}${String.fromCodePoint(0x1F600)}b`
        await emoji.loadKept("odd", odd, "", "odd.js")
        expect(calls.filter(call => call[0] === "keepScript" && call[1] === "odd").map(call => call[2])).toEqual([24_575, 3])
        await emoji.close()
        // the same key with other code is handed over again
        const sandbox = await openSandbox(engine)
        await sandbox.loadKept("helpers", "y", "()", "helpers.js")
        expect(calls.filter(call => call[0] === "keepScript")).toHaveLength(8)
        await sandbox.close()
    })
})

describe("kept scripts under Node", () => {
    it("runs the kept script with what follows, the same as one script", async () => {
        const sandbox = await openSandbox(nodeSandboxEngine)
        try {
            await sandbox.loadKept("kept-test", "globalThis.made = function (n) { return n * 2 }; made", "(21)", "kept.js")
            expect(await sandbox.call("made", 4)).toBe(8)
        }
        finally {
            await sandbox.close()
        }
    })
})
