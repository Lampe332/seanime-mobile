// geschrieben nach: öffentliche AniList-Doku (docs.anilist.co: GraphQL über POST https://graphql.anilist.co, Rate-Limit 90/min, bei Störung 30/min, Kopfzeilen X-RateLimit-*, 429 mit Retry-After, Token als „Authorization: Bearer“, Fehler 400 mit „validation“ je Feld) und der Aufzeichnung api-anilist-schreibend vom 13.11.2026 (AniLists Prüf-Texte); kein Server-Quelltext

import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import { type CacheOnlyState, afterAnilist, mayAskAnilist, sharedCacheOnly } from "./cache-only"
import type { CoreEnvironment } from "../registry"

/*
 * Asking AniList: one GraphQL request over the network the app hands in. `askAnilist` reads and refuses a mutation;
 * `changeAnilist` is the one way a change goes out (changes.ts), and it needs the user's token.
 *
 * AniList allows 90 requests a minute (30 while it is degraded) and says how many are left in every answer. The client
 * keeps the requests of the last minute and waits before one more would go over the limit. When AniList answers 429 it
 * waits as long as `Retry-After` says and tries again. A wait that would be long is not made: the request counts as
 * "AniList cannot be reached now", and the answer comes from the core's own store instead (anilist.ts).
 */

export const ANILIST_URL = "https://graphql.anilist.co"

/** What the client needs of `fetch`. The app hands in the real one, the tests their own. */
export type HttpFetch = (
    url: string,
    init: { method?: string, headers?: Record<string, string>, body?: string, signal: AbortSignal },
) => Promise<{ status: number, headers: { get: (name: string) => string | null }, text: () => Promise<string> }>

/** AniList could not be asked or did not answer usefully: network, timeout, 5xx, rate limit, or an answer it refused. */
export class AnilistFailure extends Error {
    readonly status: number

    constructor(message: string, status: number) {
        super(message)
        this.name = "AnilistFailure"
        this.status = status
    }
}

const WINDOW_MS = 60_000
/** The limit until AniList says another one */
const DEFAULT_LIMIT = 90
/** Longer than this the user should not wait; the stored answer is better */
const LONGEST_WAIT_MS = 10_000
const TIMEOUT_MS = 15_000
/** How often a request is sent again after a 429 */
const RETRIES = 2

export type RateLimit = {
    /** Requests sent in the last minute (times) */
    sent: number[]
    limit: number
    /** No request before this time (after a 429, or when AniList said none are left) */
    blockedUntil: number
}

export function newRateLimit(): RateLimit {
    return { sent: [], limit: DEFAULT_LIMIT, blockedUntil: 0 }
}

/** One for the app: every answer of the core shares AniList's limit */
const shared = newRateLimit()

export type AnilistClient = {
    fetch: HttpFetch
    /** The user's AniList token, or null: then the request is a public one */
    token: () => Promise<string | null>
    now: () => number
    sleep?: (milliseconds: number) => Promise<void>
    /** Lets the screens' thread go between long steps (CoreEnvironment.pause); reading a large answer is one */
    pause?: (part?: string) => Promise<void>
    rateLimit?: RateLimit
    /** Cache-only mode (cache-only.ts); left out: the app's one */
    cacheOnly?: CacheOnlyState
}

const sleepFor = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

/** How long to wait before the next request may go out; 0 when it may go now */
export function waitBeforeNext(rateLimit: RateLimit, now: number): number {
    rateLimit.sent = rateLimit.sent.filter(time => now - time < WINDOW_MS)
    let wait = Math.max(0, rateLimit.blockedUntil - now)
    if (rateLimit.sent.length >= rateLimit.limit) wait = Math.max(wait, rateLimit.sent[rateLimit.sent.length - rateLimit.limit] + WINDOW_MS - now)
    return wait
}

function headerNumber(headers: { get: (name: string) => string | null }, name: string): number | null {
    const value = headers.get(name)
    if (value === null || value.trim() === "") return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
}

