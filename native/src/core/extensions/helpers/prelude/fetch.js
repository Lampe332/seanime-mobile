// geschrieben nach: goja_plugin_types/core.d.ts (fetch, FetchOptions mit noCloudflareBypass, FetchResponse), WHATWG Fetch Standard (Headers, Response.ok) und XHR Standard (FormData), MDN zu fetch/FormData; keine Vorlage

/* global host */

/*
 * fetch inside the sandbox. The sandbox has no network: every request is a question to the app (`host.ask("fetch")`),
 * the app sends it and answers with status, headers and the body as text. The answer is read in full before the
 * promise settles, so `text()` and `json()` give their value at once, as the contract says (`await` on them works too).
 * An answer that is Cloudflare's automatic check is the app's to pass (docs/EIGENER-KERN.md §4k); `noCloudflareBypass`
 * asks it not to.
 */

import { Buffer } from "buffer"

/** Header names in any case, as a browser's Headers object treats them */
function caseless(record) {
    const lower = {}
    for (const name of Object.keys(record)) lower[name.toLowerCase()] = record[name]
    const find = name => (typeof name === "string" && Object.hasOwn(lower, name.toLowerCase()) ? lower[name.toLowerCase()] : undefined)
    const methods = {
        get: name => find(String(name)) ?? null,
        has: name => find(String(name)) !== undefined,
        forEach: callback => Object.keys(lower).forEach(name => callback(lower[name], name)),
    }
    return new Proxy(lower, {
        get: (target, name) => (Object.hasOwn(methods, name) && find(name) === undefined ? methods[name] : find(name) ?? target[name]),
        has: (target, name) => find(name) !== undefined || name in target,
    })
}

export class FormData {
    #entries = []

    append(name, value) {
        this.#entries.push([String(name), String(value)])
    }

    set(name, value) {
        this.delete(name)
        this.append(name, value)
    }

    get(name) {
        const found = this.#entries.find(([key]) => key === String(name))
        return found ? found[1] : null
    }

    getAll(name) {
        return this.#entries.filter(([key]) => key === String(name)).map(([, value]) => value)
    }

    has(name) {
        return this.#entries.some(([key]) => key === String(name))
    }

    delete(name) {
        this.#entries = this.#entries.filter(([key]) => key !== String(name))
    }

    forEach(callback, self) {
        for (const [name, value] of this.#entries) callback.call(self, value, name, this)
    }

    * entries() {
        yield* this.#entries.map(entry => [...entry])
    }

    * keys() {
        for (const [name] of this.#entries) yield name
    }

    * values() {
        for (const [, value] of this.#entries) yield value
    }

    [Symbol.iterator]() {
        return this.entries()
    }

    get [Symbol.toStringTag]() {
        return "FormData"
    }
}

/** multipart/form-data as RFC 7578 writes it, for text fields */
function multipart(form) {
    const boundary = "----SeanimeFormBoundary" + Math.random().toString(36).slice(2) + Date.now().toString(36)
    const quote = text => text.replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/"/g, "%22")
    let body = ""
    for (const [name, value] of form.entries()) {
        body += `--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${value}\r\n`
    }
    body += `--${boundary}--\r\n`
    return { body, type: `multipart/form-data; boundary=${boundary}` }
}

function headersFrom(init) {
    const headers = {}
    if (!init) return headers
    const add = (name, value) => {
        headers[String(name)] = String(value)
    }
    if (typeof init.forEach === "function" && !Array.isArray(init)) init.forEach((value, name) => add(name, value))
    else if (Array.isArray(init)) init.forEach(([name, value]) => add(name, value))
    else Object.keys(init).forEach(name => add(name, init[name]))
    return headers
}

function hasHeader(headers, name) {
    return Object.keys(headers).some(key => key.toLowerCase() === name)
}

/** What goes to the app: text as text, bytes as Base64; the content type is set when the body tells it */
function bodyOf(body, headers, URLSearchParams) {
    if (body === undefined || body === null) return {}
    const type = value => {
        if (!hasHeader(headers, "content-type")) headers["Content-Type"] = value
    }
    if (typeof body === "string") {
        type("text/plain;charset=UTF-8")
        return { body }
    }
    if (body instanceof URLSearchParams) {
        type("application/x-www-form-urlencoded;charset=UTF-8")
        return { body: body.toString() }
    }
    if (body instanceof FormData) {
        const encoded = multipart(body)
        // the boundary must be the one in the body, whatever the caller set
        for (const key of Object.keys(headers)) if (key.toLowerCase() === "content-type") delete headers[key]
        headers["Content-Type"] = encoded.type
        return { body: encoded.body }
    }
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
        return { bodyBase64: Buffer.from(bytes).toString("base64") }
    }
    type("application/json")
    return { body: JSON.stringify(body) }
}

function cookiesOf(values) {
    const cookies = {}
    for (const line of values) {
        const pair = line.split(";")[0]
        const at = pair.indexOf("=")
        if (at > 0) cookies[pair.slice(0, at).trim()] = pair.slice(at + 1).trim()
    }
    return cookies
}

/** How the app's answer names a check that asks for a person (browser/cloudflare.ts) */
const NEEDS_USER = "cloudflare needs the user: "

export function makeFetch(URL, URLSearchParams) {
    return async function fetch(input, options) {
        const init = options ?? {}
        const url = String(input instanceof URL ? input.href : input)
        const method = String(init.method ?? "GET").toUpperCase()
        const headers = headersFrom(init.headers)
        const sent = bodyOf(init.body, headers, URLSearchParams)
        const timeout = Number(init.timeout ?? 35)
        let answer
        try {
            answer = await host.ask("fetch", {
                url,
                method,
                headers,
                ...sent,
                redirect: init.redirect ?? "follow",
                timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout * 1000 : 35_000,
                noCloudflareBypass: init.noCloudflareBypass === true,
            })
        }
        catch (error) {
            // Cloudflare's check asks for a person: nothing the app or the extension may do about it (§4k)
            const text = String(error && error.message)
            const at = text.indexOf(NEEDS_USER)
            if (at < 0) throw error
            const failure = new Error("fetch: Cloudflare's check needs the user: " + text.slice(at + NEEDS_USER.length))
            failure.name = "CloudflareCheckError"
            failure.needsUser = true
            throw failure
        }
        const raw = {}
        for (const [name, value] of answer.headers) (raw[name.toLowerCase()] ??= []).push(value)
        const joined = {}
        for (const name of Object.keys(raw)) joined[name] = raw[name].join(", ")
        // an empty page arrives without a body (sandbox.ts, HostReply)
        const text = answer.body ?? ""
        const length = Number(joined["content-length"])
        return {
            status: answer.status,
            statusText: answer.statusText,
            method,
            rawHeaders: caseless(raw),
            ok: answer.status >= 200 && answer.status <= 299,
            url: answer.url || url,
            headers: caseless(joined),
            cookies: cookiesOf(raw["set-cookie"] ?? []),
            redirected: answer.redirected,
            contentType: joined["content-type"] ?? "",
            contentLength: Number.isFinite(length) && joined["content-length"] !== undefined ? length : Buffer.byteLength(text, "utf8"),
            text: () => text,
            json: () => JSON.parse(text),
        }
    }
}
