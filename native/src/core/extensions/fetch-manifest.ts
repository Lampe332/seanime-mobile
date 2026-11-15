// geschrieben nach: Aufzeichnung „api-faelle" vom 13.11.2026 (98 Fälle der Schnittstelle POST /api/v1/extensions/external/fetch,
// erzeugt mit scripts/record-server.mjs manifest-cases; als Testdaten in fetch-manifest.recorded.json) und den Typen der
// App (src/api/generated/types.ts, Extension_Extension)

import { CoreError, errorText } from "../errors"

/*
 * "Read an extension's manifest": the app gives an address, gets back the manifest with the extension's code in it, and
 * shows it before anything is installed (the add-extension sheet, "Check for updates"). Nothing is stored.
 *
 * Every rule below is one the recordings show: which fields must be there, in which order the checks run, which fields
 * are left out when empty, and the texts of the errors the user reads. Where the server's text came from its own
 * runtime (network and JSON faults) only the fixed beginning is kept and the detail is this code's own.
 */

export type ExtensionConfigField = {
    type: string
    name: string
    label: string
    options?: { value: string, label: string }[]
    default?: string
}

export type ExtensionUserConfig = {
    version: number
    requiresConfig: boolean
    fields: ExtensionConfigField[] | null
}

export type ExtensionPluginManifest = {
    version: string
    permissions: {
        scopes?: string[]
        allow: {
            networkAccess: { allowedDomains?: string[], reasoning?: string }
            unsafeFlags?: { flag: string, reason: string }[]
            readPaths?: string[]
            writePaths?: string[]
            commandScopes?: { description?: string, command: string, args?: { value?: string, validator?: string }[] }[]
        }
    }
}

export type ExtensionManifest = {
    id: string
    name: string
    version: string
    semverConstraint?: string
    manifestURI: string
    language: string
    type: string
    description: string
    author: string
    icon: string
    website: string
    readme: string
    notes?: string
    lang: string
    permissions?: string[]
    userConfig?: ExtensionUserConfig
    payload: string
    payloadURI?: string
    plugin?: ExtensionPluginManifest
}

/** The network as the core sees it: the app hands in its `fetch`, tests hand in recorded answers. */
export type FetchText = (url: string, init: { signal: AbortSignal }) => Promise<{ text: () => Promise<string> }>

const LANGUAGES = ["javascript", "typescript", "go"]
const TYPES = ["anime-torrent-provider", "manga-provider", "onlinestream-provider", "custom-source", "plugin"]
/** Starts with a letter, then letters, digits and hyphens, and does not end with a hyphen. */
const ID_PATTERN = /^[a-zA-Z](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
/** No answer after this long is a failed download. The recordings do not show the server's own limit. */
const TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

/** The recorded texts count bytes, not characters. */
function byteLength(text: string): number {
    let bytes = 0
    for (const char of text) {
        const code = char.codePointAt(0)!
        bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    }
    return bytes
}

/** A manifest value of the wrong kind stops the reading, as it did on the server. */
function wrongKind(path: string, expected: string): CoreError {
    return new CoreError(`failed to parse extension manifest, ${path} must be ${expected}`)
}

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(source: Json, key: string, path: string): string {
    const value = source[key]
    if (value === undefined || value === null) return ""
    if (typeof value !== "string") throw wrongKind(path + key, "a text")
    return value
}

function flag(source: Json, key: string, path: string): boolean {
    const value = source[key]
    if (value === undefined || value === null) return false
    if (typeof value !== "boolean") throw wrongKind(path + key, "true or false")
    return value
}

function wholeNumber(source: Json, key: string, path: string): number {
    const value = source[key]
    if (value === undefined || value === null) return 0
    if (typeof value !== "number" || !Number.isInteger(value)) throw wrongKind(path + key, "a whole number")
    return value
}

function part(source: Json, key: string, path: string): Json | null {
    const value = source[key]
    if (value === undefined || value === null) return null
    if (!isObject(value)) throw wrongKind(path + key, "an object")
    return value
}

/** null = the manifest has no such list (the server makes a difference between none and an empty one in one place). */
function list<T>(source: Json, key: string, path: string, read: (item: unknown, itemPath: string) => T): T[] | null {
    const value = source[key]
    if (value === undefined || value === null) return null
    if (!Array.isArray(value)) throw wrongKind(path + key, "a list")
    return value.map((item, index) => read(item, `${path}${key}[${index}]`))
}

function textItem(item: unknown, itemPath: string): string {
    if (typeof item !== "string") throw wrongKind(itemPath, "a text")
    return item
}

function objectItem(item: unknown, itemPath: string): Json {
    if (item === null) return {}
    if (!isObject(item)) throw wrongKind(itemPath, "an object")
    return item
}

/** Leaves a field out when it is empty: an empty text, an empty or missing list, a missing part. */
function unlessEmpty<K extends string, V>(key: K, value: V | null | undefined | ""): { [P in K]?: V } {
    const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)
    return (empty ? {} : { [key]: value }) as { [P in K]?: V }
}

