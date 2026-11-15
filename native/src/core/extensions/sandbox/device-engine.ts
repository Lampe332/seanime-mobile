// geschrieben nach: Plan „Eigener Kern" Stufe 3a; Gegenstück zum eigenen Modul native/modules/core-sandbox (geteiltes C++ um quickjs-ng, über Nitro angebunden); keine Vorlage

/*
 * The sandbox engine on the device: the app's own native module, which runs every QuickJS engine on one thread of its
 * own. The module is handed in (the core imports nothing of the app); api/client/core-sandbox.ts does that.
 */

import { EngineFailure, type EngineBox, type SandboxEngine } from "./sandbox"

/** The code inside a sandbox asks the app: answered with the box's `answerHost(call, …)` */
export type SandboxHostCall = { call: number, name: string, payload: string }

/** One sandbox of the native module. All of its functions work off the thread that calls them. */
export type SandboxNativeBox = {
    run: (code: string, name: string) => Promise<string>
    /** Runs the script the module keeps under `key` (`keepScript`) with `after` appended */
    runKept: (key: string, after: string, name: string) => Promise<string>
    /** `body`: the long text of the answer beside the JSON `value` (sandbox.ts, HostReply), "" for none */
    answerHost: (call: number, ok: boolean, value: string, body: string) => Promise<void>
    close: () => Promise<void>
}

/** The functions of the native module (modules/core-sandbox, `CoreSandboxFactory`) */
export type SandboxNativeModule = {
    create: (
        memoryBytes: number,
        stackBytes: number,
        timeMs: number,
        onHostCall: (call: number, name: string, payload: string) => void,
    ) => Promise<SandboxNativeBox>
    nativeHeapBytes: () => Promise<number>
    /** Keeps a script under a key for every sandbox of the module, until the app ends */
    keepScript: (key: string, code: string, append: boolean) => Promise<void>
}

/** Characters of a kept script handed over at once (§4l): about 2 ms on the app's thread on the S22 */
export const KEEP_PART = 24 * 1024

/** The module rejects with a text that carries one of these codes (HybridCoreSandboxBox.hpp), wherever a layer between puts it */
const CODED = /(ERR_SANDBOX(?:_TIME|_CLOSED)?): ([\s\S]*)$/

function failureFrom(error: unknown): EngineFailure {
    const { message } = (error ?? {}) as { message?: unknown }
    const text = typeof message === "string" ? message : String(error)
    const coded = CODED.exec(text)
    if (!coded) return new EngineFailure("error", text)
    if (coded[1] === "ERR_SANDBOX_TIME") return new EngineFailure("time", coded[2])
    if (coded[1] === "ERR_SANDBOX_CLOSED") return new EngineFailure("closed", coded[2])
    return new EngineFailure("error", coded[2])
}

/**
 * `around` runs a piece of work that a question of the module started on the app's thread, so that the watch for that
 * thread (core/blocking.ts) sees it.
 */
export function deviceSandboxEngine(
    native: SandboxNativeModule,
    around: (work: () => Promise<void>, name: string) => Promise<void> = work => work(),
): SandboxEngine {
    return {
        open: async (limits, host): Promise<EngineBox> => {
            let closed = false
            // the box is there before its first run, so before the first question
            let box: SandboxNativeBox | undefined
            const onHostCall = (call: number, name: string, payload: string) => {
                void around(async () => {
                    // the box was closed while its question was on the way: nobody waits for the answer
                    if (closed || !box) return
                    let ok = true
                    let value: string
                    let body = ""
                    try {
                        const reply = await host(name, payload)
                        value = reply.json
                        body = reply.body ?? ""
                    }
                    catch (error) {
                        ok = false
                        value = error instanceof Error ? error.message : String(error)
                    }
                    if (closed) return
                    await box.answerHost(call, ok, value, body).catch(() => undefined)
                }, name)
            }
            try {
                box = await native.create(limits.memoryBytes, limits.stackBytes, limits.timeMs, onHostCall)
            }
            catch (error) {
                throw failureFrom(error)
            }
            const opened = box
            return {
                run: async (code, name) => {
                    try {
                        return await opened.run(code, name)
                    }
                    catch (error) {
                        throw failureFrom(error)
                    }
                },
                runKept: async (key, after, name) => {
                    try {
                        return await opened.runKept(key, after, name)
                    }
                    catch (error) {
                        throw failureFrom(error)
                    }
                },
                close: async () => {
                    closed = true
                    await opened.close()
                },
            }
        },
        keep: async (key, code) => {
            try {
                // in parts: handing a string over costs time on the app's thread in proportion to its length
                let start = 0
                do {
                    let end = Math.min(code.length, start + KEEP_PART)
                    // never between the two halves of a character outside the BMP
                    const last = code.charCodeAt(end - 1)
                    if (end < code.length && last >= 0xD800 && last <= 0xDBFF) end--
                    await native.keepScript(key, code.slice(start, end), start > 0)
                    start = end
                } while (start < code.length)
            }
            catch (error) {
                throw failureFrom(error)
            }
        },
        memoryInUse: () => native.nativeHeapBytes(),
    }
}
