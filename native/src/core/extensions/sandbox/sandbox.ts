// geschrieben nach: Plan „Eigener Kern" Stufe 3a und docs/EIGENER-KERN.md §8 (Probe 2: Grenzen 64 MB / 512 KB / 60 s, eine Tür zum Wirt); öffentliche Doku von QuickJS und quickjs-kt; keine Vorlage

/*
 * The sandbox an extension (a source) runs in: a JavaScript engine of its own (QuickJS), with hard limits, that reaches
 * nothing of the app or the device. The one door to the outside is `__host(name, payloadJson)`: the code inside asks,
 * the app answers. Everything an extension may use later (fetch and the other helpers of the contract, phase 3b) is
 * built on that door.
 *
 * Two things carry the same contract (`SandboxEngine`): the native module on the device (device-engine.ts) and QuickJS
 * as WebAssembly under Node, for the tests (node-engine.ts). What both have in common lives here: how a function is
 * called with JSON, how host functions are found, and which kind an error is.
 */

export type SandboxLimits = {
    /** Memory the engine may hold, in bytes */
    memoryBytes: number
    /** Depth of its stack, in bytes */
    stackBytes: number
    /** Longest time of one load or call, in milliseconds, the waiting for the host included */
    timeMs: number
}

/** The limits of trial 2 (docs/EIGENER-KERN.md §8) */
export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = { memoryBytes: 64 * 1024 * 1024, stackBytes: 512 * 1024, timeMs: 60_000 }

/**
 * What went wrong in a sandbox:
 * - thrown: the code inside threw (or what it returned is not JSON)
 * - time: a load or call ran longer than allowed and was stopped
 * - memory: the engine hit its memory limit; the sandbox is closed after it
 * - stack: the code went deeper than the stack allows
 * - closed: the sandbox is closed
 */
export type SandboxErrorKind = "thrown" | "time" | "memory" | "stack" | "closed"

export class SandboxError extends Error {
    readonly kind: SandboxErrorKind

    constructor(kind: SandboxErrorKind, message: string) {
        super(message)
        this.name = "SandboxError"
        this.kind = kind
    }
}

/** How an engine reports a failure: what it knows itself (stopped for time, closed), else the engine's own text */
export class EngineFailure extends Error {
    readonly code: "time" | "closed" | "error"

    constructor(code: "time" | "closed" | "error", message: string) {
        super(message)
        this.name = "EngineFailure"
        this.code = code
    }
}

/**
 * What the app answers through the door: JSON, and beside it the long text of the answer (a page fetch read), which
 * crosses as it is. Wrapping a page of megabytes into JSON held the app's thread for its whole length (3g,
 * docs/EIGENER-KERN.md §4m); handed beside the JSON it is copied once, and read inside as `body` of the value.
 */
export type HostReply = { json: string, body?: string }

/** The door as an engine sees it: a name and JSON in, JSON out. A rejection reaches the code inside as an Error. */
export type EngineHost = (name: string, payloadJson: string) => Promise<HostReply>

/** A host function's answer whose `body` (a long text) crosses beside the JSON of `value` */
export class AnswerWithBody {
    constructor(readonly value: Record<string, unknown>, readonly body: string) {}
}

export type EngineBox = {
    /**
     * Runs a script in the box's global scope. A promise it ends in is waited for. Gives the result when that is a
     * string, else "". Fails with an EngineFailure.
     */
    run: (code: string, name: string) => Promise<string>
    /**
     * Runs the script the engine keeps under `key` (`SandboxEngine.keep`) with `after` appended, as one script. Only the
     * key and `after` cross to the engine, not the kept script again (docs/EIGENER-KERN.md §4l).
     */
    runKept?: (key: string, after: string, name: string) => Promise<string>
    /** Frees the engine. Running code is stopped. */
    close: () => Promise<void>
}

export type SandboxEngine = {
    /** A new engine of its own: nothing inside but the language itself and `__host` */
    open: (limits: SandboxLimits, host: EngineHost) => Promise<EngineBox>
    /** Keeps a script under a key for every box of this engine, once; a second call with the same key replaces it */
    keep?: (key: string, code: string) => Promise<void>
    /** Memory all engines hold outside of JavaScript's own, in bytes, where the platform can tell */
    memoryInUse?: () => Promise<number>
}

/** What the app offers the code inside: found by name, payload and answer are JSON values */
export type HostFunctions = Record<string, (payload: unknown) => unknown>

export type Sandbox = {
    /** Runs a script (an extension's code): what it declares stays for later calls */
    load: (code: string, name?: string) => Promise<void>
    /**
     * Like `load(code + after)`, for a large script that every sandbox runs (the helpers): the engine is given `code`
     * once per key and keeps it, every sandbox after that only names the key. Engines that cannot keep get the whole.
     */
    loadKept: (key: string, code: string, after: string, name?: string) => Promise<void>
    /**
     * Calls a function the loaded code declared, named by a path such as `search` or `provider.search`. Arguments go in
     * and the result comes out as JSON; a promise is waited for.
     */
    call: <Result = unknown>(path: string, ...args: unknown[]) => Promise<Result>
    close: () => Promise<void>
}

