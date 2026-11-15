#!/usr/bin/env node
// Stage 0, trial 2 (docs/EIGENER-KERN.md): does an extension run in a QuickJS sandbox when the app hands it the network?
// Only `search` is run. The engine here is QuickJS compiled to WebAssembly (quickjs-emscripten), so this runs under
// Node; on a device the same engine has to come from a native module, which this trial does not cover.
//
//   node scripts/probe-quickjs.mjs <provider.ts|.js> --query "dr. stone" [--compare <recorded SearchTorrent answer .json>]
//
// What the extension gets, and nothing else: console, and fetch (answered by this script, i.e. "by the app").
// The contract is the public one: anime-torrent-provider.d.ts (class Provider, search({ media, query })).

import fs from "node:fs"
import { getQuickJS } from "quickjs-emscripten"
import ts from "typescript"

const args = process.argv.slice(2)
const file = args[0]
function option(name, fallback) {
    const index = args.indexOf(`--${name}`)
    return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!file) {
    console.error("usage: probe-quickjs.mjs <provider.ts|.js> --query <text> [--compare <recording.json>]")
    process.exit(2)
}
const query = option("query", "dr. stone")
const compareFile = option("compare", "")

const MEMORY_LIMIT = 64 * 1024 * 1024
const STACK_LIMIT = 512 * 1024
const TIME_LIMIT_MS = 60_000

// Extensions written in TypeScript are turned into JavaScript once (types removed, nothing else)
const source = fs.readFileSync(file, "utf8")
const code = /\.ts$/.test(file)
    ? ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
    : source

const QuickJS = await getQuickJS()
const runtime = QuickJS.newRuntime()
runtime.setMemoryLimit(MEMORY_LIMIT)
runtime.setMaxStackSize(STACK_LIMIT)
const deadline = Date.now() + TIME_LIMIT_MS
runtime.setInterruptHandler(() => Date.now() > deadline)
const vm = runtime.newContext()

const logs = []
const requests = []

// console: text out of the sandbox, nothing back in
const consoleObject = vm.newObject()
for (const level of ["log", "info", "warn", "error", "debug"]) {
    const fn = vm.newFunction(level, (...values) => {
        logs.push(`${level}: ${values.map(value => String(vm.dump(value))).join(" ")}`)
    })
    vm.setProp(consoleObject, level, fn)
    fn.dispose()
}
vm.setProp(vm.global, "console", consoleObject)
consoleObject.dispose()

// The one door to the outside: the sandbox asks, the host does the request and hands back plain text.
const hostFetch = vm.newFunction("__hostFetch", (urlHandle, optionsHandle) => {
    const url = vm.getString(urlHandle)
    const options = JSON.parse(vm.getString(optionsHandle))
    const deferred = vm.newPromise()
    const started = Date.now()
    fetch(url, { method: options.method ?? "GET", headers: options.headers ?? {}, body: options.body ?? undefined, signal: AbortSignal.timeout(30_000) })
        .then(async response => {
            const body = await response.text()
            requests.push({ url, status: response.status, bytes: body.length, ms: Date.now() - started })
            const answer = vm.newString(JSON.stringify({
                status: response.status, statusText: response.statusText, url: response.url, headers: Object.fromEntries(response.headers), body,
            }))
            deferred.resolve(answer)
            answer.dispose()
        })
        .catch(error => {
            requests.push({ url, status: `failed: ${error.message}`, bytes: 0, ms: Date.now() - started })
            const reason = vm.newString(String(error.message))
            deferred.reject(reason)
            reason.dispose()
        })
    deferred.settled.then(() => runtime.executePendingJobs())
    return deferred.handle
})
vm.setProp(vm.global, "__hostFetch", hostFetch)
hostFetch.dispose()

// fetch as the extension contract describes it, built inside the sandbox on that door
const prelude = `
globalThis.fetch = async function (url, options) {
    const answer = JSON.parse(await __hostFetch(String(url), JSON.stringify(options || {})))
    const names = Object.keys(answer.headers)
    return {
        status: answer.status,
        statusText: answer.statusText,
        ok: answer.status >= 200 && answer.status < 300,
        url: answer.url,
        headers: { get: name => { const key = names.find(n => n.toLowerCase() === String(name).toLowerCase()); return key ? answer.headers[key] : null } },
        text: async () => answer.body,
        json: async () => JSON.parse(answer.body),
    }
}
`

function evaluate(label, script) {
    const result = vm.evalCode(script, label)
    if (result.error) {
        const error = vm.dump(result.error)
        result.error.dispose()
        throw new Error(`${label}: ${typeof error === "object" ? `${error.name}: ${error.message}` : error}`)
    }
    return result.value
}

evaluate("prelude.js", prelude).dispose()
evaluate("extension.js", code).dispose()

// What the sandbox can reach of the host: nothing but what was put in above
const reachHandle = evaluate("reach.js", `({
    process: typeof process, require: typeof require, module: typeof module, Deno: typeof Deno, XMLHttpRequest: typeof XMLHttpRequest,
    WebSocket: typeof WebSocket, setTimeout: typeof setTimeout, fetch: typeof fetch, Provider: typeof Provider,
})`)
const reach = vm.dump(reachHandle)
reachHandle.dispose()

