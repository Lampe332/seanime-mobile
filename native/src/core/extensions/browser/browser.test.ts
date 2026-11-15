// geschrieben nach: goja_plugin_types/core.d.ts (ChromeDP, ChromeBrowser, FetchOptions.noCloudflareBypass) und docs/EIGENER-KERN.md §4k; eigene Prüf-Seite statt eines Browsers, kein Netz

import { describe, expect, it } from "vitest"
import { type HelperFetch, openExtensionSandbox } from "../helpers/helpers"
import { nodeSandboxEngine } from "../sandbox/node-engine"
import { type HiddenBrowser, BrowserError, createBrowserDesk } from "./browser"
import { type CloudflareEvent, createExtensionBrowser, isCloudflareCheck } from "./cloudflare"

type TestElement = { innerHTML: string, outerHTML: string, textContent: string, attributes: Record<string, string>, value?: string, visible: boolean, clicks: number, events: string[] }

function element(text: string, more: Partial<TestElement> = {}): TestElement {
    return { innerHTML: text, outerHTML: `<p>${text}</p>`, textContent: text, attributes: {}, visible: true, clicks: 0, events: [], ...more }
}

/** What a page is for these tests: a title, some elements by selector, and what Cloudflare's check leaves in a page */
type TestWorld = {
    title: string
    elements: Record<string, TestElement>
    check?: { type: string }
    agent: string
}

/**
 * A hidden browser without a browser: pages are `TestWorld`s by address, and JavaScript for the page runs here against
 * a document that knows just what the core's steps use.
 */
function testBrowser(worlds: Record<string, () => TestWorld>, defaultAgent = "TestBrowser/1") {
    const log: string[] = []
    const evaluated: string[] = []
    let open = 0
    let most = 0
    const browser: HiddenBrowser = {
        open: async ({ userAgent }) => {
            open++
            most = Math.max(most, open)
            log.push(`open ${userAgent ?? "-"}`)
            let world: TestWorld | null = null
            return {
                navigate: async url => {
                    log.push(`navigate ${url}`)
                    if (!Object.hasOwn(worlds, url)) throw new Error("net::ERR_NAME_NOT_RESOLVED")
                    world = worlds[url]()
                    world.agent = userAgent ?? defaultAgent
                },
                evaluate: async code => {
                    evaluated.push(code)
                    if (!world) throw new Error("no page")
                    const page = world
                    const wrap = (found: TestElement) => ({
                        get innerHTML() { return found.innerHTML },
                        get outerHTML() { return found.outerHTML },
                        get textContent() { return found.textContent },
                        get value() { return found.value },
                        set value(value: string | undefined) { found.value = value },
                        getAttribute: (name: string) => (Object.hasOwn(found.attributes, name) ? found.attributes[name] : null),
                        getClientRects: () => (found.visible ? [{}] : []),
                        click: () => { found.clicks++ },
                        focus: () => { found.events.push("focus") },
                        dispatchEvent: (event: { type: string }) => { found.events.push(event.type) },
                    })
                    const document = {
                        get title() { return page.title },
                        readyState: "complete",
                        querySelector: (selector: string) => (Object.hasOwn(page.elements, selector) ? wrap(page.elements[selector]) : null),
                    }
                    const window = { _cf_chl_opt: page.check ? { cType: page.check.type } : undefined }
                    class Event { constructor(readonly type: string) {} }
                    const run = new Function("document", "window", "navigator", "getComputedStyle", "Event", `return (${code})`) as (...parts: unknown[]) => unknown
                    return await run(document, window, { userAgent: page.agent }, () => ({ visibility: "visible", display: "block" }), Event)
                },
                close: async () => {
                    open--
                    log.push("close")
                },
            }
        },
    }
    return { browser, log, evaluated, most: () => most, opened: () => log.filter(line => line.startsWith("open")).length, openNow: () => open }
}

const PAGE = "https://site.test/page"

