// geschrieben nach: goja_plugin_types/core.d.ts (ChromeDP, ChromeBrowser, ChromeBrowserOptions, NewChromeBrowserOptions) und docs/EIGENER-KERN.md §4k; keine Vorlage

/* global host */

/*
 * ChromeDP inside the sandbox. There is no browser in here: every step is a question to the app (`host.ask("browser")`),
 * which carries it out on its one hidden page (docs/EIGENER-KERN.md §4k). A browser holds that page from newBrowser to
 * close, or until its time runs out. What a hidden page without the DevTools protocol cannot do says so when called.
 */

function missing(what) {
    return new Error(`ChromeDP: ${what} is not available in this app (its hidden page has no screenshots and no DevTools protocol)`)
}

function browserOf(id) {
    const value = step => (...args) => host.ask("browser", { op: step, id, args })
    const done = step => async (...args) => {
        await host.ask("browser", { op: step, id, args })
    }
    return Object.freeze({
        navigate: done("navigate"),
        waitVisible: done("waitVisible"),
        waitReady: done("waitReady"),
        click: done("click"),
        sendKeys: done("sendKeys"),
        evaluate: value("evaluate"),
        innerHTML: value("innerHTML"),
        outerHTML: value("outerHTML"),
        text: value("text"),
        attribute: value("attribute"),
        sleep: done("sleep"),
        screenshot: () => Promise.reject(missing("screenshot")),
        fullScreenshot: () => Promise.reject(missing("fullScreenshot")),
        listenBrowser: () => {
            throw missing("listenBrowser")
        },
        listenTarget: () => {
            throw missing("listenTarget")
        },
        executeCDP: () => Promise.reject(missing("executeCDP")),
        close: done("close"),
    })
}

async function open(options) {
    const given = options ?? {}
    const { id } = await host.ask("browser", { op: "open", options: { timeout: given.timeout, userAgent: given.userAgent } })
    return browserOf(id)
}

/** The one-call forms: a browser of its own for one page, closed whatever happens */
async function visit(url, options, read) {
    const given = options ?? {}
    const browser = await open(given)
    try {
        await browser.navigate(url)
        if (given.waitSelector) await browser.waitVisible(given.waitSelector)
        if (given.waitDuration) await browser.sleep(given.waitDuration)
        return await read(browser)
    }
    finally {
        await browser.close()
    }
}

export class ChromeDP {
    static newBrowser(options) {
        return open(options)
    }

    static scrape(url, options) {
        return visit(url, options, browser => browser.outerHTML("html"))
    }

    static screenshot() {
        return Promise.reject(missing("screenshot"))
    }

    static evaluate(url, jsCode, options) {
        return visit(url, options, browser => browser.evaluate(jsCode))
    }
}

Object.freeze(ChromeDP)