const media = { id: 105333, idMal: 38691, status: "FINISHED", format: "TV", englishTitle: "Dr. STONE", romajiTitle: "Dr. STONE", episodeCount: 24, synonyms: [], isAdult: false }
const started = Date.now()
const pending = evaluate("call.js", `(async () => JSON.stringify(await new Provider().search(${JSON.stringify({ media, query })})))()`)
const settled = vm.resolvePromise(pending)
runtime.executePendingJobs()
const outcome = await settled
pending.dispose()
if (outcome.error) {
    const error = vm.dump(outcome.error)
    outcome.error.dispose()
    throw new Error(`search failed in the sandbox: ${typeof error === "object" ? error.message : error}`)
}
const torrents = JSON.parse(vm.getString(outcome.value))
outcome.value.dispose()
const elapsed = Date.now() - started
const memoryHandle = runtime.computeMemoryUsage()
const memory = vm.dump(memoryHandle)
memoryHandle.dispose()

console.log(`engine: quickjs-emscripten (QuickJS as WebAssembly), limits: ${MEMORY_LIMIT / 1048576} MB memory, ${STACK_LIMIT / 1024} KB stack, ${TIME_LIMIT_MS / 1000} s`)
console.log(`inside the sandbox: ${JSON.stringify(reach)}`)
console.log(`search("${query}") -> ${torrents.length} results in ${elapsed} ms, ${requests.length} request(s) through the host:`)
for (const request of requests) console.log(`  ${request.status} ${request.bytes} bytes ${request.ms} ms ${request.url.slice(0, 110)}`)
console.log(`memory used in the sandbox: ${(memory.memory_used_size / 1048576).toFixed(1)} MB`)
if (logs.length) console.log(`console of the extension: ${logs.slice(0, 5).join(" | ")}`)
console.log(`first result: ${JSON.stringify(torrents[0])?.slice(0, 300)}`)

if (compareFile) {
    const recording = JSON.parse(fs.readFileSync(compareFile, "utf8"))
    const server = recording.response.body.data.torrents
    console.log(`\nserver (recorded ${recording.recordedAt}, query "${recording.request.body.query}"): ${server.length} results`)
    const byHash = new Map(server.map(torrent => [torrent.infoHash, torrent]))
    // Counters archive.org changes by the minute are listed apart from what describes the torrent itself
    const STABLE = ["name", "date", "size", "formattedSize", "link", "downloadUrl", "magnetLink", "infoHash", "resolution", "releaseGroup", "episodeNumber", "isBatch", "isBestRelease", "confirmed"]
    const MOVING = ["seeders", "leechers", "downloadCount"]
    // The contract's optional fields: the server leaves an empty one out of its answer, the extension returns it empty
    const OPTIONAL = ["magnetLink", "infoHash", "resolution", "isBatch", "episodeNumber", "releaseGroup"]
    const value = (torrent, key) => OPTIONAL.includes(key) && (torrent[key] === "" || torrent[key] === false || torrent[key] === 0) ? undefined : torrent[key]
    let emptyOptionals = 0
    let same = 0
    let movedOnly = 0
    const different = []
    const missingOnServer = []
    for (const torrent of torrents) {
        const other = byHash.get(torrent.infoHash)
        if (!other) {
            missingOnServer.push(torrent.name)
            continue
        }
        const stable = STABLE.filter(key => JSON.stringify(value(torrent, key)) !== JSON.stringify(value(other, key)))
        emptyOptionals += OPTIONAL.filter(key => key in torrent && !(key in other)).length
        const moving = MOVING.filter(key => torrent[key] !== other[key])
        if (stable.length) different.push(`${torrent.name}: ${stable.map(key => `${key} ${JSON.stringify(torrent[key])} vs ${JSON.stringify(other[key])}`).join(", ")}`)
        else if (moving.length) movedOnly++
        else same++
    }
    const hashes = new Set(torrents.map(torrent => torrent.infoHash))
    const missingInSandbox = server.filter(torrent => !hashes.has(torrent.infoHash)).map(torrent => torrent.name)
    const sameOrder = torrents.length === server.length && torrents.every((torrent, index) => torrent.infoHash === server[index].infoHash)
    console.log(`identical: ${same}, identical except live counters (${MOVING.join("/")}): ${movedOnly}, different: ${different.length}`)
    console.log(`only in the sandbox: ${missingOnServer.length}, only on the server: ${missingInSandbox.length}, same order: ${sameOrder}`)
    const serverOnlyFields = [...new Set(server.flatMap(torrent => Object.keys(torrent)))].filter(key => !torrents.some(torrent => key in torrent))
    console.log(`fields only the server's answer has: ${serverOnlyFields.join(", ") || "none"}`)
    console.log(`empty optional fields the extension returned and the server left out: ${emptyOptionals}`)
    for (const line of different.slice(0, 10)) console.log(`  different: ${line.slice(0, 300)}`)
    for (const name of [...missingOnServer, ...missingInSandbox].slice(0, 6)) console.log(`  on one side only: ${name}`)
    process.exitCode = different.length || missingOnServer.length || missingInSandbox.length ? 1 : 0
}

vm.dispose()
runtime.dispose()