describe("the row for the hidden page", () => {
    it("carries the steps of the contract out on the page", async () => {
        const world: TestWorld = { title: "T", agent: "", elements: { "h1": element("Hello", { attributes: { id: "top" } }), "input": element("", { value: "ab" }), "#hidden": element("x", { visible: false }) } }
        const test = testBrowser({ [PAGE]: () => world })
        const session = await createBrowserDesk(test.browser).session()
        await session.navigate(PAGE)
        await session.waitVisible("h1")
        expect(await session.text("h1")).toBe("Hello")
        expect(await session.innerHTML("h1")).toBe("Hello")
        expect(await session.outerHTML("h1")).toBe("<p>Hello</p>")
        expect(await session.attribute("h1", "id")).toBe("top")
        expect(await session.attribute("h1", "nothing")).toBeNull()
        expect(await session.evaluate("document.title + 1")).toBe("T1")
        await session.click("h1")
        expect(world.elements.h1.clicks).toBe(1)
        await session.sendKeys("input", "cd")
        expect(world.elements.input.value).toBe("abcd")
        expect(world.elements.input.events).toEqual(["focus", "input", "change"])
        // an element that comes later is waited for
        setTimeout(() => { world.elements["#late"] = element("late") }, 150)
        expect(await session.text("#late")).toBe("late")
        await session.close()
        expect(test.openNow()).toBe(0)
        await expect(session.text("h1")).rejects.toMatchObject({ kind: "closed" })
    })

    it("sends a page to http and https only", async () => {
        const test = testBrowser({})
        const session = await createBrowserDesk(test.browser).session()
        for (const url of ["file:///data/x", "javascript:alert(1)", "content://x", "about:blank", "intent://x"]) {
            await expect(session.navigate(url)).rejects.toMatchObject({ kind: "address" })
        }
        await session.close()
        expect(test.log).toEqual(["open -", "close"])
    })

    it("lets one use the page at a time, in the order they asked", async () => {
        const test = testBrowser({ [PAGE]: () => ({ title: "T", agent: "", elements: {} }) })
        const desk = createBrowserDesk(test.browser)
        const order: string[] = []
        const use = async (name: string) => {
            const session = await desk.session({ userAgent: name })
            order.push(`${name} in`)
            await session.navigate(PAGE)
            await session.sleep(30)
            order.push(`${name} out`)
            await session.close()
        }
        await Promise.all([use("a"), use("b"), use("c")])
        expect(order).toEqual(["a in", "a out", "b in", "b out", "c in", "c out"])
        expect(test.most()).toBe(1)
        expect(test.log.filter(line => line.startsWith("open"))).toEqual(["open a", "open b", "open c"])
    })

    it("ends a use when its time runs out, throws the page away and gives it to the next", async () => {
        const test = testBrowser({ [PAGE]: () => ({ title: "T", agent: "", elements: { h1: element("Hello") } }) })
        const desk = createBrowserDesk(test.browser)
        const first = await desk.session({ timeoutMs: 120 })
        await first.navigate(PAGE)
        const next = desk.session()
        const waited = await first.waitReady("#never").then(() => "found", (error: unknown) => error)
        expect(waited).toBeInstanceOf(BrowserError)
        expect(waited).toMatchObject({ kind: "time" })
        await expect(first.text("h1")).rejects.toMatchObject({ kind: "time" })
        const second = await next
        await second.navigate(PAGE)
        expect(await second.text("h1")).toBe("Hello")
        await second.close()
        expect(test.openNow()).toBe(0)
        expect(test.most()).toBe(1)
    })
})

const CHECK_BODY = "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>"

describe("telling Cloudflare's check from a site's own answer", () => {
    const answer = (status: number, headers: [string, string][], body: string) => ({ status, headers, body })

    it("knows the check by its header or by its page", () => {
        expect(isCloudflareCheck(answer(403, [["cf-mitigated", "challenge"]], ""))).toBe(true)
        expect(isCloudflareCheck(answer(403, [["Server", "cloudflare"]], CHECK_BODY))).toBe(true)
        expect(isCloudflareCheck(answer(503, [["server", "cloudflare"]], "<script>window._cf_chl_opt = {}</script>"))).toBe(true)
    })

    it("leaves every other answer alone", () => {
        expect(isCloudflareCheck(answer(200, [["server", "cloudflare"]], CHECK_BODY))).toBe(false)
        expect(isCloudflareCheck(answer(403, [["server", "cloudflare"]], "<title>Forbidden</title>"))).toBe(false)
        expect(isCloudflareCheck(answer(403, [["server", "nginx"]], CHECK_BODY))).toBe(false)
        expect(isCloudflareCheck(answer(404, [["cf-mitigated", "challenge"]], ""))).toBe(false)
    })
})

