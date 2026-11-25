// geschrieben nach: Seanime_Jellyfin_Plan.md (Bau-Stück 3) und den Nakama-Routen in core/registry.ts

import { CoreError } from "../errors"
import type { CoreEnvironment } from "../registry"
import { JellyfinFailure, authenticateByName, publicServerInfo } from "./client"
import { type ServerOverview, refreshServerLibrary, removeServerMapping, saveServerMapping, saveServerSettings, serverOverview, serverSettingsOf } from "./source"

/*
 * The routes of the "Media server" settings page: sign in, sign out, the status, read again and the progress switch.
 * The password is only sent to the server; it is never kept, logged or written into an error. The token goes to the
 * safe store (saveServerSettings) and never into an answer. Errors carry their own words, never the server's.
 */

/** http:// or https://, a host, an optional sub path; nothing else */
const ADDRESS = /^https?:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/i

const field = (body: unknown, name: string) => {
    const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined
    return typeof value === "string" ? value : ""
}

const hostOf = (address: string) => address.replace(/^https?:\/\//i, "").split("/")[0]

/** A failure of the server in words the settings page shows; status 422: wrong login, 504: no answer, 502: no Jellyfin */
function failureOf(error: unknown): Error {
    if (error instanceof CoreError) return error
    if (!(error instanceof JellyfinFailure)) return new CoreError("Something went wrong while asking the server", 500)
    if (error.status === 401 || error.status === 403) return new CoreError("Wrong username or password", 422)
    if (error.status === 0) return new CoreError("The server did not answer. Check the address and that the server is running.", 504)
    if (error.status === 200 || error.status === 404) return new CoreError("No Jellyfin server answered at this address", 502)
    return new CoreError(`The server answered with an error (${error.status})`, 502)
}

/** Signs in with address, username and password; nothing changes when it fails */
export async function signInToServer(body: unknown, environment: CoreEnvironment): Promise<ServerOverview> {
    const url = field(body, "url").trim().replace(/\/+$/, "")
    const username = field(body, "username").trim()
    const password = field(body, "password")
    if (!ADDRESS.test(url)) throw new CoreError("The address must start with http:// or https:// and name a server", 400)
    if (!username) throw new CoreError("Enter a username", 400)
    if (!environment.keepSecret) throw new CoreError("This device cannot keep the server's sign-in safely", 500)
    const before = await serverSettingsOf(environment)
    const identity = {
        device: before.device || "Android",
        deviceId: before.deviceId || `${environment.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
        version: environment.appBuild?.() || before.version || "0",
    }
    let saved: Record<string, string>
    try {
        const info = await publicServerInfo(environment.fetch, url, identity)
        const session = await authenticateByName(environment.fetch, url, identity, username, password)
        saved = {
            token: session.token, serverId: session.serverId || info.serverId, serverName: info.name || hostOf(url),
            url: session.url, userId: session.userId, username, ...identity,
        }
    }
    catch (error) {
        throw failureOf(error)
    }
    await saveServerSettings(saved, environment)
    return serverOverview(environment)
}

/** Signs out: the token, the server's settings and the kept series go; hand-made matches stay */
export async function signOutOfServer(environment: CoreEnvironment): Promise<ServerOverview> {
    await saveServerSettings({ token: "", serverId: "", serverName: "", url: "", userId: "", username: "", sendProgress: false }, environment)
    return serverOverview(environment)
}

/** "Read again": reads the server now; when it fails the kept series stay */
export async function readServerAgain(environment: CoreEnvironment): Promise<ServerOverview> {
    try {
        await refreshServerLibrary(environment)
    }
    catch (error) {
        throw failureOf(error)
    }
    return serverOverview(environment)
}

/** POST /api/v1/mediaserver/mapping {itemId, mediaId, episodeOffset?}: a series or season given by hand; the new status */
export async function saveServerMatch(body: unknown, environment: CoreEnvironment): Promise<ServerOverview> {
    await saveServerMapping(body, environment)
    return serverOverview(environment)
}

/** DELETE /api/v1/mediaserver/mapping {itemId}: back to the automatic match; the new status */
export async function removeServerMatch(body: unknown, environment: CoreEnvironment): Promise<ServerOverview> {
    await removeServerMapping(field(body, "itemId"), environment)
    return serverOverview(environment)
}

/** The switch for sending progress to the server */
export async function setServerSendProgress(body: unknown, environment: CoreEnvironment): Promise<ServerOverview> {
    const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>).sendProgress : undefined
    if (typeof value !== "boolean") throw new CoreError("sendProgress must be true or false", 400)
    await saveServerSettings({ sendProgress: value }, environment)
    return serverOverview(environment)
}
