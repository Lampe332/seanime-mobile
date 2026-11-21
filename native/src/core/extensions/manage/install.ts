// geschrieben nach: Aufzeichnungen EXTENSIONS.InstallExternalExtension, InstallExternalExtensionRepository (Vorschau und Installieren), UninstallExternalExtension, UpdateExtensionCode und SetExternalExtensionDisabled (13.11.2026: Anfrage, Antwort, Zustand davor und danach), dem Format des Erweiterungs-Ordners eines Servers (`<id>.json`, Manifest mit Code) und seines Datei-Caches `extension-settings`, und docs/EIGENER-KERN.md §4l; kein Server-Quelltext

import { CoreError } from "../../errors"
import { emitCoreEvent } from "../../events"
import { type ExtensionManifest, fetchExtensionManifest } from "../fetch-manifest"
import { fileOf, forgetRead, readInstalled, writeDisabled } from "./installed"
import { PROVIDER } from "./loader"
import { type ManageEnvironment, loaderOf, preferencesOf, reloadExtension, rememberSettings, savedUserConfig } from "./manage"

/*
 * Installing, updating, editing, uninstalling and switching off, in the core (phase 3e-2, `CORE_ROUTES`). An extension
 * is written as the server writes it: `<id>.json` in its extensions folder, the manifest with the code in `payload`;
 * switched off in its file cache `extension-settings`. So the server reads it unchanged when the area is switched off.
 *
 * Before a file is installed the code is loaded once in a sandbox of its own (TypeScript taken out, `new Provider()`)
 * and asked for its settings: code that does not load is not installed, and the lists need no sandbox afterwards.
 *
 * After each change the screens are told to read the lists again.
 */

/** The screens read the lists again (the event the server sent after such a change) */
function changed(): void {
    emitCoreEvent("extensions-reloaded")
}