/**
 * A site behind the check: it answers 403 with the check until the cookie store holds its cookie and the request comes
 * with the User-Agent the check was passed with. The cookie store is shared by the page and the network, as on the device.
 */
function checkedSite(options: { type?: string, passes?: boolean, honours?: boolean } = {}) {
    const store = { cookieFor: "" }
    const sent: { url: string, agent: string }[] = []
    const fetch: HelperFetch = async (url, init) => {
        const agent = Object.entries(init.headers).find(([name]) => name.toLowerCase() === "user-agent")?.[1] ?? ""
        sent.push({ url, agent })
        const through = options.honours !== false && store.cookieFor !== "" && store.cookieFor === agent
        return {
            status: through ? 200 : 403,
            statusText: through ? "OK" : "Forbidden",
            url,
            redirected: false,
            headers: new Headers(through ? { "Content-Type": "text/html" } : { "Server": "cloudflare", "cf-mitigated": "challenge" }),
            text: async () => (through ? "<p>the site</p>" : CHECK_BODY),
        }
    }
    const world = (): TestWorld => {
        let looks = 0
        let through = false
        const page: TestWorld = { title: "", agent: "", elements: {} }
        // the check runs by itself: the page is asked how it stands, and after some looks it is through
        Object.defineProperty(page, "check", {
            get: () => {
                if (options.passes !== false && ++looks > 4 && !through) {
                    through = true
                    store.cookieFor = page.agent
                }
                return through ? undefined : { type: options.type ?? "managed" }
            },
        })
        Object.defineProperty(page, "title", { get: () => (through ? "The site" : "Just a moment...") })
        return page
    }
    return { fetch, sent, world }
}

const SITE = "https://checked.test/search?q=x"

const CODE = `
async function get(url, options) {
    try { const r = await fetch(url, options); return { status: r.status, text: r.text() } }
    catch (error) { return { name: error.name, needsUser: error.needsUser === true, message: error.message } }
}
async function both(url) { return (await Promise.all([get(url), get(url)])).map(function (r) { return r.status }) }
async function steer(url) {
    const browser = await ChromeDP.newBrowser({ timeout: 5, userAgent: "Own/1" })
    try {
        await browser.navigate(url)
        await browser.sleep(20)
        return { title: await browser.evaluate("document.title"), agent: await browser.evaluate("navigator.userAgent"), text: await browser.text("h1") }
    }
    finally { await browser.close() }
}
async function oneCall(url) { return { html: await ChromeDP.scrape(url, { waitSelector: "h1", waitDuration: 10 }), value: await ChromeDP.evaluate(url, "1 + 1") } }
async function missing(url) {
    const said = []
    const browser = await ChromeDP.newBrowser()
    for (const step of [function () { return browser.screenshot("h1") }, function () { return browser.fullScreenshot() }, function () { return browser.executeCDP("Page.enable") }, function () { return ChromeDP.screenshot(url) }, async function () { browser.listenBrowser(function () {}) }, async function () { browser.listenTarget(function () {}) }]) {
        try { await step(); said.push("done") } catch (error) { said.push(/not available in this app/.test(error.message) ? "refused" : error.message) }
    }
    await browser.close()
    return said
}
async function leftOpen(url) { const browser = await ChromeDP.newBrowser({ timeout: 60 }); await browser.navigate(url); return "left" }
async function noBrowser() { try { await ChromeDP.newBrowser(); return "opened" } catch (error) { return error.message } }
`

