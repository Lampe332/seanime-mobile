// geschrieben nach: Aufzeichnungen EXTENSIONS.* vom 13.11.2026 (GetAllExtensions, ListExtensionData, List*ProviderExtensions, ListCustomSourceExtensions, GetExtensionPayload, GetExtensionUserConfig, SaveExtensionUserConfig, GetMarketplaceExtensions, GetExtensionUpdateData, ReloadExternalExtension: Felder und Form), den Vertrags-Dateien der Erweiterungs-Arten (getSettings) und docs/EIGENER-KERN.md §4l; kein Server-Quelltext

import { eq } from "drizzle-orm"
import type { HttpFetch } from "../../anilist/client"
import type { CoreDatabase } from "../../database/database"
import { extensionSandboxSettings, extensionSettings, extensionUserConfigs } from "../../database/schema"
import { CoreError } from "../../errors"
import type { CoreRequest } from "../../registry"
import { type ExtensionManifest, fetchExtensionManifest } from "../fetch-manifest"
import { type ExtensionPlace, type InvalidExtension, fileOf, readInstalled, withoutCode } from "./installed"
import { DEFAULT_EXTENSION_IDLE_SECONDS, DEFAULT_EXTENSION_MEMORY_MB, ExtensionLoader, type LoaderSettings } from "./loader"

/*
 * The management of extensions in the core (phase 3e-1): the lists, an extension's code and settings, the user's
 * settings, the marketplace and the check for updates. What the core keeps between requests (the open sandboxes, the
 * settings the extensions gave, the last check for updates) belongs to the place the app handed in.
 */

/** The official marketplace, used when the app names none (its 68 entries are the recording's) */
export const DEFAULT_MARKETPLACE_URL = "https://raw.githubusercontent.com/5rahim/seanime-extensions/main/marketplace.json"

export type ManageEnvironment = {
    place: ExtensionPlace
    database: () => Promise<CoreDatabase>
    fetch: HttpFetch
    now: () => number
}

export type SavedUserConfig = { version: number, values: Record<string, string> }

export type UpdateData = { extensionID: string, manifestURI: string, version: string, payload: string }

type State = {
    loader: ExtensionLoader
    /** getSettings() of each extension, for the files it was asked with (`stampsOf`) */
    settings: Map<string, { stamps: string, settings: unknown }>
    /** Code that did not load, with why: listed as invalid until it changes */
    failed: Map<string, { payload: string, reason: string }>
    updates: UpdateData[] | null
    database: () => Promise<CoreDatabase>
}

const states = new WeakMap<ExtensionPlace, State>()

function stateOf(environment: ManageEnvironment): State {
    let state = states.get(environment.place)
    if (!state) {
        const created: State = {
            settings: new Map(),
            failed: new Map(),
            updates: null,
            database: environment.database,
            loader: new ExtensionLoader(environment.place, () => sandboxSettings(created.database)),
        }
        state = created
        states.set(environment.place, state)
    }
    state.database = environment.database
    return state
}

/** The limits of the sandboxes: the row of `extension_sandbox_settings`, else the defaults */
export async function sandboxSettings(database: () => Promise<CoreDatabase>): Promise<LoaderSettings> {
    const row = (await (await database()).select().from(extensionSandboxSettings))[0]
    return { memoryMb: row?.memoryMb ?? DEFAULT_EXTENSION_MEMORY_MB, idleSeconds: row?.idleSeconds ?? DEFAULT_EXTENSION_IDLE_SECONDS }
}

export async function setSandboxSettings(database: CoreDatabase, settings: LoaderSettings, now: number): Promise<void> {
    if (!(settings.memoryMb >= 16 && settings.memoryMb <= 2048) || !(settings.idleSeconds >= 5 && settings.idleSeconds <= 3600)) {
        throw new CoreError("the sandbox limits are out of range (16–2048 MB, 5–3600 s)")
    }
    await database.insert(extensionSandboxSettings).values({ id: 1, ...settings, changedAt: now })
        .onConflictDoUpdate({ target: extensionSandboxSettings.id, set: { ...settings, changedAt: now } })
}

// ---- the user's settings of an extension ----

function savedFrom(value: unknown): SavedUserConfig | null {
    if (!value || typeof value !== "object") return null
    const { version, values } = value as { version?: unknown, values?: unknown }
    if (typeof version !== "number" || !values || typeof values !== "object") return null
    return { version, values: Object.fromEntries(Object.entries(values).map(([name, entry]) => [name, String(entry)])) }
}

/**
 * The user's settings of an extension. The first time the core is asked for an extension, it takes them over once from
 * the server's file cache (`ext_user_config_<id>`: `{ "<id>": { value: { version, values } } }`), read only; from then
 * on they live in the core's database, also when the server had none.
 */
