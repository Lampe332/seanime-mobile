// geschrieben nach: Seanime_Jellyfin_Plan.md §4 (Pfade, Abfrage-Felder, Kopfzeile) und den Feldern aus Jellyfin BaseItemDto.cs [J8], MediaStream.cs [J13], AuthenticationResult.cs [J3]; kein Server gefragt

import type { HttpFetch } from "../anilist/client"

/*
 * The client of a Jellyfin server: the Authorization line, the calls for signing in, series, seasons and episodes, and
 * their answers in the app's form. `fetch` is handed in like the environment's (core/library/metadata.ts); nothing here
 * keeps state. Own rules:
 *
 * - Every call carries `Authorization: MediaBrowser Client=…, Device=…, DeviceId=…, Version=…, Token=…`, the five fields
 *   the server reads [J1]. Before signing in there is no token: the line then ends after `Version`.
 * - The token never goes into an address. A quote in a value cannot be written in the line and becomes `'`.
 * - The server's address may carry a sub path (`https://host/jellyfin`); a trailing slash is dropped.
 * - Any status other than 200, an answer that is not JSON or a timeout after 10 s: `JellyfinFailure`.
 * - One server at a time, but everything carries the server's id (`ServerId` of the sign-in).
 */

type Json = Record<string, unknown>

export const JELLYFIN_CLIENT = "Seanime Mobile"
const JELLYFIN_TIMEOUT_MS = 10_000

/** Who asks: the app on this device */
export interface JellyfinIdentity {
    device: string
    deviceId: string
    version: string
}

/** A signed-in server */
export interface JellyfinSession {
    serverId: string
    url: string
    userId: string
    token: string
    identity: JellyfinIdentity
}

export interface JellyfinSeries {
    serverId: string
    id: string
    type: string
    name: string
    year: number
    providerIds: Record<string, string>
    path: string
}

export interface JellyfinSeason {
    id: string
    seriesId: string
    /** `IndexNumber`; 0 = specials, null when the server has none */
    index: number | null
    name: string
    year: number
    providerIds: Record<string, string>
}

export interface JellyfinStream {
    index: number
    type: string
    language: string
    isExternal: boolean
}

export interface JellyfinMediaSource {
    id: string
    container: string
    streams: JellyfinStream[]
}

export interface JellyfinEpisode {
    id: string
    seriesId: string
    seasonId: string
    /** `ParentIndexNumber`: the season's number, null when the server has none */
    season: number | null
    /** `IndexNumber`: the episode's number in its season, null when the server has none */
    index: number | null
    name: string
    providerIds: Record<string, string>
    mediaSources: JellyfinMediaSource[]
}

/** The server could not be asked or did not answer usefully */
export class JellyfinFailure extends Error {
    readonly status: number

    constructor(message: string, status: number) {
        super(message)
        this.name = "JellyfinFailure"
        this.status = status
    }
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === "string" ? value : "")
const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null)
const quoted = (value: string) => `"${value.replace(/"/g, "'")}"`

/** The Authorization line; without a token (before signing in) the `Token` field is left out */
export function authorizationHeader(identity: JellyfinIdentity, token?: string): string {
    const fields = [
        `Client=${quoted(JELLYFIN_CLIENT)}`,
        `Device=${quoted(identity.device)}`,
        `DeviceId=${quoted(identity.deviceId)}`,
        `Version=${quoted(identity.version)}`,
    ]
    if (token) fields.push(`Token=${quoted(token)}`)
    return `MediaBrowser ${fields.join(", ")}`
}

/** The address of a path on the server, with its query (empty values left out) */
export function jellyfinUrl(base: string, path: string, query: Record<string, string | number | boolean | undefined> = {}): string {
    const pairs = Object.entries(query)
        .filter((pair): pair is [string, string | number | boolean] => pair[1] !== undefined && pair[1] !== "")
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    return base.replace(/\/+$/, "") + path + (pairs.length ? `?${pairs.join("&")}` : "")
}

async function ask(fetch: HttpFetch, url: string, authorization: string, method = "GET", body?: Json): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), JELLYFIN_TIMEOUT_MS)
    // the time limit holds even for a fetch that does not listen to the signal
    const late = new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new JellyfinFailure("Jellyfin did not answer in time", 0))))
    try {
        const headers: Record<string, string> = { Accept: "application/json", Authorization: authorization }
        if (body) headers["Content-Type"] = "application/json"
        const response = await Promise.race([fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal }), late])
        if (response.status !== 200) throw new JellyfinFailure(`Jellyfin answered ${response.status}`, response.status)
        return JSON.parse(await Promise.race([response.text(), late]))
    }
    catch (error) {
        if (error instanceof JellyfinFailure) throw error
        throw new JellyfinFailure(error instanceof Error ? error.message : "Jellyfin could not be asked", 0)
    }
    finally {
        clearTimeout(timer)
    }
}

function providerIdsOf(raw: unknown): Record<string, string> {
    const ids: Record<string, string> = {}
    if (!isRecord(raw)) return ids
    for (const [key, value] of Object.entries(raw)) if (typeof value === "string" && value !== "") ids[key] = value
    return ids
}