/**
 * Inside the sandbox: `host.ask(name, payload)` on top of the raw door, with JSON done. An answer with a body arrives as
 * `[json, body]` (HostReply): the body becomes the value's `body`.
 */
const PRELUDE = `
globalThis.host = Object.freeze({
    ask: async function (name, payload) {
        const answer = await __host(String(name), JSON.stringify(payload === undefined ? null : payload))
        if (typeof answer === "string") return JSON.parse(answer)
        const value = JSON.parse(answer[0])
        value.body = answer[1]
        return value
    },
})
`

/** What each engine was given to keep, per key: the same text is not handed over a second time */
const keptByEngine = new WeakMap<SandboxEngine, Map<string, { code: string, kept: Promise<void> }>>()

function keepOnce(engine: SandboxEngine, keep: NonNullable<SandboxEngine["keep"]>, key: string, code: string): Promise<void> {
    let keys = keptByEngine.get(engine)
    if (!keys) keptByEngine.set(engine, keys = new Map())
    const known = keys.get(key)
    if (known && known.code === code) return known.kept
    const kept = keep(key, code)
    keys.set(key, { code, kept })
    // a failed hand-over is tried again by the next sandbox
    kept.catch(() => keys.delete(key))
    return kept
}

const PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/

/** Which kind an engine's failure is. QuickJS names its limits in the text of the error it throws. */
export function sandboxErrorFrom(error: unknown): SandboxError {
    if (error instanceof SandboxError) return error
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof EngineFailure ? error.code : "error"
    if (code === "time" || /InternalError: interrupted/.test(message)) return new SandboxError("time", message)
    if (code === "closed") return new SandboxError("closed", message)
    if (/out of memory/i.test(message)) return new SandboxError("memory", message)
    if (/stack overflow|maximum call stack size exceeded/i.test(message)) return new SandboxError("stack", message)
    return new SandboxError("thrown", message)
}

export async function openSandbox(
    engine: SandboxEngine,
    options: { limits?: Partial<SandboxLimits>, host?: HostFunctions } = {},
): Promise<Sandbox> {
    const limits = { ...DEFAULT_SANDBOX_LIMITS, ...options.limits }
    const functions = options.host ?? {}
    let closed = false

    const host: EngineHost = async (name, payloadJson) => {
        if (!Object.hasOwn(functions, name)) throw new Error(`the app offers no "${name}"`)
        const answer = await functions[name](JSON.parse(payloadJson))
        if (answer instanceof AnswerWithBody) return { json: JSON.stringify(answer.value), body: answer.body }
        return { json: JSON.stringify(answer === undefined ? null : answer) }
    }

    let box: EngineBox
    try {
        box = await engine.open(limits, host)
    }
    catch (error) {
        throw sandboxErrorFrom(error)
    }

    async function close() {
        if (closed) return
        closed = true
        await box.close()
    }

    async function run(code: string, name: string, keptKey?: string): Promise<string> {
        if (closed) throw new SandboxError("closed", "the sandbox is closed")
        try {
            return keptKey !== undefined && box.runKept ? await box.runKept(keptKey, code, name) : await box.run(code, name)
        }
        catch (error) {
            const failure = closed ? new SandboxError("closed", "the sandbox is closed") : sandboxErrorFrom(error)
            // an engine that ran out of memory cannot be trusted to go on
            if (failure.kind === "memory") await close().catch(() => undefined)
            throw failure
        }
    }

    try {
        await run(PRELUDE, "prelude.js")
    }
    catch (error) {
        await close().catch(() => undefined)
        throw error
    }

    return {
        load: async (code, name = "extension.js") => {
            // the value a script ends in is of no use and need not be one the engine can hand out
            await run(`${code}\n;void 0`, name)
        },
        loadKept: async (key, code, after, name = "kept.js") => {
            const { keep } = engine
            if (!keep || !box.runKept) {
                await run(`${code}${after}\n;void 0`, name)
                return
            }
            try {
                await keepOnce(engine, keep, key, code)
            }
            catch (error) {
                throw sandboxErrorFrom(error)
            }
            await run(`${after}\n;void 0`, name, key)
        },
        call: async <Result>(path: string, ...args: unknown[]) => {
            if (!PATH.test(path)) throw new SandboxError("thrown", `not a function's name: ${path}`)
            const owner = path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : "undefined"
            const script = `(async () => {
    const result = await (${path}).apply(${owner}, JSON.parse(${JSON.stringify(JSON.stringify(args))}))
    const json = JSON.stringify(result)
    return json === undefined ? "null" : json
})()`
            const json = await run(script, "call.js")
            try {
                return JSON.parse(json) as Result
            }
            catch {
                throw new SandboxError("thrown", `${path} returned nothing that is JSON`)
            }
        },
        close,
    }
}