export async function savedUserConfig(environment: ManageEnvironment, id: string): Promise<SavedUserConfig | null> {
    const database = await environment.database()
    const row = (await database.select().from(extensionUserConfigs).where(eq(extensionUserConfigs.id, id)))[0]
    if (row) return row.version === null || row.values === null ? null : { version: row.version, values: row.values }
    let saved: SavedUserConfig | null = null
    const text = await environment.place.serverCache(`ext_user_config_${id}`)
    if (text) {
        try {
            const entry = (JSON.parse(text) as Record<string, { value?: unknown }>)[id]
            saved = savedFrom(entry?.value)
        }
        catch {
            saved = null
        }
    }
    await database.insert(extensionUserConfigs)
        .values({ id, version: saved?.version ?? null, values: saved?.values ?? null, origin: "server", changedAt: environment.now() })
        .onConflictDoNothing()
    return saved
}

/** The values a sandbox gets: each field's default, replaced by what the user saved */
export function preferencesOf(manifest: ExtensionManifest, saved: SavedUserConfig | null): Record<string, string> {
    const preferences: Record<string, string> = {}
    for (const field of manifest.userConfig?.fields ?? []) preferences[field.name] = field.default ?? ""
    return { ...preferences, ...saved?.values }
}

// ---- reading the installed ones ----

async function installedOf(environment: ManageEnvironment) {
    return readInstalled(environment.place)
}

function find(list: ExtensionManifest[], id: string): ExtensionManifest | undefined {
    return list.find(extension => extension.id === id)
}

