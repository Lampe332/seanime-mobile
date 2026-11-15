// geschrieben nach: öffentlicher Doku von quickjs-emscripten 0.32 (README: Runtime, Context, Limits, Promises) und der eigenen Probe native/scripts/probe-quickjs.mjs; keine Vorlage

/*
 * The sandbox engine under Node: QuickJS compiled to WebAssembly. For the logic tests and the scripts only, never part
 * of the app (Hermes runs no WebAssembly, and core.test.ts checks that nothing of the core imports this file).
 */

import { type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, getQuickJS } from "quickjs-emscripten"
import { EngineFailure, type EngineBox, type EngineHost, type SandboxEngine, type SandboxLimits } from "./sandbox"

function textOf(context: QuickJSContext, error: QuickJSHandle): string {
    const value: unknown = context.dump(error)
    if (value && typeof value === "object") {
        const { name, message } = value as { name?: unknown, message?: unknown }
        return `${typeof name === "string" ? name : "Error"}: ${typeof message === "string" ? message : JSON.stringify(value)}`
    }
    // out of memory can leave QuickJS without the memory for an error object
    return value === null || value === undefined ? "InternalError: out of memory" : String(value)
}

/** Scripts kept once per engine (`keep`), run by key in every box: the same as the device module's store (§4l) */
const kept = new Map<string, string>()

async function open(limits: SandboxLimits, host: EngineHost): Promise<EngineBox> {
    const QuickJS = await getQuickJS()
    const runtime: QuickJSRuntime = QuickJS.newRuntime()
    runtime.setMemoryLimit(limits.memoryBytes)
    runtime.setMaxStackSize(limits.stackBytes)
    let deadline = Infinity
    runtime.setInterruptHandler(() => Date.now() > deadline)
    const context = runtime.newContext()
    let closed = false
    /** Ends the run that is waiting, when the engine fails outside of it (in a step that follows an answer of the host) */
    let breakRun: ((failure: EngineFailure) => void) | null = null
    /** One run at a time, as on the device */
    let line: Promise<unknown> = Promise.resolve()

    /** Runs what became ready: the steps after an `await` inside */
    function pump() {
        if (closed) return
        const jobs = runtime.executePendingJobs()
        if (jobs.error) {
            const text = textOf(context, jobs.error)
            jobs.error.dispose()
            breakRun?.(new EngineFailure("error", text))
        }
    }

    const door = context.newFunction("__host", (nameHandle, payloadHandle) => {
        const name = context.getString(nameHandle)
        const payload = context.getString(payloadHandle)
        const deferred = context.newPromise()
        host(name, payload).then(
            answer => {
                if (closed) return
                // like the module (SandboxCore.cpp): a body crosses as [json, body]
                let handle = context.newString(answer.json)
                if (answer.body) {
                    const pair = context.newArray()
                    const body = context.newString(answer.body)
                    context.setProp(pair, 0, handle)
                    context.setProp(pair, 1, body)
                    handle.dispose()
                    body.dispose()
                    handle = pair
                }
                deferred.resolve(handle)
                handle.dispose()
            },
            (error: unknown) => {
                if (closed) return
                const handle = context.newError(error instanceof Error ? error.message : String(error))
                deferred.reject(handle)
                handle.dispose()
            },
        ).finally(() => {
            if (closed) return
            deferred.dispose()
            pump()
        })
        return deferred.handle
    })
    context.setProp(context.global, "__host", door)
    door.dispose()

    async function runNow(code: string, name: string): Promise<string> {
        if (closed) throw new EngineFailure("closed", "the sandbox is closed")
        deadline = Date.now() + limits.timeMs
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            const evaluated = context.evalCode(code, name)
            if (evaluated.error) {
                const text = textOf(context, evaluated.error)
                evaluated.error.dispose()
                throw new EngineFailure("error", text)
            }
            const settled = context.resolvePromise(evaluated.value)
            evaluated.value.dispose()
            const stopped = new Promise<never>((_, reject) => {
                breakRun = reject
                timer = setTimeout(() => reject(new EngineFailure("time", `stopped after ${limits.timeMs} ms`)), limits.timeMs)
            })
            pump()
            const outcome = await Promise.race([settled, stopped])
            if (closed) throw new EngineFailure("closed", "the sandbox is closed")
            if (outcome.error) {
                const text = textOf(context, outcome.error)
                outcome.error.dispose()
                throw new EngineFailure("error", text)
            }
            const result = context.typeof(outcome.value) === "string" ? context.getString(outcome.value) : ""
            outcome.value.dispose()
            return result
        }
        finally {
            clearTimeout(timer)
            breakRun = null
            deadline = Infinity
        }
    }

    const run = (code: string, name: string) => {
        const result = line.then(() => runNow(code, name))
        line = result.catch(() => undefined)
        return result
    }

    return {
        run,
        runKept: (key, after, name) => {
            const script = kept.get(key)
            if (script === undefined) return Promise.reject(new EngineFailure("error", `no script is kept under "${key}"`))
            return run(script + after, name)
        },
        close: async () => {
            if (closed) return
            closed = true
            breakRun?.(new EngineFailure("closed", "the sandbox is closed"))
            // a run that was stopped can leave values behind which QuickJS reports when it is freed; the memory of the
            // WebAssembly module is given back either way
            try {
                context.dispose()
                runtime.dispose()
            }
            catch {
                // nothing to do: the engine is gone
            }
        },
    }
}

export const nodeSandboxEngine: SandboxEngine = {
    open,
    keep: async (key, code) => {
        kept.set(key, code)
    },
}