async function sandboxWith(site: ReturnType<typeof checkedSite>, test: ReturnType<typeof testBrowser> | null, timeoutMs?: number) {
    const events: CloudflareEvent[] = []
    const sandbox = await openExtensionSandbox(nodeSandboxEngine, {
        fetch: site.fetch,
        browser: test ? createExtensionBrowser(test.browser, { report: event => events.push(event), timeoutMs }) : undefined,
    })
    await sandbox.load(CODE, "test.js")
    return { sandbox, events }
}

describe("fetch of an extension meeting Cloudflare's check", () => {
    it("lets the hidden page pass the automatic check, sends the request again with the page's User-Agent and remembers the host", async () => {
        const site = checkedSite()
        const test = testBrowser({ [SITE]: site.world })
        const { sandbox, events } = await sandboxWith(site, test)
        expect(await sandbox.call("get", SITE)).toEqual({ status: 200, text: "<p>the site</p>" })
        expect(site.sent).toEqual([{ url: SITE, agent: "" }, { url: SITE, agent: "TestBrowser/1" }])
        expect(events.map(event => event.outcome)).toEqual(["passed"])
        expect(test.openNow()).toBe(0)
        // the next request to the host carries the same User-Agent at once: no check, no page
        expect(await sandbox.call("get", "https://checked.test/other")).toMatchObject({ status: 200 })
        expect(site.sent[2]).toEqual({ url: "https://checked.test/other", agent: "TestBrowser/1" })
        expect(test.opened()).toBe(1)
        // nothing was clicked or typed in the page of the check
        expect(test.evaluated.some(code => /click|sendKeys|dispatchEvent|focus/.test(code))).toBe(false)
        await sandbox.close()
    })

    it("passes the check with the User-Agent the extension names", async () => {
        const site = checkedSite()
        const test = testBrowser({ [SITE]: site.world })
        const { sandbox } = await sandboxWith(site, test)
        expect(await sandbox.call("get", SITE, { headers: { "user-agent": "Extension/2" } })).toMatchObject({ status: 200 })
        expect(test.log[0]).toBe("open Extension/2")
        await sandbox.close()
    })

    it("opens one page for requests that meet the check together", async () => {
        const site = checkedSite()
        const test = testBrowser({ [SITE]: site.world })
        const { sandbox } = await sandboxWith(site, test)
        expect(await sandbox.call("both", SITE)).toEqual([200, 200])
        expect(test.opened()).toBe(1)
        await sandbox.close()
    })

    it("leaves the check alone when the extension says noCloudflareBypass", async () => {
        const site = checkedSite()
        const test = testBrowser({ [SITE]: site.world })
        const { sandbox, events } = await sandboxWith(site, test)
        expect(await sandbox.call("get", SITE, { noCloudflareBypass: true })).toEqual({ status: 403, text: CHECK_BODY })
        expect(test.opened()).toBe(0)
        expect(events).toEqual([])
        await sandbox.close()
    })

    it("fails with an error of its own when the check asks for a person, and touches nothing", async () => {
        const site = checkedSite({ type: "interactive", passes: false })
        const test = testBrowser({ [SITE]: site.world })
        const { sandbox, events } = await sandboxWith(site, test)
        const said = await sandbox.call<{ name: string, needsUser: boolean, message: string }>("get", SITE)
        expect(said.name).toBe("CloudflareCheckError")
        expect(said.needsUser).toBe(true)
        expect(said.message).toMatch(/needs the user: the check at checked\.test asks for a person/)
        expect(events.map(event => event.outcome)).toEqual(["needs-user"])
        expect(site.sent.length).toBe(1)
        expect(test.evaluated.some(code => /click|sendKeys|dispatchEvent|focus/.test(code))).toBe(false)
        expect(test.openNow()).toBe(0)
        await sandbox.close()
    })

    it("fails the same way when the check does not pass on its own in time", async () => {
        const site = checkedSite({ passes: false })
        const test = testBrowser({ [SITE]: site.world })
        const { sandbox, events } = await sandboxWith(site, test, 700)
        const said = await sandbox.call<{ name: string, needsUser: boolean, message: string }>("get", SITE)
        expect(said).toMatchObject({ name: "CloudflareCheckError", needsUser: true })
        expect(said.message).toMatch(/did not pass on its own within 0\.7 s \(kind "managed"\)/)
        expect(events.map(event => event.outcome)).toEqual(["needs-user"])
        expect(test.openNow()).toBe(0)
        await sandbox.close()
    })

    it("tries once per request: a site that still answers with the check gets its answer handed on", async () => {
        const site = checkedSite({ honours: false })
        const test = testBrowser({ [SITE]: site.world })
        const { sandbox, events } = await sandboxWith(site, test)
        expect(await sandbox.call("get", SITE)).toEqual({ status: 403, text: CHECK_BODY })
        expect(site.sent.length).toBe(2)
        expect(test.opened()).toBe(1)
        expect(events.map(event => event.outcome)).toEqual(["passed", "refused"])
        // nothing is remembered of a host that refused: the next request starts plain
        await sandbox.call("get", SITE)
        expect(site.sent[2].agent).toBe("")
        await sandbox.close()
    })

    it("says so when the page of the check cannot be opened", async () => {
        const site = checkedSite()
        const test = testBrowser({})
        const { sandbox, events } = await sandboxWith(site, test)
        const said = await sandbox.call<{ name: string, needsUser: boolean, message: string }>("get", SITE)
        expect(said.needsUser).toBe(false)
        expect(said.message).toMatch(/the check at checked\.test could not be opened: net::ERR_NAME_NOT_RESOLVED/)
        expect(events.map(event => event.outcome)).toEqual(["failed"])
        await sandbox.close()
    })

    it("hands the check on as it came where there is no hidden browser", async () => {
        const site = checkedSite()
        const { sandbox } = await sandboxWith(site, null)
        expect(await sandbox.call("get", SITE)).toEqual({ status: 403, text: CHECK_BODY })
        await sandbox.close()
    })
})

