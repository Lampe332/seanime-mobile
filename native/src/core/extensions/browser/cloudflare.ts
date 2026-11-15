// geschrieben nach: goja_plugin_types/core.d.ts (FetchOptions.noCloudflareBypass), öffentlicher Doku von Cloudflare (Challenge-Seiten: Kopfzeile cf-mitigated: challenge, Status 403/503, Titel „Just a moment...“, Challenge Passage / Cookie cf_clearance gebunden an den User-Agent) und docs/EIGENER-KERN.md §4k; keine Vorlage

/*
 * Cloudflare's check in front of a site (docs/EIGENER-KERN.md §4k). A site behind Cloudflare may answer a request with
 * a page that first proves a browser is asking. A browser passes the automatic kind without anyone doing anything; the
 * site then sets a cookie and lets requests with that cookie and the same User-Agent through for a while.
 *
 * What happens here is exactly that and nothing more: the app's hidden page opens the address and waits. If the check
 * passes on its own, the request is sent again. If it asks for a person (a box to tick, a puzzle), nothing is clicked
 * or solved: the request fails with `CloudflareError`, kind "needs-user".
 *
 * The cookie itself never passes through the core: the hidden page and the app's network share one cookie store, which
 * also drops the cookie when it runs out. The core remembers per host that the check was passed and with which
 * User-Agent, so later requests carry the same one and no page is opened again until the site asks again.
 */

import { type BrowserDesk, type BrowserDeskParts, type HiddenBrowser, BrowserError, createBrowserDesk } from "./browser"

/**
 * - needs-user: the check asks for a person, or did not pass on its own in time
 * - failed: the page of the check could not be opened
 */
export type CloudflareErrorKind = "needs-user" | "failed"

/** The start of the message the sandbox's fetch knows a check that needs the user by */
export const NEEDS_USER_MARK = "cloudflare needs the user: "

export class CloudflareError extends Error {
    readonly kind: CloudflareErrorKind

    constructor(kind: CloudflareErrorKind, message: string) {
        super(kind === "needs-user" ? NEEDS_USER_MARK + message : message)
        this.name = "CloudflareError"
        this.kind = kind
    }
}

export type CloudflareEvent = {
    host: string
    /** passed: the check went through on its own; refused: it did, and the site still answered the request with a check */
    outcome: "passed" | "needs-user" | "failed" | "refused"
    ms: number
    detail: string
}

export type CloudflarePass = {
    /** The User-Agent the check of this host was passed with, while that is remembered */
    agentFor: (host: string) => string | undefined
    /** Lets the hidden page pass the check at this address; gives the User-Agent it was passed with */
    pass: (url: string, userAgent?: string) => Promise<string>
    /** The site answered with a check again although it was passed: what is remembered of the host is dropped */
    refused: (host: string) => void
}

/** Longest time the hidden page gets for one check */
export const CLOUDFLARE_PASS_MS = 30_000
const LOOK_AGAIN_MS = 500

/** Whether an answer is Cloudflare's check instead of the site's own answer */
export function isCloudflareCheck(answer: { status: number, headers: [string, string][], body: string }): boolean {
    if (answer.status !== 403 && answer.status !== 503) return false
    const header = (name: string) => answer.headers.find(([key]) => key.toLowerCase() === name)?.[1] ?? ""
    if (/challenge/i.test(header("cf-mitigated"))) return true
    return /cloudflare/i.test(header("server")) && /<title>\s*Just a moment|_cf_chl_opt/i.test(answer.body)
}

export function hostOf(url: string): string {
    return url.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0].replace(/^[^@]*@/, "").toLowerCase()
}

/** Run in the page: is it still the check, of which kind, and who the browser says it is */
const PAGE_STATE = `(function () {
    var o = window._cf_chl_opt
    return {
        check: !!o || /^Just a moment/i.test(document.title || ""),
        type: o && o.cType ? String(o.cType) : "",
        loaded: document.readyState !== "loading",
        agent: navigator.userAgent
    }
})()`

type PageState = { check: boolean, type: string, loaded: boolean, agent: string }

export function createCloudflarePass(desk: BrowserDesk, parts: { now?: () => number, report?: (event: CloudflareEvent) => void, timeoutMs?: number } = {}): CloudflarePass {
    const now = parts.now ?? (() => Date.now())
    const timeoutMs = parts.timeoutMs ?? CLOUDFLARE_PASS_MS
    const agents = new Map<string, string>()
    /** Requests that meet the check of one host at the same time share one page */
    const running = new Map<string, Promise<string>>()

    async function open(url: string, userAgent: string | undefined): Promise<string> {
        const host = hostOf(url)
        const session = await desk.session({ timeoutMs, userAgent })
        let type = ""
        try {
            await session.navigate(url)
            for (;;) {
                let state: PageState | null = null
                try {
                    state = await session.evaluate(PAGE_STATE) as PageState
                }
                catch (error) {
                    // the check loads the real page when it is through: a question asked meanwhile gets no answer
                    if (error instanceof BrowserError) throw error
                }
                if (state) {
                    type = state.type
                    if (state.type === "interactive") throw new CloudflareError("needs-user", `the check at ${host} asks for a person`)
                    if (!state.check && state.loaded) return state.agent
                }
                await session.sleep(LOOK_AGAIN_MS)
            }
        }
        catch (error) {
            if (error instanceof CloudflareError) throw error
            if (error instanceof BrowserError && error.kind === "time") {
                throw new CloudflareError("needs-user", `the check at ${host} did not pass on its own within ${timeoutMs / 1000} s${type ? ` (kind "${type}")` : ""}; it asks for a person or refuses this device`)
            }
            throw new CloudflareError("failed", `the check at ${host} could not be opened: ${error instanceof Error ? error.message : String(error)}`)
        }
        finally {
            await session.close()
        }
    }

    return {
        agentFor: host => agents.get(host),
        pass: (url, userAgent) => {
            const host = hostOf(url)
            const already = running.get(host)
            if (already) return already
            const start = now()
            const say = (outcome: CloudflareEvent["outcome"], detail: string) => parts.report?.({ host, outcome, ms: now() - start, detail })
            const work = open(url, userAgent).then(
                agent => {
                    agents.set(host, agent)
                    say("passed", "the check passed on its own")
                    return agent
                },
                (error: unknown) => {
                    agents.delete(host)
                    const failure = error instanceof CloudflareError ? error : new CloudflareError("failed", String(error))
                    say(failure.kind, failure.message)
                    throw failure
                },
            ).finally(() => running.delete(host))
            running.set(host, work)
            return work
        },
        refused: host => {
            agents.delete(host)
            parts.report?.({ host, outcome: "refused", ms: 0, detail: "the check passed, the site still answered the request with a check" })
        },
    }
}

/** What an extension's sandbox gets of the app's hidden browser: the row for `ChromeDP` and the way past Cloudflare's check */
export type ExtensionBrowser = { desk: BrowserDesk, cloudflare: CloudflarePass }

/** One for the whole app: there is one hidden page and one cookie store */
export function createExtensionBrowser(browser: HiddenBrowser, parts: BrowserDeskParts & { now?: () => number, report?: (event: CloudflareEvent) => void, timeoutMs?: number } = {}): ExtensionBrowser {
    const desk = createBrowserDesk(browser, parts)
    return { desk, cloudflare: createCloudflarePass(desk, parts) }
}
