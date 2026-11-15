// geschrieben nach: Plan „Eigener Kern" Stufe 3a, dem Vertrag src/core/extensions/sandbox/sandbox.ts und der öffentlichen Doku von Nitro Modules (HybridObject, Promise, Callback); keine Vorlage
import type { HybridObject } from "react-native-nitro-modules"

/**
 * One sandbox: a QuickJS engine of its own on one thread of its own. Every method only hands work to that thread.
 * A failure rejects with a text that starts with `ERR_SANDBOX_TIME: `, `ERR_SANDBOX_CLOSED: ` or `ERR_SANDBOX: `.
 */
export interface CoreSandboxBox extends HybridObject<{ ios: "c++", android: "c++" }> {
    /** Runs a script in the global scope; a promise it ends in is waited for. The result when that is a string, else "". */
    run(code: string, name: string): Promise<string>
    /** Runs the script kept under `key` (`CoreSandboxFactory.keepScript`) with `after` appended, like `run` */
    runKept(key: string, after: string, name: string): Promise<string>
    /**
     * The app's answer to a question the code inside asked (`onHostCall`). `body` is the long text of the answer (a
     * page), handed beside the JSON `value` so it is not wrapped into JSON on the app's thread; "" for none. With a
     * body the code inside gets `[value, body]`, else `value`.
     */
    answerHost(call: number, ok: boolean, value: string, body: string): Promise<void>
    /** Stops running code and frees the engine */
    close(): Promise<void>
}

export interface CoreSandboxFactory extends HybridObject<{ ios: "c++", android: "c++" }> {
    /**
     * A new sandbox with its limits. `onHostCall` is called for every `__host(name, payload)` of the code inside and is
     * answered with `answerHost(call, …)`.
     */
    create(
        memoryBytes: number,
        stackBytes: number,
        timeMs: number,
        onHostCall: (call: number, name: string, payload: string) => void,
    ): Promise<CoreSandboxBox>
    /** Memory the process holds outside of JavaScript's own, in bytes (0 where the platform cannot tell) */
    nativeHeapBytes(): Promise<number>
    /**
     * Keeps a script under a key for every sandbox, until the app ends (the helpers for extensions, about 100 KB): it
     * crosses from JavaScript once, later sandboxes only name the key (docs/EIGENER-KERN.md §4l). `append`: the text is
     * the next part of the script under `key` (a large script is handed over in parts, each a short piece of work).
     */
    keepScript(key: string, code: string, append: boolean): Promise<void>
}