describe("ChromeDP of an extension", () => {
    const pages = { [PAGE]: (): TestWorld => ({ title: "Page", agent: "", elements: { h1: element("Hello"), html: element("", { outerHTML: "<html><h1>Hello</h1></html>" }) } }) }

    it("steers the hidden page: its own User-Agent, steps, close", async () => {
        const test = testBrowser(pages)
        const { sandbox } = await sandboxWith(checkedSite(), test)
        expect(await sandbox.call("steer", PAGE)).toEqual({ title: "Page", agent: "Own/1", text: "Hello" })
        expect(test.log).toEqual(["open Own/1", `navigate ${PAGE}`, "close"])
        await sandbox.close()
    })

    it("has the one-call forms scrape and evaluate, each with a page of its own", async () => {
        const test = testBrowser(pages)
        const { sandbox } = await sandboxWith(checkedSite(), test)
        expect(await sandbox.call("oneCall", PAGE)).toEqual({ html: "<html><h1>Hello</h1></html>", value: 2 })
        expect(test.opened()).toBe(2)
        expect(test.openNow()).toBe(0)
        await sandbox.close()
    })

    it("says what a hidden page cannot do instead of pretending", async () => {
        const test = testBrowser(pages)
        const { sandbox } = await sandboxWith(checkedSite(), test)
        expect(await sandbox.call("missing", PAGE)).toEqual(["refused", "refused", "refused", "refused", "refused", "refused"])
        await sandbox.close()
    })

    it("closes a page the extension left open when its sandbox closes", async () => {
        const test = testBrowser(pages)
        const { sandbox } = await sandboxWith(checkedSite(), test)
        expect(await sandbox.call("leftOpen", PAGE)).toBe("left")
        expect(test.openNow()).toBe(1)
        await sandbox.close()
        expect(test.openNow()).toBe(0)
    })

    it("is not available where the app has no hidden browser", async () => {
        const { sandbox } = await sandboxWith(checkedSite(), null)
        expect(await sandbox.call("noBrowser")).toMatch(/ChromeDP is not available here/)
        await sandbox.close()
    })
})