/** Loads the code in a trial sandbox; returns the preferences it was opened with and what getSettings() gave */
async function tryLoad(environment: ManageEnvironment, manifest: ExtensionManifest) {
    if (manifest.type === "plugin") throw new CoreError("plugins do not run in this app")
    const loader = loaderOf(environment)
    const trial = { ...manifest, id: `${manifest.id}#trial` }
    const preferences = preferencesOf(manifest, await savedUserConfig(environment, manifest.id))
    try {
        return await loader.use(trial, preferences, async sandbox => {
            // settings that cannot be asked do not stop the install; the lists ask again
            const settings = await sandbox.call<unknown>(`${PROVIDER}.getSettings`).then(value => ({ value }), () => null)
            return { preferences, settings }
        })
    }
    catch (error) {
        throw new CoreError(`failed to load extension code, ${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
        await loader.close(trial.id)
    }
}

function stored(manifest: ExtensionManifest): string {
    return JSON.stringify(manifest, null, 2)
}

/** Writes a checked manifest to its file and makes the core and the server use it */
async function place(environment: ManageEnvironment, manifest: ExtensionManifest, file: string, loaded: Awaited<ReturnType<typeof tryLoad>>): Promise<void> {
    await environment.place.folder.write(file, stored(manifest))
    forgetRead(environment.place)
    await reloadExtension(environment, { id: manifest.id })
    if (loaded.settings) await rememberSettings(environment, manifest, file, loaded.preferences, loaded.settings.value)
    changed()
}

async function installManifest(environment: ManageEnvironment, manifest: ExtensionManifest): Promise<void> {
    const loaded = await tryLoad(environment, manifest)
    // an installed one keeps its file (the server names new ones `<id>.json`)
    const file = (await readInstalled(environment.place)).files.get(manifest.id) ?? fileOf(manifest.id)
    await place(environment, manifest, file, loaded)
}

/** `POST /api/v1/extensions/external/install` (also the screens' "update": the manifest fetched again, written over) */
export async function installExtension(environment: ManageEnvironment, manifestUri: string): Promise<{ message: string }> {
    const manifest = await fetchExtensionManifest(manifestUri, environment.fetch)
    await installManifest(environment, manifest)
    return { message: `Successfully installed ${manifest.name}` }
}

/** The repository file: `{ name, urls: [<manifest addresses>] }` (§6, tried on the server's preview) */
async function repositoryUrls(environment: ManageEnvironment, repositoryUri: string): Promise<string[]> {
    if (!/^https?:\/\//.test(repositoryUri)) throw new CoreError("the repository address must start with http:// or https://")
    let parsed: unknown
    try {
        const response = await environment.fetch(repositoryUri, { method: "GET", signal: AbortSignal.timeout(30_000) })
        if (response.status >= 400) throw new Error(`the repository answered ${response.status}`)
        parsed = JSON.parse(await response.text())
    }
    catch (error) {
        throw new CoreError(`failed to fetch repository, ${error instanceof Error ? error.message : String(error)}`)
    }
    const urls = (parsed as { urls?: unknown } | null)?.urls
    if (!Array.isArray(urls)) throw new CoreError("failed to fetch repository, it lists no extensions")
    return urls.filter((url): url is string => typeof url === "string" && url.length > 0)
}

/** An extension of a repository that could not be installed: its name (or its manifest link) and why */
export type RepositoryInstallFailure = { name: string, reason: string }

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * `POST /api/v1/extensions/external/install-repository`: `install: false` fetches the manifests (the preview),
 * `install: true` installs them; both answer the manifests with their code, as recorded. A manifest that cannot be
 * fetched is left out of the preview. Installing, the others are still installed, and the answer also lists in
 * `failed` each one that could not be fetched or loaded (the server left them out silently, so "Install all" always
 * looked like a success).
 */
export async function installRepository(environment: ManageEnvironment, body: unknown): Promise<{ extensions: ExtensionManifest[], message: string, failed?: RepositoryInstallFailure[] }> {
    const { repositoryUri, install } = (body ?? {}) as { repositoryUri?: unknown, install?: unknown }
    if (typeof repositoryUri !== "string" || !repositoryUri) throw new CoreError("the repository address is missing")
    const urls = await repositoryUrls(environment, repositoryUri)
    const failed: RepositoryInstallFailure[] = []
    const fetched = (await Promise.all(urls.map(url => fetchExtensionManifest(url, environment.fetch).catch(error => {
        failed.push({ name: url, reason: reasonOf(error) })
        return null
    })))).filter((manifest): manifest is ExtensionManifest => manifest !== null)
    if (install !== true) return { extensions: fetched, message: `Successfully fetched ${fetched.length} extensions from the repository` }
    const installed: ExtensionManifest[] = []
    // one after the other: each writes the folder
    for (const manifest of fetched) {
        try {
            await installManifest(environment, manifest)
            installed.push(manifest)
        }
        catch (error) {
            failed.push({ name: manifest.name || manifest.id, reason: reasonOf(error) })
        }
    }
    const total = installed.length + failed.length
    return {
        extensions: installed,
        message: failed.length ? `Installed ${installed.length} of ${total} extensions from the repository, ${failed.length} failed` : `Successfully installed ${installed.length} extensions from the repository`,
        failed,
    }
}

/** Fetches the extension's manifest again and writes it, when it is a different version */
export async function updateExtension(environment: ManageEnvironment, id: string): Promise<{ message: string }> {
    const installed = await readInstalled(environment.place)
    const current = [...installed.extensions, ...installed.disabled].find(extension => extension.id === id)
    const file = installed.files.get(id)
    if (!current || !file) throw new CoreError("extension not found")
    if (!/^https?:\/\//.test(current.manifestURI)) throw new CoreError("the extension has no manifest on the web")
    const latest = await fetchExtensionManifest(current.manifestURI, environment.fetch)
    if (latest.id !== id) throw new CoreError(`the manifest is of another extension (${latest.id})`)
    if (latest.version === current.version) return { message: `${current.name} is up to date` }
    await place(environment, latest, file, await tryLoad(environment, latest))
    return { message: `Successfully updated ${latest.name}` }
}

/**
 * `POST /api/v1/extensions/external/edit-payload`: the user's own code, saved in the same file. Not tried first: code
 * that does not load is kept and listed as invalid, so it can be edited again.
 */
export async function editExtensionCode(environment: ManageEnvironment, body: unknown): Promise<true> {
    const { id, payload } = (body ?? {}) as { id?: unknown, payload?: unknown }
    if (typeof id !== "string" || !id) throw new CoreError("the extension ID is missing")
    if (typeof payload !== "string") throw new CoreError("the code is missing")
    const installed = await readInstalled(environment.place)
    const current = [...installed.extensions, ...installed.disabled].find(extension => extension.id === id)
    const file = installed.files.get(id)
    if (!current || !file) throw new CoreError("extension not found")
    await place(environment, { ...current, payload }, file, { preferences: {}, settings: null })
    return true
}

/** `POST /api/v1/extensions/external/disabled` */
export async function setExtensionDisabled(environment: ManageEnvironment, body: unknown): Promise<true> {
    const { id, disabled } = (body ?? {}) as { id?: unknown, disabled?: unknown }
    if (typeof id !== "string" || !id) throw new CoreError("the extension ID is missing")
    if (typeof disabled !== "boolean") throw new CoreError("disabled must be true or false")
    const installed = await readInstalled(environment.place)
    if (!installed.files.has(id)) throw new CoreError("extension not found")
    await writeDisabled(environment.place, id, disabled, environment.now())
    forgetRead(environment.place)
    // a switched off extension's sandbox is closed; switched on, it is opened when it is next used
    await loaderOf(environment).close(id)
    changed()
    return true
}

/** `POST /api/v1/extensions/external/uninstall` */
export async function uninstallExtension(environment: ManageEnvironment, id: string): Promise<true> {
    const installed = await readInstalled(environment.place)
    const file = installed.files.get(id) ?? installed.invalid.find(entry => entry.id === id)?.path.replace(/^extensions\//, "")
    if (!file) throw new CoreError("extension not found")
    await reloadExtension(environment, { id })
    await environment.place.folder.remove(file)
    forgetRead(environment.place)
    changed()
    return true
}
