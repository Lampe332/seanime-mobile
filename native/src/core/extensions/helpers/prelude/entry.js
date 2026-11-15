// geschrieben nach: goja_plugin_types/core.d.ts (Globale für Erweiterungen: fetch, $sleep, $store, $getUserPreference, $clone, $toString, $toBytes, __isOffline__, Buffer, CryptoJS, $habari, $torrentUtils, $scannerUtils, ChromeDP), WHATWG URL/HTML/Console Standard, Node-Doku zu Buffer; keine Vorlage

/* global host */

/*
 * The light helpers of the extension contract, put into a sandbox before an extension's code (docs/EIGENER-KERN.md §4i).
 * The bundle script (scripts/bundle-extension-helpers.mjs) packs this file with the libraries it uses into one script
 * that is a function of the options below; helpers.ts runs it in every new sandbox.
 */

import "./early.js"
import { Buffer } from "buffer"
import { URL, URLSearchParams } from "whatwg-url-minimum"
import { atob, btoa } from "./base64.js"
import { ChromeDP } from "./chromedp.js"
import { CryptoJS } from "./crypto.js"
import { FormData, makeFetch } from "./fetch.js"
import { clone, makeStore } from "./store.js"
import { parse as parseReleaseName } from "./habari.js"
import { getMagnetLinkFromTorrentData } from "./torrent.js"
import { scannerUtils } from "./scanner.js"

function describe(value) {
    if (typeof value === "string") return value
    if (value instanceof Error) return value.stack ? `${value.name}: ${value.message}\n${value.stack}` : `${value.name}: ${value.message}`
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`
    if (typeof value === "bigint" || typeof value === "symbol") return value.toString()
    try {
        const json = JSON.stringify(value)
        return json === undefined ? String(value) : json
    }
    catch {
        return String(value)
    }
}

function makeConsole() {
    const say = level => (...args) => {
        // the app writes the line to its log; a lost line is no reason to fail the extension
        host.ask("log", { level, text: args.map(describe).join(" ") }).catch(() => undefined)
    }
    return Object.freeze({ log: say("log"), info: say("info"), warn: say("warn"), error: say("error"), debug: say("debug") })
}

/** Waits in place, as the contract's $sleep returns only after the time; the sandbox's time limit still applies */
function sleep(milliseconds) {
    const until = Date.now() + Math.max(0, Number(milliseconds) || 0)
    while (Date.now() < until) {
        // nothing: the engine checks its time limit while this runs
    }
    return Promise.resolve()
}

// the contract's Buffer.equals takes a Uint8Array as well, as Node's does; the buffer package wants a Buffer
const equals = Buffer.prototype.equals
Buffer.prototype.equals = function (other) {
    return equals.call(this, other instanceof Uint8Array && !Buffer.isBuffer(other) ? Buffer.from(other.buffer, other.byteOffset, other.byteLength) : other)
}

const textDecoder = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8")

export function install(options) {
    const preferences = Object.freeze({ ...options.preferences })
    const define = (name, value) => Object.defineProperty(globalThis, name, { value, writable: false, enumerable: false, configurable: false })

    define("__isOffline__", Boolean(options.offline))
    define("console", makeConsole())
    define("URL", URL)
    define("URLSearchParams", URLSearchParams)
    define("atob", atob)
    define("btoa", btoa)
    define("Buffer", Buffer)
    define("CryptoJS", CryptoJS)
    define("FormData", FormData)
    define("ChromeDP", ChromeDP)
    define("fetch", makeFetch(URL, URLSearchParams))
    define("$sleep", sleep)
    define("$store", makeStore())
    define("$getUserPreference", key => (Object.hasOwn(preferences, String(key)) ? preferences[String(key)] : undefined))
    define("$habari", Object.freeze({ parse: parseReleaseName }))
    define("$torrentUtils", Object.freeze({ getMagnetLinkFromTorrentData }))
    define("$scannerUtils", scannerUtils)
    define("$clone", clone)
    define("$toString", value => {
        if (typeof value === "string") return value
        if (value instanceof ArrayBuffer) return textDecoder(new Uint8Array(value))
        if (ArrayBuffer.isView(value)) return textDecoder(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
        return describe(value)
    })
    define("$toBytes", value => {
        if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
        if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
        const bytes = Buffer.from(typeof value === "string" ? value : describe(value), "utf8")
        return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    })
}