/** FNV-1a over a text, as 8 hex digits: names the values without keeping them */
function fingerprint(text: string): string {
    let hash = 0x811c9dc5
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * Size and time of the last change of the extension's file and of the server's file with its user's settings
 * (`ext_user_config_<id>`). A write from outside the core (the server, while the area was off) changes them, and
 * getSettings() is asked again; reading the stamps needs neither the code's text nor a sandbox.
 */
async function stampsOf(environment: ManageEnvironment, id: string, file: string): Promise<string> {
    const [code, config] = await Promise.all([environment.place.folder.stamp(file), environment.place.serverCacheStamp(`ext_user_config_${id}`)])
    return `${code ?? "none"}.${config ?? "none"}`
}

/** Keeps what getSettings() gave, in memory and in the core's database (the next app start lists without a sandbox) */
export async function rememberSettings(environment: ManageEnvironment, manifest: ExtensionManifest, file: string, preferences: Record<string, string>, settings: unknown): Promise<void> {
    const state = stateOf(environment)
    const stamps = await stampsOf(environment, manifest.id, file)
    state.settings.set(manifest.id, { stamps, settings })
    state.failed.delete(manifest.id)
    // what getSettings() depends on: the files and the values the sandbox is opened with
    const codeKey = `${stamps}.${fingerprint(JSON.stringify(preferences))}`
    const now = environment.now()
    await (await environment.database()).insert(extensionSettings).values({ id: manifest.id, codeKey, settings: { value: settings ?? null }, changedAt: now })
        .onConflictDoUpdate({ target: extensionSettings.id, set: { codeKey, settings: { value: settings ?? null }, changedAt: now } })
}

/**
 * getSettings() of an extension; null when its code does not load. Asked in its sandbox once per files and settings;
 * after that from memory or, after the app started again, from the core's database, so that the lists open no sandbox.
 */
async function settingsOf(environment: ManageEnvironment, manifest: ExtensionManifest, file: string): Promise<unknown> {
    const state = stateOf(environment)
    const stamps = await stampsOf(environment, manifest.id, file)
    const known = state.settings.get(manifest.id)
    if (known && known.stamps === stamps) return known.settings
    const preferences = preferencesOf(manifest, await savedUserConfig(environment, manifest.id))
    const codeKey = `${stamps}.${fingerprint(JSON.stringify(preferences))}`
    const row = (await (await environment.database()).select().from(extensionSettings).where(eq(extensionSettings.id, manifest.id)))[0]
    if (row && row.codeKey === codeKey) {
        state.settings.set(manifest.id, { stamps, settings: row.settings.value })
        return row.settings.value
    }
    try {
        const settings = await state.loader.call(manifest, preferences, "getSettings")
        await rememberSettings(environment, manifest, file, preferences, settings)
        return settings
    }
    catch (error) {
        state.failed.set(manifest.id, { payload: manifest.payload, reason: error instanceof Error ? error.message : String(error) })
        return null
    }
}

async function loadedOfType(environment: ManageEnvironment, type: string) {
    const { extensions, files } = await installedOf(environment)
    const ofType = extensions.filter(extension => extension.type === type)
    const loaded = await Promise.all(ofType.map(async manifest => ({ manifest, settings: await settingsOf(environment, manifest, files.get(manifest.id) ?? fileOf(manifest.id)) })))
    return loaded.filter(entry => entry.settings !== null)
}

// ---- the answers ----

export async function listExtensionData(environment: ManageEnvironment): Promise<ExtensionManifest[]> {
    return (await installedOf(environment)).extensions.map(withoutCode)
}

function needsConfig(manifest: ExtensionManifest, saved: SavedUserConfig | null): boolean {
    const config = manifest.userConfig
    if (!config?.requiresConfig) return false
    return !saved || saved.version < config.version
}

export async function allExtensions(environment: ManageEnvironment, body: unknown) {
    const withUpdates = Boolean((body as { withUpdates?: unknown } | null)?.withUpdates)
    const installed = await installedOf(environment)
    const state = stateOf(environment)
    const invalid: InvalidExtension[] = [...installed.invalid]
    const invalidUserConfig: InvalidExtension[] = []
    const extensions: ExtensionManifest[] = []
    // the user's settings of all at once: one wait for the database instead of one per extension
    const saved = new Map(await Promise.all(installed.extensions
        .filter(manifest => manifest.userConfig?.requiresConfig)
        .map(async manifest => [manifest.id, await savedUserConfig(environment, manifest.id)] as const)))
    for (const manifest of installed.extensions) {
        const failed = state.failed.get(manifest.id)
        if (failed && failed.payload === manifest.payload) {
            invalid.push({ id: manifest.id, path: `extensions/${installed.files.get(manifest.id) ?? manifest.id}`, extension: withoutCode(manifest), reason: failed.reason, code: "invalid_payload" })
            continue
        }
        if (needsConfig(manifest, saved.get(manifest.id) ?? null)) {
            invalidUserConfig.push({ id: manifest.id, path: `extensions/${installed.files.get(manifest.id) ?? manifest.id}`, extension: withoutCode(manifest), reason: "the extension needs to be configured", code: "user_config_error" })
        }
        extensions.push(withoutCode(manifest))
    }
    return {
        extensions,
        invalidExtensions: invalid,
        disabledExtensions: installed.disabled.length ? installed.disabled.map(withoutCode) : null,
        invalidUserConfigExtensions: invalidUserConfig,
        hasUpdate: withUpdates ? await checkForUpdates(environment, installed.extensions) : null,
        unsafeExtensions: {},
    }
}

/** For each installed extension with a manifest on the web: a newer version there, with its code */
export async function checkForUpdates(environment: ManageEnvironment, extensions?: ExtensionManifest[]): Promise<UpdateData[]> {
    const list = extensions ?? (await installedOf(environment)).extensions
    const external = list.filter(extension => /^https?:\/\//.test(extension.manifestURI))
    const found = await Promise.all(external.map(async installed => {
        try {
            const latest = await fetchExtensionManifest(installed.manifestURI, environment.fetch)
            if (latest.id !== installed.id || latest.version === installed.version) return null
            return { extensionID: installed.id, manifestURI: installed.manifestURI, version: latest.version, payload: latest.payload }
        }
        catch {
            // a manifest that cannot be fetched now is no update
            return null
        }
    }))
    const updates = found.filter((update): update is UpdateData => update !== null)
    stateOf(environment).updates = updates
    return updates
}

export function lastUpdateData(environment: ManageEnvironment): UpdateData[] | null {
    return stateOf(environment).updates
}

export async function torrentProviders(environment: ManageEnvironment) {
    return (await loadedOfType(environment, "anime-torrent-provider")).map(({ manifest, settings }) => ({ id: manifest.id, name: manifest.name, lang: manifest.lang, settings }))
}

export async function mangaProviders(environment: ManageEnvironment) {
    return (await loadedOfType(environment, "manga-provider")).map(({ manifest, settings }) => ({ id: manifest.id, name: manifest.name, lang: manifest.lang, settings }))
}

export async function onlinestreamProviders(environment: ManageEnvironment) {
    return (await loadedOfType(environment, "onlinestream-provider")).map(({ manifest, settings }) => {
        const { episodeServers, supportsDub } = (settings ?? {}) as { episodeServers?: unknown, supportsDub?: unknown }
        return { id: manifest.id, name: manifest.name, lang: manifest.lang, episodeServers: Array.isArray(episodeServers) ? episodeServers.map(String) : [], supportsDub: supportsDub === true }
    })
}

/** Custom sources with the number the server gave them; one without a number yet is left out (the server gives it, §4l) */
export async function customSources(environment: ManageEnvironment) {
    const loaded = await loadedOfType(environment, "custom-source")
    if (!loaded.length) return []
    const numbers = await environment.place.customSourceNumbers()
    return loaded.filter(({ manifest }) => Number.isFinite(numbers[manifest.id]))
        .map(({ manifest, settings }) => ({ id: manifest.id, extensionIdentifier: numbers[manifest.id], name: manifest.name, lang: manifest.lang, settings }))
}

function idOf(request: CoreRequest): string {
    const id = request.path.id ?? (request.body as { id?: unknown } | null)?.id
    if (typeof id !== "string" || !id) throw new CoreError("the extension ID is missing")
    return id
}

export async function extensionPayload(environment: ManageEnvironment, request: CoreRequest): Promise<string> {
    const id = idOf(request)
    const installed = await installedOf(environment)
    const manifest = find(installed.extensions, id) ?? find(installed.disabled, id)
    if (!manifest) throw new CoreError("extension not found")
    return manifest.payload
}

export async function extensionUserConfig(environment: ManageEnvironment, request: CoreRequest) {
    const id = idOf(request)
    const installed = await installedOf(environment)
    const manifest = find(installed.extensions, id) ?? find(installed.disabled, id)
    if (!manifest) throw new CoreError("extension not found")
    return { userConfig: manifest.userConfig ?? null, savedUserConfig: await savedUserConfig(environment, id) }
}

export async function saveExtensionUserConfig(environment: ManageEnvironment, body: unknown): Promise<true> {
    const { id, version, values } = (body ?? {}) as { id?: unknown, version?: unknown, values?: unknown }
    if (typeof id !== "string" || !id) throw new CoreError("the extension ID is missing")
    const saved = savedFrom({ version, values })
    if (!saved) throw new CoreError("the settings must have a version and values")
    const installed = await installedOf(environment)
    if (!find(installed.extensions, id) && !find(installed.disabled, id)) throw new CoreError("extension not found")
    const database = await environment.database()
    const now = environment.now()
    await database.insert(extensionUserConfigs).values({ id, version: saved.version, values: saved.values, origin: "core", changedAt: now })
        .onConflictDoUpdate({ target: extensionUserConfigs.id, set: { version: saved.version, values: saved.values, origin: "core", changedAt: now } })
    // the next use opens the sandbox with the new values
    await reloadExtension(environment, { id })
    return true
}

export async function reloadExtension(environment: ManageEnvironment, body: unknown): Promise<true> {
    const { id } = (body ?? {}) as { id?: unknown }
    if (typeof id !== "string" || !id) throw new CoreError("the extension ID is missing")
    const state = stateOf(environment)
    state.settings.delete(id)
    state.failed.delete(id)
    await state.loader.close(id)
    await (await environment.database()).delete(extensionSettings).where(eq(extensionSettings.id, id))
    return true
}

const MARKETPLACE_FIELDS = ["id", "name", "version", "manifestURI", "language", "type", "description", "author", "icon", "website", "readme", "lang"] as const

/** The marketplace's list as the server answers it: the fields of the recording, code left out */
export async function marketplaceExtensions(environment: ManageEnvironment, query: unknown): Promise<ExtensionManifest[]> {
    const named = (query as { marketplace?: unknown } | null)?.marketplace
    const url = typeof named === "string" && named ? named : DEFAULT_MARKETPLACE_URL
    if (!/^https?:\/\//.test(url)) throw new CoreError("the marketplace address must start with http:// or https://")
    let parsed: unknown
    try {
        const response = await environment.fetch(url, { method: "GET", signal: AbortSignal.timeout(30_000) })
        if (response.status >= 400) throw new Error(`the marketplace answered ${response.status}`)
        parsed = JSON.parse(await response.text())
    }
    catch (error) {
        throw new CoreError(`failed to get marketplace extensions, ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!Array.isArray(parsed)) throw new CoreError("failed to get marketplace extensions, the list is not an array")
    return parsed.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object").map(entry => {
        const manifest = Object.fromEntries(MARKETPLACE_FIELDS.map(field => [field, typeof entry[field] === "string" ? entry[field] : ""]))
        return { ...manifest, payload: "" } as ExtensionManifest
    })
}

/** For tests and the app's end: closes every open sandbox of a place */
export async function closeExtensionSandboxes(place: ExtensionPlace): Promise<void> {
    await states.get(place)?.loader.closeAll()
}

/** How many sandboxes of a place are open (tests) */
export function openExtensionSandboxes(place: ExtensionPlace): number {
    return states.get(place)?.loader.openCount ?? 0
}

/** The loader of a place, for install.ts and the practice run */
export function loaderOf(environment: ManageEnvironment): ExtensionLoader {
    return stateOf(environment).loader
}
