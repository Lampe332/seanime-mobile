// geschrieben nach: docs/EIGENER-KERN.md §4k; eigene Prüfungen, kein Browser

import { describe, expect, it } from "vitest"
import { type PageAnswer, evaluateScript, pageAnswer } from "./page-script"

/** Runs a script as a page would, with the bridge of a WebView; `evalAllowed: false` is a page whose policy forbids eval */
async function inPage(script: string, evalAllowed = true): Promise<PageAnswer | null> {
    const posted: string[] = []
    const window = { ReactNativeWebView: { postMessage: (data: string) => posted.push(data) } }
    const refuse = () => {
        throw new EvalError("Refused to evaluate a string as JavaScript")
    }
    const run = new Function("window", "eval", "pageValue", script) as (...parts: unknown[]) => unknown
    run(window, evalAllowed ? eval : refuse, 7)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(posted.length).toBe(1)
    return pageAnswer(posted[0])
}

describe("asking the hidden page for a value", () => {
    it("gives the value of an expression, of statements and of a promise", async () => {
        expect(await inPage(evaluateScript("a", "1 + 2", false))).toEqual({ id: "a", ok: true, value: 3 })
        expect(await inPage(evaluateScript("b", "var x = 2; x * 21", false))).toEqual({ id: "b", ok: true, value: 42 })
        expect(await inPage(evaluateScript("c", "new Promise(function (done) { setTimeout(function () { done({ a: [1] }) }, 5) })", false))).toEqual({ id: "c", ok: true, value: { a: [1] } })
        expect(await inPage(evaluateScript("d", "undefined", false))).toEqual({ id: "d", ok: true, value: null })
    })

    it("gives what the code threw, a rejected promise and a syntax error as errors", async () => {
        expect(await inPage(evaluateScript("a", "(function () { throw new TypeError('no') })()", false))).toEqual({ id: "a", ok: false, error: "TypeError: no" })
        expect(await inPage(evaluateScript("b", "Promise.reject(new Error('later'))", false))).toEqual({ id: "b", ok: false, error: "Error: later" })
        expect(await inPage(evaluateScript("c", "1 +", false))).toMatchObject({ id: "c", ok: false, error: expect.stringMatching(/^SyntaxError/) })
        expect(await inPage(evaluateScript("d", "var a = []; a.push(a); a", false))).toEqual({ id: "d", ok: false, error: "the value cannot be sent as JSON" })
    })

    it("says so when the page forbids eval, and works as an expression then", async () => {
        expect(await inPage(evaluateScript("a", "pageValue + 1", false), false)).toEqual({ id: "a", ok: false, blocked: true })
        expect(await inPage(evaluateScript("a", "pageValue + 1", true), false)).toEqual({ id: "a", ok: true, value: 8 })
    })

    it("takes nothing for an answer that is not one", () => {
        for (const data of [undefined, 5, "", "not json", "null", "[]", "{\"ok\":true}", "{\"id\":1,\"ok\":true}", "{\"id\":\"a\"}"]) expect(pageAnswer(data)).toBeNull()
        expect(pageAnswer("{\"id\":\"a\",\"ok\":false}")).toEqual({ id: "a", ok: false, error: "the page gave no reason" })
    })
})
