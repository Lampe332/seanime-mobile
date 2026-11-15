// geschrieben nach: goja_plugin_types/core.d.ts (LoadDoc, Doc, $goFeed: wann das zweite Skript läuft; fetch, FetchOptions mit noCloudflareBypass, FetchResponse, $getUserPreference, __isOffline__, ChromeDP, ChromeBrowser), WHATWG Fetch Standard und MDN zu AbortController; keine Vorlage

/*
 * A sandbox for an extension with the light helpers of the contract in it (docs/EIGENER-KERN.md §4i): the helper script
 * (bundle.generated.ts, built from prelude/) runs first, then the extension's code. What the helpers cannot do inside,
 * the app answers through the door: the network (`fetch`), the log (`log`) and the hidden browser (`browser`, §4k).
 */

import { DOC_HELPERS_SCRIPT, HELPERS_SCRIPT } from "./bundle.generated"
import { type BrowserSession, DEFAULT_BROWSER_TIMEOUT_MS } from "../browser/browser"
import { type ExtensionBrowser, CloudflareError, hostOf, isCloudflareCheck } from "../browser/cloudflare"
import { AnswerWithBody, type HostFunctions, type Sandbox, type SandboxEngine, type SandboxLimits, openSandbox } from "../sandbox/sandbox"

/** The app's network, as the global fetch of the app or of Node */
export type HelperFetch = (url: string, init: {
    method: string
    headers: Record<string, string>
    body?: string | Uint8Array
    redirect: "follow" | "manual" | "error"
    signal: AbortSignal
}) => Promise<{
    status: number
    statusText: string
    url: string
    redirected: boolean
    headers: { forEach: (callback: (value: string, name: string) => void) => void }
    text: () => Promise<string>
}>

export type HelperLogLevel = "log" | "info" | "warn" | "error" | "debug"

export type ExtensionSandboxOptions = {
    limits?: Partial<SandboxLimits>
    fetch: HelperFetch
    /**
     * The app's hidden browser, where there is one (the device): `ChromeDP` and the way past Cloudflare's automatic check
     * (docs/EIGENER-KERN.md §4k). Without it `ChromeDP` fails with "not available here" and a check is answered as it came.
     */
    browser?: ExtensionBrowser
    /** Where console.* of the extension goes */
    log?: (level: HelperLogLevel, text: string) => void
    /** The extension's settings as the user set them (defaults filled in); `$getUserPreference` reads them */
    preferences?: Record<string, string>
    /** `__isOffline__` */
    offline?: boolean
    /** A clock in milliseconds, for how long the helpers took to load */
    now?: () => number
}

export type ExtensionSandbox = Sandbox & {
    /** How long the helper script took to run in this sandbox, in milliseconds */
    helpersMs: number
    /** How long the second script (LoadDoc, Doc, $goFeed) took, once code that names them was loaded; else undefined */
    docHelpersMs: () => number | undefined
}

/**
 * Code that names one of these needs the second helper script. It is about as large as all light helpers together,
 * so it runs only then, right before that code (docs/EIGENER-KERN.md §4j).
 */
export const NAMES_OF_DOC_HELPERS = /\b(?:LoadDoc|Doc)\b|\$goFeed\b/

/** What the sandbox's fetch sends through the door */
type FetchQuestion = {
    url: string
    method: string
    headers: Record<string, string>
    body?: string
    bodyBase64?: string
    redirect: "follow" | "manual" | "error"
    timeoutMs: number
    noCloudflareBypass?: boolean
}

/** And what it gets back */
export type FetchAnswer = {
    status: number
    statusText: string
    url: string
    redirected: boolean
    headers: [string, string][]
    body: string
}

const LEVELS: HelperLogLevel[] = ["log", "info", "warn", "error", "debug"]

function bytesOfBase64(text: string): Uint8Array {
    return Uint8Array.from(atob(text), character => character.charCodeAt(0))
}

/**
 * The host function `fetch`: one request through the app's network, the answer read in full. Where the app has a hidden
 * browser and the answer is Cloudflare's check, the check is passed there once and the request sent again with the same
 * User-Agent (cloudflare.ts), unless the extension said `noCloudflareBypass`.
 */
