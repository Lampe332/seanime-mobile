// geschrieben nach: goja_plugin_types/core.d.ts (Zusagen der Globalen für Erweiterungen); Prüfwerte aus RFC 1321 (MD5), FIPS 180-4 (SHA), RFC 4231 (HMAC), FIPS-197 Anhang C.1 (AES-128), RFC 4648 (Base64); keine Vorlage

import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { nodeSandboxEngine } from "../sandbox/node-engine"
import { SandboxError } from "../sandbox/sandbox"
import { type ExtensionSandbox, type HelperFetch, type HelperLogLevel, openExtensionSandbox } from "./helpers"

type Sent = { url: string, method: string, headers: Record<string, string>, body?: string | Uint8Array, redirect: string }

/** A local answer instead of the network: what was asked is kept, the answer is built from it */
function testFetch(sent: Sent[]): HelperFetch {
    return async (url, init) => {
        sent.push({ url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect })
        if (url.includes("/never")) {
            return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))
        }
        if (url.includes("/broken")) throw new Error("connection refused")
        const headers = new Headers([["Content-Type", "application/json; charset=utf-8"], ["X-Thing", "a"]])
        headers.append("Set-Cookie", "session=abc123; Path=/; HttpOnly")
        headers.append("Set-Cookie", "theme=dark")
        const status = url.includes("/missing") ? 404 : 200
        return {
            status,
            statusText: status === 200 ? "OK" : "Not Found",
            url: url.includes("/moved") ? "https://example.test/landed" : url,
            redirected: url.includes("/moved"),
            headers,
            text: async () => JSON.stringify({ hello: "wörld", method: init.method }),
        }
    }
}

const CODE = `
async function get(url, options) {
    const r = await fetch(url, options)
    return {
        status: r.status, statusText: r.statusText, ok: r.ok, url: r.url, method: r.method, redirected: r.redirected,
        contentType: r.contentType, contentLength: r.contentLength, cookies: r.cookies,
        header: r.headers["Content-Type"], lower: r.headers["content-type"], viaGet: r.headers.get("x-thing"),
        raw: r.rawHeaders["set-cookie"], text: r.text(), json: r.json(), awaited: (await r.json()).hello,
    }
}
async function failing(url, options) { try { await fetch(url, options); return "resolved" } catch (error) { return "rejected: " + error.message } }
function run(source) { return (0, eval)(source) }
async function runAsync(source) { return await (0, eval)(source) }
`

async function open(options: { sent?: Sent[], logs?: [HelperLogLevel, string][], preferences?: Record<string, string>, timeMs?: number } = {}): Promise<ExtensionSandbox> {
    const sandbox = await openExtensionSandbox(nodeSandboxEngine, {
        fetch: testFetch(options.sent ?? []),
        log: (level, text) => options.logs?.push([level, text]),
        preferences: options.preferences,
        limits: options.timeMs ? { timeMs: options.timeMs } : undefined,
    })
    await sandbox.load(CODE, "test.js")
    return sandbox
}

async function evaluate(source: string, sandbox?: ExtensionSandbox): Promise<unknown> {
    const box = sandbox ?? await open()
    try {
        return await box.call("runAsync", source)
    }
    finally {
        if (!sandbox) await box.close()
    }
}

describe("the helper bundle", () => {
    it("is the one the sources and pinned libraries give", async () => {
        const script = path.resolve(__dirname, "../../../../scripts/bundle-extension-helpers.mjs")
        const { buildHelpersFile, GENERATED } = await import(/* @vite-ignore */ script) as { buildHelpersFile: () => Promise<string>, GENERATED: string }
        expect(readFileSync(GENERATED, "utf8")).toBe(await buildHelpersFile())
    })
})