function isMutation(document: string): boolean {
    return /^\s*mutation\b/i.test(document.replace(/#[^\n]*/g, ""))
}

/** The client of an answer of the core: the app's network, the user's token from the secured storage */
export function clientFor(environment: Pick<CoreEnvironment, "fetch" | "secret" | "now" | "pause" | "sleep">): AnilistClient {
    return { fetch: environment.fetch, token: () => environment.secret(ACCOUNT_TOKEN_SECRET), now: environment.now, pause: environment.pause, sleep: environment.sleep }
}

/** The longest wait for the rate limit when nothing is kept to answer with: AniList's minute and a little */
const LONGEST_WAIT_WITHOUT_STORE_MS = WINDOW_MS + 5_000

/**
 * Nothing kept to answer with (a first schedule page after a busy start, while AniList allows 30 a minute): waiting for
 * the rate limit is better than no answer. Waits until a request may go out again; false when that would take longer
 * than a minute (then the request fails as before).
 */
export async function waitForRateLimit(client: AnilistClient): Promise<boolean> {
    const wait = waitBeforeNext(client.rateLimit ?? shared, client.now())
    if (wait > LONGEST_WAIT_WITHOUT_STORE_MS) return false
    if (wait > 0) await (client.sleep ?? sleepFor)(wait)
    return true
}

/** Sends one query and returns what AniList put under "data". Throws AnilistFailure for everything that went wrong. */
export async function askAnilist(client: AnilistClient, document: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (isMutation(document)) throw new Error("the core only reads from AniList here; a change goes through changeAnilist")
    return send(client, document, variables)
}

/**
 * Sends one mutation: the same way, under the same rate limit. Without a token nothing is sent. A failure with a status
 * of 400 to 499 means AniList refused the change itself; anything else means it could not be asked now.
 */
export async function changeAnilist(client: AnilistClient, document: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!isMutation(document)) throw new Error("changeAnilist sends mutations only")
    if (!(await client.token())) throw new AnilistFailure("not logged in to AniList", 401)
    return send(client, document, variables)
}

/** Nothing goes out in cache-only mode; every answer and failure tells the mode whether AniList works */
async function send(client: AnilistClient, document: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const cacheOnly = client.cacheOnly ?? sharedCacheOnly
    if (!mayAskAnilist(cacheOnly)) throw new AnilistFailure("cache-only mode is on, AniList is not asked", 503)
    try {
        const data = await sendNow(client, document, variables)
        afterAnilist(cacheOnly, null)
        return data
    }
    catch (error) {
        if (error instanceof AnilistFailure) afterAnilist(cacheOnly, error.status)
        throw error
    }
}

async function sendNow(client: AnilistClient, document: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const rateLimit = client.rateLimit ?? shared
    const sleep = client.sleep ?? sleepFor
    const token = await client.token()
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" }
    if (token) headers.Authorization = `Bearer ${token}`
    const body = JSON.stringify({ query: document, variables })

    for (let attempt = 0; ; attempt++) {
        const wait = waitBeforeNext(rateLimit, client.now())
        if (wait > LONGEST_WAIT_MS) throw new AnilistFailure("AniList's rate limit is reached", 429)
        if (wait > 0) await sleep(wait)
        rateLimit.sent.push(client.now())

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        let status: number
        let text: string
        let answerHeaders: { get: (name: string) => string | null }
        try {
            const response = await client.fetch(ANILIST_URL, { method: "POST", headers, body, signal: controller.signal })
            status = response.status
            answerHeaders = response.headers
            text = await response.text()
        }
        catch {
            // the text of a network error is the runtime's; it is not passed on
            throw new AnilistFailure("AniList could not be reached", 503)
        }
        finally {
            clearTimeout(timer)
        }

        const limit = headerNumber(answerHeaders, "X-RateLimit-Limit")
        if (limit !== null && limit > 0) rateLimit.limit = limit
        const left = headerNumber(answerHeaders, "X-RateLimit-Remaining")
        const reset = headerNumber(answerHeaders, "X-RateLimit-Reset")
        if (left === 0) rateLimit.blockedUntil = Math.max(rateLimit.blockedUntil, reset !== null ? reset * 1000 : client.now() + WINDOW_MS)

        if (status === 429) {
            const seconds = headerNumber(answerHeaders, "Retry-After") ?? 60
            rateLimit.blockedUntil = Math.max(rateLimit.blockedUntil, client.now() + seconds * 1000)
            if (attempt < RETRIES) continue
            throw new AnilistFailure("AniList's rate limit is reached", 429)
        }
        if (status >= 500) throw new AnilistFailure(`AniList answered ${status}`, status)

        await client.pause?.("reading AniList's answer")
        let parsed: { data?: Record<string, unknown> | null, errors?: { message?: string, status?: number, validation?: Record<string, unknown> }[] }
        try {
            parsed = JSON.parse(text) as typeof parsed
        }
        catch {
            throw new AnilistFailure("AniList's answer could not be read", status >= 400 ? status : 502)
        }
        if (parsed.errors?.length || !parsed.data || status >= 400) {
            const first = parsed.errors?.[0]
            // a refused change says why, field by field ("The score raw must be an integer."): the text worth showing
            const reasons = Object.values(first?.validation ?? {}).flat().filter((reason): reason is string => typeof reason === "string").join(" ")
            throw new AnilistFailure(reasons || first?.message || `AniList answered ${status}`, first?.status ?? (status >= 400 ? status : 500))
        }
        return parsed.data
    }
}