export function fetchThroughApp(fetcher: HelperFetch, browser?: ExtensionBrowser): (payload: unknown) => Promise<FetchAnswer> {
    return async payload => {
        const question = payload as FetchQuestion
        const url = String(question.url)
        if (!/^https?:\/\//i.test(url)) throw new Error(`fetch: only http and https are allowed, not ${url.slice(0, 40)}`)
        const host = hostOf(url)
        const named = Object.keys(question.headers).find(name => name.toLowerCase() === "user-agent")

        async function send(agent: string | undefined): Promise<FetchAnswer> {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), question.timeoutMs)
            try {
                const response = await fetcher(url, {
                    method: question.method,
                    // the cookie of a passed check holds for the User-Agent it was passed with
                    headers: agent !== undefined && named === undefined ? { ...question.headers, "User-Agent": agent } : question.headers,
                    body: question.bodyBase64 !== undefined ? bytesOfBase64(question.bodyBase64) : question.body,
                    redirect: question.redirect,
                    signal: controller.signal,
                })
                const headers: [string, string][] = []
                response.headers.forEach((value, name) => headers.push([name, value]))
                const body = await response.text()
                return { status: response.status, statusText: response.statusText, url: response.url, redirected: response.redirected, headers, body }
            }
            catch (error) {
                if (controller.signal.aborted) throw new Error(`fetch: no answer from ${host} within ${question.timeoutMs / 1000} s`)
                throw new Error(`fetch: ${error instanceof Error ? error.message : String(error)}`)
            }
            finally {
                clearTimeout(timer)
            }
        }

        const answer = await send(browser?.cloudflare.agentFor(host))
        if (!browser || question.noCloudflareBypass === true || !isCloudflareCheck(answer)) return answer
        // once per request: the hidden page passes the check, or says why it cannot
        let agent: string
        try {
            agent = await browser.cloudflare.pass(url, named === undefined ? undefined : question.headers[named])
        }
        catch (error) {
            throw error instanceof CloudflareError ? new Error(`fetch: ${error.message}`) : error
        }
        const again = await send(agent)
        if (isCloudflareCheck(again)) browser.cloudflare.refused(host)
        return again
    }
}

const BROWSER_STEPS = ["navigate", "waitVisible", "waitReady", "click", "sendKeys", "evaluate", "innerHTML", "outerHTML", "text", "attribute", "sleep"] as const

/** The host function `browser`: what `ChromeDP` inside the sandbox asks of the app's hidden page */
function browserThroughApp(browser: ExtensionBrowser | undefined): { ask: (payload: unknown) => Promise<unknown>, closeAll: () => Promise<void> } {
    const sessions = new Map<number, BrowserSession>()
    let count = 0
    return {
        ask: async payload => {
            if (!browser) throw new Error("ChromeDP is not available here")
            const question = payload as { op?: unknown, id?: unknown, args?: unknown, options?: { timeout?: unknown, userAgent?: unknown } }
            if (question.op === "open") {
                const seconds = Number(question.options?.timeout)
                const session = await browser.desk.session({
                    timeoutMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_BROWSER_TIMEOUT_MS,
                    userAgent: typeof question.options?.userAgent === "string" && question.options.userAgent ? question.options.userAgent : undefined,
                })
                sessions.set(++count, session)
                return { id: count }
            }
            const id = Number(question.id)
            const session = sessions.get(id)
            if (!session) throw new Error("ChromeDP: this browser is closed")
            if (question.op === "close") {
                sessions.delete(id)
                await session.close()
                return null
            }
            const step = BROWSER_STEPS.find(name => name === question.op)
            if (!step) throw new Error(`ChromeDP: no step "${String(question.op)}"`)
            const args = Array.isArray(question.args) ? question.args : []
            const answer = await (session[step] as (...values: unknown[]) => Promise<unknown>)(...args)
            return answer === undefined ? null : answer
        },
        closeAll: async () => {
            const open = [...sessions.values()]
            sessions.clear()
            await Promise.all(open.map(session => session.close().catch(() => undefined)))
        },
    }
}

export async function openExtensionSandbox(engine: SandboxEngine, options: ExtensionSandboxOptions): Promise<ExtensionSandbox> {
    const now = options.now ?? (() => performance.now())
    const pages = browserThroughApp(options.browser)
    const fetching = fetchThroughApp(options.fetch, options.browser)
    const host: HostFunctions = {
        // the page crosses beside the JSON of the rest (sandbox.ts, HostReply)
        fetch: async payload => {
            const { body, ...rest } = await fetching(payload)
            return new AnswerWithBody(rest, body)
        },
        browser: pages.ask,
        log: payload => {
            const { level, text } = payload as { level: HelperLogLevel, text: string }
            options.log?.(LEVELS.includes(level) ? level : "log", String(text))
            return null
        },
    }
    const opened = await openSandbox(engine, { limits: options.limits, host })
    // a page the extension left open goes with its sandbox
    const sandbox: Sandbox = { ...opened, close: async () => {
        await pages.closeAll()
        await opened.close()
    } }
    const start = now()
    try {
        await sandbox.loadKept("helpers", HELPERS_SCRIPT, `(${JSON.stringify({ preferences: options.preferences ?? {}, offline: options.offline ?? false })})`, "helpers.js")
    }
    catch (error) {
        await sandbox.close().catch(() => undefined)
        throw error
    }
    const helpersMs = now() - start
    let docHelpersMs: number | undefined
    return {
        ...sandbox,
        helpersMs,
        docHelpersMs: () => docHelpersMs,
        load: async (code, name) => {
            if (docHelpersMs === undefined && NAMES_OF_DOC_HELPERS.test(code)) {
                const docStart = now()
                await sandbox.loadKept("doc-helpers", DOC_HELPERS_SCRIPT, "({})", "doc-helpers.js")
                docHelpersMs = now() - docStart
            }
            await sandbox.load(code, name)
        },
    }
}
