// geschrieben nach: goja_plugin_types/core.d.ts (ChromeDP, ChromeBrowser, ChromeBrowserOptions: was ein ferngesteuerter Browser zusagt), DOM Standard (querySelector, getClientRects, Ereignisse input/change) und docs/EIGENER-KERN.md §4k; keine Vorlage

/*
 * A browser an extension steers from afar (`ChromeDP` of the contract), carried by one hidden page the app lends the
 * core (docs/EIGENER-KERN.md §4k). The core knows no screen: the app hands in a `HiddenBrowser` that can do three
 * things (load an address, run JavaScript in the page, throw the page away), and everything the contract promises is
 * built from them here.
 *
 * There is one page at a time. Who wants one waits in a row; every use has a time limit, after which the page is
 * thrown away and the next in the row gets a new one.
 */

/** One page of the app's hidden browser */
export type HiddenPage = {
    /** Loads an address. Resolves once the page has loaded, whatever its HTTP status; rejects when it cannot be reached. */
    navigate: (url: string) => Promise<void>
    /** Runs JavaScript in the page and gives its value as JSON, a promise waited for. Rejects with what the code threw. */
    evaluate: (code: string) => Promise<unknown>
    /** Throws the page away with everything in it */
    close: () => Promise<void>
}

/** What the app hands in: its hidden browser. A page is opened only after the one before was closed. */
export type HiddenBrowser = {
    open: (options: { userAgent?: string }) => Promise<HiddenPage>
}

/**
 * Why a use of the browser ended:
 * - time: its time limit ran out, the page is gone
 * - closed: it was closed
 * - address: not an address a page may be sent to
 */
export type BrowserErrorKind = "time" | "closed" | "address"

export class BrowserError extends Error {
    readonly kind: BrowserErrorKind

    constructor(kind: BrowserErrorKind, message: string) {
        super(message)
        this.name = "BrowserError"
        this.kind = kind
    }
}

export type BrowserSessionOptions = {
    /** Longest time from getting the page to closing it, in milliseconds; 30 s when not given */
    timeoutMs?: number
    userAgent?: string
}

/** One use of the page, from getting it to `close` */
export type BrowserSession = {
    navigate: (url: string) => Promise<void>
    waitVisible: (selector: string) => Promise<void>
    waitReady: (selector: string) => Promise<void>
    click: (selector: string) => Promise<void>
    sendKeys: (selector: string, keys: string) => Promise<void>
    evaluate: (code: string) => Promise<unknown>
    innerHTML: (selector: string) => Promise<string>
    outerHTML: (selector: string) => Promise<string>
    text: (selector: string) => Promise<string>
    attribute: (selector: string, name: string) => Promise<string | null>
    sleep: (milliseconds: number) => Promise<void>
    close: () => Promise<void>
}

export type BrowserDesk = {
    /** Waits for the page to be free, then opens a use of it */
    session: (options?: BrowserSessionOptions) => Promise<BrowserSession>
}

export const DEFAULT_BROWSER_TIMEOUT_MS = 30_000
/** How often a wait for an element looks again */
const LOOK_AGAIN_MS = 100

const find = (selector: string) => `document.querySelector(${JSON.stringify(String(selector))})`

export type BrowserDeskParts = {
    /** Waits that long, in milliseconds. On the device the watch of the app's thread wraps it (core/blocking.ts). */
    wait?: (milliseconds: number) => Promise<void>
}

export function createBrowserDesk(browser: HiddenBrowser, parts: BrowserDeskParts = {}): BrowserDesk {
    const wait = parts.wait ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)))
    /** Settles when the use before has given the page back */
    let row: Promise<void> = Promise.resolve()

    return {
        session: async (options = {}) => {
            const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_BROWSER_TIMEOUT_MS
            const before = row
            let giveBack: () => void = () => undefined
            row = new Promise<void>(resolve => {
                giveBack = resolve
            })
            await before

            let page: HiddenPage
            try {
                page = await browser.open({ userAgent: options.userAgent })
            }
            catch (error) {
                giveBack()
                throw error
            }

            let ended: BrowserError | null = null
            let stop: (error: BrowserError) => void = () => undefined
            const end = new Promise<never>((_, reject) => {
                stop = reject
            })
            // nobody may be waiting on it when the use ends
            end.catch(() => undefined)

            async function finish(error: BrowserError) {
                if (ended) return
                ended = error
                clearTimeout(timer)
                stop(error)
                try {
                    await page.close()
                }
                catch {
                    // a page that will not close is gone for the core all the same
                }
                finally {
                    giveBack()
                }
            }

            const timer = setTimeout(() => void finish(new BrowserError("time", `the browser's time of ${timeoutMs / 1000} s ran out`)), timeoutMs)

            /** Every step ends with the use: at the time limit and at close */
            function during<Result>(work: () => Promise<Result>): Promise<Result> {
                if (ended) return Promise.reject(ended)
                return Promise.race([work(), end])
            }

            const evaluate = (code: string) => during(() => page.evaluate(code))

            async function until(code: string) {
                while (await evaluate(code) !== true) await during(() => wait(LOOK_AGAIN_MS))
            }

            const waitReady = (selector: string) => until(`${find(selector)} !== null`)

            /** Waits for the element as the contract's selector steps do, then runs `code` with it as `e` */
            async function withElement(selector: string, code: string): Promise<unknown> {
                await waitReady(selector)
                return evaluate(`(function () { var e = ${find(selector)}; if (!e) throw new Error("the element is gone"); ${code} })()`)
            }

            return {
                navigate: async url => {
                    if (!/^https?:\/\//i.test(String(url))) throw new BrowserError("address", `only http and https are allowed, not ${String(url).slice(0, 40)}`)
                    await during(() => page.navigate(String(url)))
                },
                waitReady,
                waitVisible: selector => until(`(function () { var e = ${find(selector)}; if (!e) return false; var s = getComputedStyle(e); return e.getClientRects().length > 0 && s.visibility !== "hidden" && s.display !== "none" })()`),
                click: async selector => {
                    await withElement(selector, "e.click(); return true")
                },
                sendKeys: async (selector, keys) => {
                    // the value goes in through the element's own setter, so pages that watch the property see it
                    await withElement(selector, `e.focus(); var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), "value"); var v = String(e.value === undefined ? "" : e.value) + ${JSON.stringify(String(keys))}; if (d && d.set) d.set.call(e, v); else e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true`)
                },
                evaluate: code => evaluate(String(code)),
                innerHTML: async selector => String(await withElement(selector, "return e.innerHTML")),
                outerHTML: async selector => String(await withElement(selector, "return e.outerHTML")),
                text: async selector => String(await withElement(selector, "return e.textContent")),
                attribute: async (selector, name) => {
                    const value = await withElement(selector, `return e.getAttribute(${JSON.stringify(String(name))})`)
                    return value === null || value === undefined ? null : String(value)
                },
                sleep: milliseconds => during(() => wait(Math.max(0, Number(milliseconds) || 0))),
                close: () => finish(new BrowserError("closed", "the browser is closed")),
            }
        },
    }
}