/** A provider id by its key, case ignored ("Tvdb", "AniList", "AniDB", …) */
export function providerId(ids: Record<string, string>, key: string): string {
    const wanted = key.toLowerCase()
    for (const [name, value] of Object.entries(ids)) if (name.toLowerCase() === wanted) return value
    return ""
}

const itemsOf = (raw: unknown): Json[] => (isRecord(raw) && Array.isArray(raw.Items) ? raw.Items.filter(isRecord) : [])

export function seriesOf(serverId: string, raw: Json): JellyfinSeries {
    return {
        serverId,
        id: text(raw.Id),
        type: text(raw.Type),
        name: text(raw.Name),
        year: count(raw.ProductionYear) ?? 0,
        providerIds: providerIdsOf(raw.ProviderIds),
        path: text(raw.Path),
    }
}

export function seasonOfItem(raw: Json): JellyfinSeason {
    return {
        id: text(raw.Id),
        seriesId: text(raw.SeriesId),
        index: count(raw.IndexNumber),
        name: text(raw.Name),
        year: count(raw.ProductionYear) ?? 0,
        providerIds: providerIdsOf(raw.ProviderIds),
    }
}

function mediaSourceOf(raw: Json): JellyfinMediaSource {
    const streams = Array.isArray(raw.MediaStreams) ? raw.MediaStreams.filter(isRecord) : []
    return {
        id: text(raw.Id),
        container: text(raw.Container),
        streams: streams.map(stream => ({
            index: count(stream.Index) ?? 0,
            type: text(stream.Type),
            language: text(stream.Language),
            isExternal: stream.IsExternal === true,
        })),
    }
}

export function episodeOfItem(raw: Json): JellyfinEpisode {
    return {
        id: text(raw.Id),
        seriesId: text(raw.SeriesId),
        seasonId: text(raw.SeasonId),
        season: count(raw.ParentIndexNumber),
        index: count(raw.IndexNumber),
        name: text(raw.Name),
        providerIds: providerIdsOf(raw.ProviderIds),
        mediaSources: (Array.isArray(raw.MediaSources) ? raw.MediaSources.filter(isRecord) : []).map(mediaSourceOf),
    }
}

/** Signs in with name and password (POST /Users/AuthenticateByName); the password is only sent, never kept */
export async function authenticateByName(
    fetch: HttpFetch, url: string, identity: JellyfinIdentity, username: string, password: string,
): Promise<JellyfinSession> {
    const raw = await ask(fetch, jellyfinUrl(url, "/Users/AuthenticateByName"), authorizationHeader(identity), "POST", { Username: username, Pw: password })
    const token = isRecord(raw) ? text(raw.AccessToken) : ""
    const user = isRecord(raw) && isRecord(raw.User) ? raw.User : {}
    const serverId = isRecord(raw) ? text(raw.ServerId) || text(user.ServerId) : ""
    if (!token || !text(user.Id)) throw new JellyfinFailure("Jellyfin sign-in answered without token or user", 200)
    return { serverId, url: url.replace(/\/+$/, ""), userId: text(user.Id), token, identity }
}

/** One page of the user's series and movies (GET /Items) */
export async function listSeries(
    fetch: HttpFetch, session: JellyfinSession, startIndex = 0, limit = 200,
): Promise<{ items: JellyfinSeries[], total: number }> {
    const raw = await ask(fetch, jellyfinUrl(session.url, "/Items", {
        userId: session.userId, includeItemTypes: "Series,Movie", recursive: true, fields: "ProviderIds,Path", startIndex, limit,
    }), authorizationHeader(session.identity, session.token))
    const items = itemsOf(raw).map(item => seriesOf(session.serverId, item))
    return { items, total: isRecord(raw) ? count(raw.TotalRecordCount) ?? items.length : items.length }
}

/** The seasons of a series (GET /Shows/{seriesId}/Seasons) */
export async function listSeasons(fetch: HttpFetch, session: JellyfinSession, seriesId: string): Promise<JellyfinSeason[]> {
    const raw = await ask(fetch, jellyfinUrl(session.url, `/Shows/${encodeURIComponent(seriesId)}/Seasons`, {
        userId: session.userId, fields: "ProviderIds",
    }), authorizationHeader(session.identity, session.token))
    return itemsOf(raw).map(seasonOfItem)
}

/** The episodes of a series that have a file, all seasons or one (GET /Shows/{seriesId}/Episodes) */
export async function listEpisodes(fetch: HttpFetch, session: JellyfinSession, seriesId: string, seasonId?: string): Promise<JellyfinEpisode[]> {
    const raw = await ask(fetch, jellyfinUrl(session.url, `/Shows/${encodeURIComponent(seriesId)}/Episodes`, {
        userId: session.userId, seasonId, fields: "ProviderIds,MediaSources", isMissing: false,
    }), authorizationHeader(session.identity, session.token))
    return itemsOf(raw).map(episodeOfItem)
}
