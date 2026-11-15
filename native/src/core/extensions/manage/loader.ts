// geschrieben nach: den Vertrags-Dateien der Erweiterungs-Arten (anime-torrent-provider.d.ts, onlinestream-provider.d.ts, manga-provider.d.ts, custom-source.d.ts: `class Provider` mit `getSettings()`), docs/EIGENER-KERN.md §4h–§4l und der öffentlichen Doku von Sucrase; kein Server-Quelltext

import type { ExtensionManifest } from "../fetch-manifest"
import { type ExtensionSandbox, openExtensionSandbox } from "../helpers/helpers"
import { SandboxError, type SandboxLimits } from "../sandbox/sandbox"
import type { ExtensionPlace } from "./installed"
import { TRANSPILER_SCRIPT } from "./transpiler.generated"

/*
 * One sandbox per extension, opened when it is first needed and closed after it was not used for a while. Loading:
 * the light helpers (kept in the engine, §4l), then for TypeScript the transpiler (kept as well), which takes the types
 * out inside the sandbox, never on the app's thread; then the extension's code, and `new Provider()` as the contract
 * files declare it. A sandbox that ran out of time or memory, or broke, is closed; the next use opens a new one.
 */

/**
 * Memory one extension's sandbox may hold. 64 MB were not enough for one catalogue answer of a few MB in phase 3d
 * (the text, its parsed form and the extension's own copies at once); 256 MB leave room for four times that and are
 * only a ceiling: QuickJS takes what it uses, and an idle sandbox is closed.
 */
export const DEFAULT_EXTENSION_MEMORY_MB = 256
/** A sandbox nobody used for this long is closed */
export const DEFAULT_EXTENSION_IDLE_SECONDS = 120

export type LoaderSettings = { memoryMb: number, idleSeconds: number }

/** The name of the provider object inside the sandbox; calls go to `__extension.<method>` */
export const PROVIDER = "__extension"

type Timers = {
    set: (work: () => void, milliseconds: number) => unknown
    clear: (handle: unknown) => void
}

const REAL_TIMERS: Timers = {
    set: (work, milliseconds) => setTimeout(work, milliseconds),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

type Open = {
    payload: string
    preferences: string
    sandbox: Promise<ExtensionSandbox>
    idle: unknown
    busy: number
}

/** The script that loads an extension's code into its sandbox, after the helpers (and the transpiler for TypeScript) */
export function loadScriptOf(manifest: ExtensionManifest): string {
    const create = `\n;globalThis.${PROVIDER} = new Provider();`
    if (manifest.language !== "typescript") return `${manifest.payload}${create}`
    // indirect eval: the code runs in the global scope; its classes stay inside the eval, so the provider is made there
    return `(0, eval)(globalThis.__seanimeTranspile(${JSON.stringify(manifest.payload)}) + ${JSON.stringify(create)});\ndelete globalThis.__seanimeTranspile;`
}

export class ExtensionLoader {
    private readonly open = new Map<string, Open>()

    constructor(
        private readonly place: ExtensionPlace,
        private readonly settings: () => Promise<LoaderSettings>,
        private readonly timers: Timers = REAL_TIMERS,
    ) {}

    /** How many sandboxes are open now */
    get openCount(): number {
        return this.open.size
    }

    /**
     * Runs `work` with the extension's sandbox, opened if needed. `preferences` are the user's settings with defaults
     * filled in; a sandbox opened with other ones is opened again.
     */
    async use<T>(manifest: ExtensionManifest, preferences: Record<string, string>, work: (sandbox: ExtensionSandbox) => Promise<T>): Promise<T> {
        const wanted = JSON.stringify(preferences)
        let entry = this.open.get(manifest.id)
        if (entry && (entry.payload !== manifest.payload || entry.preferences !== wanted)) {
            await this.close(manifest.id)
            entry = undefined
        }
        if (!entry) {
            entry = { payload: manifest.payload, preferences: wanted, sandbox: this.start(manifest, preferences), idle: undefined, busy: 0 }
            this.open.set(manifest.id, entry)
        }
        const current = entry
        this.timers.clear(current.idle)
        current.busy++
        try {
            // a sandbox another request is opening: waiting for it is a wait for the watch
            return await work(await (this.place.join ? this.place.join(current.sandbox) : current.sandbox))
        }
        catch (error) {
            // a limit or a broken engine: this sandbox is not used again
            const failedToOpen = await current.sandbox.then(() => false, () => true)
            const broken = failedToOpen || !(error instanceof SandboxError) || error.kind !== "thrown"
            if (broken && this.open.get(manifest.id) === current) await this.close(manifest.id)
            throw error
        }
        finally {
            current.busy--
            if (current.busy === 0 && this.open.get(manifest.id) === current) {
                const { idleSeconds } = await this.settings()
                current.idle = this.timers.set(() => {
                    if (current.busy === 0 && this.open.get(manifest.id) === current) void this.close(manifest.id)
                }, idleSeconds * 1000)
            }
        }
    }

    /** Calls a method of the extension's provider */
    call<T>(manifest: ExtensionManifest, preferences: Record<string, string>, method: string, ...args: unknown[]): Promise<T> {
        return this.use(manifest, preferences, sandbox => sandbox.call<T>(`${PROVIDER}.${method}`, ...args))
    }

    async close(id: string): Promise<void> {
        const entry = this.open.get(id)
        if (!entry) return
        this.open.delete(id)
        this.timers.clear(entry.idle)
        // a sandbox still being opened is waited for like any other (3f-2: unseen, this wait kept the piece open 1150 ms)
        const settled = entry.sandbox.catch(() => null)
        const sandbox = await (this.place.join ? this.place.join(settled) : settled)
        await sandbox?.close().catch(() => undefined)
    }

    async closeAll(): Promise<void> {
        await Promise.all([...this.open.keys()].map(id => this.close(id)))
    }

    private async start(manifest: ExtensionManifest, preferences: Record<string, string>): Promise<ExtensionSandbox> {
        const { memoryMb } = await this.settings()
        const limits: Partial<SandboxLimits> = { memoryBytes: memoryMb * 1024 * 1024 }
        const engine = await this.place.engine()
        const sandbox = await openExtensionSandbox(engine, {
            limits,
            fetch: this.place.fetch,
            browser: this.place.browser,
            preferences,
            log: (level, text) => this.place.log?.(manifest.id, level, text),
        })
        try {
            if (manifest.language === "typescript") await sandbox.loadKept("transpiler", TRANSPILER_SCRIPT, "", "transpiler.js")
            await sandbox.load(loadScriptOf(manifest), `${manifest.id}.js`)
            return sandbox
        }
        catch (error) {
            await sandbox.close().catch(() => undefined)
            throw error
        }
    }
}
