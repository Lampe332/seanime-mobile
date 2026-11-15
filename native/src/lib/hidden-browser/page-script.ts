// geschrieben nach: docs/EIGENER-KERN.md §4k und öffentlicher Doku von react-native-webview 14 (injectJavaScript, window.ReactNativeWebView.postMessage, onMessage) und MDN (indirektes eval, EvalError bei Content-Security-Policy); keine Vorlage

/*
 * How the hidden page (hidden-browser.tsx) is asked for the value of JavaScript. A WebView runs a script the app
 * injects but hands nothing back; the script therefore posts its value to the app as a message with the question's id.
 *
 * The code is run as a program first (an indirect eval: statements work, the value is that of the last one). A page
 * whose Content-Security-Policy forbids eval answers "blocked"; the app then asks again with the code written into the
 * script as an expression.
 */

export type PageAnswer =
    | { id: string, ok: true, value: unknown }
    | { id: string, ok: false, error: string }
    | { id: string, ok: false, blocked: true }

/** The script that runs `code` in the page and posts its value (a promise waited for) under `id` */
export function evaluateScript(id: string, code: string, asExpression: boolean): string {
    const run = asExpression ? `(function () { return (\n${code}\n) })()` : `(0, eval)(${JSON.stringify(code)})`
    return `(function () {
    var id = ${JSON.stringify(id)}
    function post(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)) }
    function done(value) {
        try { post({ id: id, ok: true, value: value === undefined ? null : value }) }
        catch (error) { post({ id: id, ok: false, error: "the value cannot be sent as JSON" }) }
    }
    function fail(error) {
        post({ id: id, ok: false, error: error && error.message !== undefined ? (error.name ? error.name + ": " : "") + error.message : String(error) })
    }
    var value
    try { value = ${run} }
    catch (error) {
        if (${asExpression ? "false" : "true"} && error instanceof EvalError) { post({ id: id, ok: false, blocked: true }); return }
        fail(error)
        return
    }
    Promise.resolve(value).then(done, fail)
})(); true;`
}

/** A message of the page, if it is an answer; pages may post anything */
export function pageAnswer(data: unknown): PageAnswer | null {
    if (typeof data !== "string") return null
    let message: unknown
    try {
        message = JSON.parse(data)
    }
    catch {
        return null
    }
    if (typeof message !== "object" || message === null) return null
    const { id, ok, value, error, blocked } = message as Record<string, unknown>
    if (typeof id !== "string") return null
    if (ok === true) return { id, ok: true, value: value === undefined ? null : value }
    if (ok !== false) return null
    return blocked === true ? { id, ok: false, blocked: true } : { id, ok: false, error: typeof error === "string" ? error : "the page gave no reason" }
}