function readUserConfig(source: Json): ExtensionUserConfig {
    const path = "userConfig."
    return {
        version: wholeNumber(source, "version", path),
        requiresConfig: flag(source, "requiresConfig", path),
        fields: list(source, "fields", path, (item, itemPath) => {
            const field = objectItem(item, itemPath)
            const fieldPath = itemPath + "."
            return {
                type: text(field, "type", fieldPath),
                name: text(field, "name", fieldPath),
                label: text(field, "label", fieldPath),
                ...unlessEmpty("options", list(field, "options", fieldPath, (option, optionPath) => {
                    const entry = objectItem(option, optionPath)
                    return { value: text(entry, "value", optionPath + "."), label: text(entry, "label", optionPath + ".") }
                })),
                ...unlessEmpty("default", text(field, "default", fieldPath)),
            }
        }),
    }
}

function readPlugin(source: Json): ExtensionPluginManifest {
    const permissions = part(source, "permissions", "plugin.") ?? {}
    const allow = part(permissions, "allow", "plugin.permissions.") ?? {}
    const allowPath = "plugin.permissions.allow."
    const network = part(allow, "networkAccess", allowPath) ?? {}
    return {
        version: text(source, "version", "plugin."),
        permissions: {
            ...unlessEmpty("scopes", list(permissions, "scopes", "plugin.permissions.", textItem)),
            allow: {
                networkAccess: {
                    ...unlessEmpty("allowedDomains", list(network, "allowedDomains", allowPath + "networkAccess.", textItem)),
                    ...unlessEmpty("reasoning", text(network, "reasoning", allowPath + "networkAccess.")),
                },
                ...unlessEmpty("unsafeFlags", list(allow, "unsafeFlags", allowPath, (item, itemPath) => {
                    const entry = objectItem(item, itemPath)
                    return { flag: text(entry, "flag", itemPath + "."), reason: text(entry, "reason", itemPath + ".") }
                })),
                ...unlessEmpty("readPaths", list(allow, "readPaths", allowPath, textItem)),
                ...unlessEmpty("writePaths", list(allow, "writePaths", allowPath, textItem)),
                ...unlessEmpty("commandScopes", list(allow, "commandScopes", allowPath, (item, itemPath) => {
                    const scope = objectItem(item, itemPath)
                    return {
                        ...unlessEmpty("description", text(scope, "description", itemPath + ".")),
                        command: text(scope, "command", itemPath + "."),
                        ...unlessEmpty("args", list(scope, "args", itemPath + ".", (arg, argPath) => {
                            const entry = objectItem(arg, argPath)
                            return {
                                ...unlessEmpty("value", text(entry, "value", argPath + ".")),
                                ...unlessEmpty("validator", text(entry, "validator", argPath + ".")),
                            }
                        })),
                    }
                })),
            },
        },
    }
}

async function download(url: string, fetchText: FetchText): Promise<string> {
    if (!/^https?:\/\//i.test(url)) throw new Error(`"${url}" is not an http or https address`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
        // The answer's status is not looked at: the recordings show the body of a "not found" page being read as the file
        return await (await fetchText(url, { signal: controller.signal })).text()
    }
    finally {
        clearTimeout(timer)
    }
}