describe("fetch", () => {
    it("sends method, headers and a JSON body through the app and gives the answer as the contract says", async () => {
        const sent: Sent[] = []
        const sandbox = await open({ sent })
        const answer = await sandbox.call<Record<string, unknown>>("get", "https://example.test/api", { method: "post", headers: { "X-Key": "1" }, body: { a: 1 } })
        await sandbox.close()
        expect(sent[0]).toMatchObject({ url: "https://example.test/api", method: "POST", redirect: "follow", body: `{"a":1}` })
        expect(sent[0].headers).toEqual({ "X-Key": "1", "Content-Type": "application/json" })
        expect(answer).toMatchObject({
            status: 200, statusText: "OK", ok: true, url: "https://example.test/api", method: "POST", redirected: false,
            contentType: "application/json; charset=utf-8", contentLength: 34,
            header: "application/json; charset=utf-8", lower: "application/json; charset=utf-8", viaGet: "a",
            cookies: { session: "abc123", theme: "dark" }, raw: ["session=abc123; Path=/; HttpOnly", "theme=dark"],
            text: `{"hello":"wörld","method":"POST"}`, json: { hello: "wörld", method: "POST" }, awaited: "wörld",
        })
    })

    it("sends URLSearchParams, FormData, text and bytes as a browser would", async () => {
        const sent: Sent[] = []
        const sandbox = await open({ sent })
        await sandbox.call("runAsync", `(async () => {
            await fetch("https://example.test/a", { method: "POST", body: new URLSearchParams({ q: "dr. stone", page: "2" }) })
            const form = new FormData(); form.append("do", "search"); form.append("story", "ü")
            await fetch("https://example.test/b", { method: "POST", body: form, headers: { "content-type": "wrong" } })
            await fetch("https://example.test/c", { method: "PUT", body: "plain", redirect: "manual" })
            await fetch(new URL("https://example.test/d"), { method: "POST", body: new Uint8Array([0, 255, 1]) })
        })()`)
        await sandbox.close()
        expect(sent[0].body).toBe("q=dr.+stone&page=2")
        expect(sent[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded;charset=UTF-8")
        const type = sent[1].headers["Content-Type"]
        expect(type).toMatch(/^multipart\/form-data; boundary=/)
        expect(Object.keys(sent[1].headers)).toEqual(["Content-Type"])
        const boundary = type.split("boundary=")[1]
        expect(sent[1].body).toBe(`--${boundary}\r\nContent-Disposition: form-data; name="do"\r\n\r\nsearch\r\n--${boundary}\r\nContent-Disposition: form-data; name="story"\r\n\r\nü\r\n--${boundary}--\r\n`)
        expect(sent[2]).toMatchObject({ method: "PUT", body: "plain", redirect: "manual" })
        expect(sent[3].body).toEqual(new Uint8Array([0, 255, 1]))
    })

    it("reports a redirect, a status that is not ok, and a failure as a rejected promise", async () => {
        const sandbox = await open()
        expect(await sandbox.call("get", "https://example.test/moved")).toMatchObject({ redirected: true, url: "https://example.test/landed", ok: true })
        expect(await sandbox.call("get", "https://example.test/missing")).toMatchObject({ status: 404, ok: false })
        expect(await sandbox.call("failing", "https://example.test/broken")).toBe("rejected: fetch: connection refused")
        expect(await sandbox.call("failing", "file:///etc/passwd")).toMatch(/^rejected: fetch: only http and https/)
        expect(await sandbox.call("failing", "https://example.test/never", { timeout: 0.05 })).toBe("rejected: fetch: no answer from example.test within 0.05 s")
        await sandbox.close()
    })

    it("stays under the sandbox's time limit", async () => {
        const sandbox = await open({ timeMs: 200 })
        await expect(sandbox.call("get", "https://example.test/never")).rejects.toSatisfy(error => error instanceof SandboxError && error.kind === "time")
        await sandbox.close()
    })
})

describe("the other helpers", () => {
    it("console goes to the app's log", async () => {
        const logs: [HelperLogLevel, string][] = []
        const sandbox = await open({ logs })
        await sandbox.call("run", `console.log("a", 1, { b: [2] }); console.warn(new TypeError("bad")); console.debug(null)`)
        await sandbox.call("runAsync", "Promise.resolve()")
        await sandbox.close()
        expect(logs.map(([level, text]) => [level, text.split("\n")[0]])).toEqual([["log", `a 1 {"b":[2]}`], ["warn", "TypeError: bad"], ["debug", "null"]])
    })

    it("URL and URLSearchParams follow the URL standard", async () => {
        expect(await evaluate(`(() => {
            const u = new URL("../b?x=1#f", "https://user@Example.TEST:443/a/c")
            u.searchParams.append("q", "dr. stone")
            const p = new URLSearchParams("a=1&b=%C3%BC&a=2")
            return [u.href, u.host, u.pathname, u.hash, p.getAll("a"), p.get("b"), String(new URL("https://例え.jp/").host)]
        })()`)).toEqual(["https://user@example.test/b?x=1&q=dr.+stone#f", "example.test", "/b", "#f", ["1", "2"], "ü", "xn--r8jz45g.jp"])
    })

    it("atob and btoa give the pairs of RFC 4648 and refuse what is not Base64 or Latin1", async () => {
        const pairs = [["", ""], ["f", "Zg=="], ["fo", "Zm8="], ["foo", "Zm9v"], ["foob", "Zm9vYg=="], ["fooba", "Zm9vYmE="], ["foobar", "Zm9vYmFy"], ["ÿ\u0000\u0080", "/wCA"]]
        expect(await evaluate(`${JSON.stringify(pairs)}.map(([plain, coded]) => [btoa(plain), atob(coded), atob(" Zm 9v\\n")])`)).toEqual(pairs.map(([plain, coded]) => [coded, plain, "foo"]))
        expect(await evaluate(`[() => atob("Zm9v!"), () => atob("Z"), () => btoa("€")].map(f => { try { f(); return "none" } catch (e) { return e.name } })`)).toEqual(["InvalidCharacterError", "InvalidCharacterError", "InvalidCharacterError"])
    })

    it("Buffer works as Node's", async () => {
        expect(await evaluate(`[
            Buffer.from("héllo").toString("base64"), Buffer.from("aGVsbG8=", "base64").toString(), Buffer.from([0xde, 0xad]).toString("hex"),
            Buffer.from("dead", "hex").length, Buffer.alloc(3, 1).toString("hex"), Buffer.from("a").equals(new Uint8Array([97])),
            Buffer.from(new Uint8Array([104, 105]).buffer).toString("utf8"), Buffer.from("héllo", "latin1").toString("hex"),
        ]`)).toEqual(["aMOpbGxv", "hello", "dead", 2, "010101", true, "hi", "68e96c6c6f"])
    })

    it("CryptoJS gives the known values of the hashes, HMAC and AES", async () => {
        expect(await evaluate(`[
            CryptoJS.MD5("abc").toString(), CryptoJS.SHA1("abc").toString(), CryptoJS.SHA256("abc").toString(CryptoJS.enc.Hex),
            CryptoJS.SHA512("abc").toString(), CryptoJS.HmacSHA256("what do ya want for nothing?", "Jefe").toString(),
        ]`)).toEqual([
            "900150983cd24fb0d6963f7d28e17f72",
            "a9993e364706816aba3e25717850c26c9cd0d89d",
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
        ])
        // FIPS-197 C.1: the first block of CBC with an IV of zeros is the plain AES block; PKCS#7 adds a second
        expect(await evaluate(`(() => {
            const hex = CryptoJS.enc.Hex
            const key = hex.parse("000102030405060708090a0b0c0d0e0f"), iv = new Uint8Array(16)
            const sealed = CryptoJS.AES.encrypt(hex.parse("00112233445566778899aabbccddeeff"), key, { iv })
            const opened = CryptoJS.AES.decrypt(sealed.toString(CryptoJS.enc.Base64), key, { iv })
            return [key instanceof Uint8Array, sealed.toString(hex), opened.toString(hex)]
        })()`)).toEqual([true, "69c4e0d86a7b0430d8cdb78070b4c55a9e978e6d16b086570ef794ef97984232", "00112233445566778899aabbccddeeff"])
        expect(await evaluate(`(() => {
            const sealed = CryptoJS.AES.encrypt("geheim ü", "passphrase").toString()
            const again = CryptoJS.AES.decrypt(sealed, "passphrase").toString(CryptoJS.enc.Utf8)
            let refused = "none"; try { CryptoJS.AES.encrypt("x", new Uint8Array(16)) } catch (e) { refused = e.message }
            return [atob(sealed).slice(0, 8), again, refused]
        })()`)).toEqual(["Salted__", "geheim ü", "CryptoJS.AES: a key of bytes needs an iv of bytes in the config"])
        expect(await evaluate(`(() => {
            const e = CryptoJS.enc
            return [e.Base64.stringify(e.Utf8.parse("foobar")), Array.from(e.Base64.parse("/wCA")), e.Utf16.stringify(e.Utf16.parse("hé")), e.Latin1.stringify(new Uint8Array([233])), e.Hex.stringify(CryptoJS.MD5(""))]
        })()`)).toEqual(["Zm9vYmFy", [255, 0, 128], "hé", "é", "d41d8cd98f00b204e9800998ecf8427e"])
    })

    it("$sleep waits in place and the time limit still stops it", async () => {
        const sandbox = await open({ timeMs: 400 })
        const took = await sandbox.call<number>("run", `(() => { const t = Date.now(); $sleep(60); return Date.now() - t })()`)
        expect(took).toBeGreaterThanOrEqual(60)
        await expect(sandbox.call("run", "$sleep(10000)")).rejects.toSatisfy(error => error instanceof SandboxError && error.kind === "time")
        expect(await sandbox.call("runAsync", "(async () => { await $sleep(1); return 1 })()")).toBe(1)
        await sandbox.close()
    })

    it("$store keeps values while the sandbox lives, copies on get, watches keys", async () => {
        const sandbox = await open()
        expect(await sandbox.call("run", `(() => {
            const seen = []
            $store.watch("a", v => seen.push(v))
            const value = { list: [1] }
            $store.set("a", value)
            const copy = $store.get("a"); copy.list.push(2)
            return [
                $store.get("a").list.length, $store.getUnsafe("a") === value, $store.has("a"), $store.has("b"),
                $store.getOrSet("b", () => 5), $store.getOrSet("b", () => 6),
                $store.setIfLessThanLimit("c", 1, 2), $store.setIfLessThanLimit("a", 9, 2), seen,
                $store.marshalJSON({ x: 1 }), $store.values(), $store.getAll(),
            ]
        })()`)).toEqual([1, true, true, false, 5, 5, false, true, [{ list: [1] }, 9], `{"x":1}`, [9, 5], { a: 9, b: 5 }])
        expect(await sandbox.call("run", `$store.unmarshalJSON('{"k":[1]}'); [$store.get("k"), Object.keys($store.getAllUnsafe())]`)).toEqual([[1], ["a", "b", "k"]])
        expect(await sandbox.call("run", `$store.reset(); $store.values().length`)).toBe(0)
        await sandbox.close()
        const other = await open()
        expect(await other.call("run", `$store.has("a")`)).toBe(false)
        await other.close()
    })

    it("preferences, offline flag, $clone, $toString, $toBytes", async () => {
        const sandbox = await open({ preferences: { language: "de" } })
        expect(await sandbox.call("run", `[
            $getUserPreference("language"), $getUserPreference("missing") === undefined, $getUserPreference("toString") === undefined, __isOffline__,
            (() => { const a = { b: [1] }; const c = $clone(a); c.b.push(2); return a.b.length })(),
            $toString(new Uint8Array([104, 195, 169])), $toString({ a: 1 }), Array.from($toBytes("hé")), $toBytes("x") instanceof Uint8Array,
            (() => { try { fetch = null; return typeof fetch } catch (e) { return "kept" } })(),
        ]`)).toEqual(["de", true, true, false, 1, "hé", `{"a":1}`, [104, 195, 169], true, "function"])
        await sandbox.close()
    })
})