/**
 * Reads the manifest at `manifestUri` and returns it the way the app's screens expect it, with the extension's code in
 * `payload`. Throws a {@link CoreError} with the text the user is shown when the manifest cannot be used.
 */
export async function fetchExtensionManifest(manifestUri: string, fetchText: FetchText): Promise<ExtensionManifest> {
    let body: string
    try {
        body = await download(manifestUri, fetchText)
    }
    catch (error) {
        throw new CoreError(`failed to fetch extension manifest, ${errorText(error)}`)
    }
    return manifestFromText(body, uri => download(uri, fetchText))
}

/**
 * A manifest from its text, with the same checks as one fetched. `loadPayload` fetches the code behind `payloadURI`;
 * null for a manifest that was stored with its code (an installed extension, docs/EIGENER-KERN.md §4l): its `payload`
 * is used as it is.
 */
export async function manifestFromText(body: string, loadPayload: ((uri: string) => Promise<string>) | null): Promise<ExtensionManifest> {
    let parsed: unknown
    try {
        parsed = JSON.parse(body)
    }
    catch (error) {
        throw new CoreError(`failed to parse extension manifest, ${errorText(error)}`)
    }
    // "null" reads as a manifest without any field
    if (parsed !== null && !isObject(parsed)) throw wrongKind("the manifest", "an object")
    const source: Json = parsed ?? {}

    const id = text(source, "id", "")
    const name = text(source, "name", "")
    const version = text(source, "version", "")
    const language = text(source, "language", "")
    const type = text(source, "type", "")
    const author = text(source, "author", "")
    const payloadURI = text(source, "payloadURI", "")
    let payload = text(source, "payload", "")
    const pluginSource = part(source, "plugin", "")
    const plugin = pluginSource ? readPlugin(pluginSource) : null
    const userConfigSource = part(source, "userConfig", "")
    const manifest: ExtensionManifest = {
        id,
        name,
        version,
        ...unlessEmpty("semverConstraint", text(source, "semverConstraint", "")),
        manifestURI: text(source, "manifestURI", ""),
        language,
        type,
        description: text(source, "description", ""),
        author,
        icon: text(source, "icon", ""),
        website: text(source, "website", ""),
        readme: text(source, "readme", ""),
        ...unlessEmpty("notes", text(source, "notes", "")),
        lang: text(source, "lang", ""),
        ...unlessEmpty("permissions", list(source, "permissions", "", textItem)),
        ...(userConfigSource ? { userConfig: readUserConfig(userConfigSource) } : {}),
        payload,
        ...unlessEmpty("payloadURI", payloadURI),
        ...(plugin ? { plugin } : {}),
    }
    const development = flag(source, "isDevelopment", "")

    // The code behind an address replaces code written into the manifest
    if (payloadURI && loadPayload) {
        try {
            payload = await loadPayload(payloadURI)
        }
        catch (error) {
            throw new CoreError(`failed to download payload, ${errorText(error)}`)
        }
        if (payload === "") throw new CoreError("downloaded payload is empty")
        manifest.payload = payload
    }

    const refuse = (reason: string) => new CoreError(`failed sanity check, ${reason}`)
    if (!id || !name || !version || !language || !type || !author) {
        throw refuse(`extension is missing required fields, ID: ${id}, Name: ${name}, Version: ${version}, Language: ${language}, Type: ${type}, Author: ${author}, Payload: ${byteLength(payload)}`)
    }
    if (!payload) throw refuse("extension is missing payload and payload URI")
    if (byteLength(id) < 3) throw refuse("extension ID is too short")
    if (!ID_PATTERN.test(id)) throw refuse("extension ID contains invalid characters")
    if (!VERSION_PATTERN.test(version)) throw refuse(`invalid version: ${version}`)
    if (!LANGUAGES.includes(language)) throw refuse(`unsupported language: ${language}`)
    if (!TYPES.includes(type)) throw refuse(`unsupported extension type: ${type}`)
    if (type === "plugin") {
        if (!plugin) throw refuse("plugin manifest is missing")
        if (!plugin.version) throw refuse("plugin manifest version is missing")
    }
    if (development) throw new CoreError("cannot install development mode extensions for security reasons")

    return manifest
}
