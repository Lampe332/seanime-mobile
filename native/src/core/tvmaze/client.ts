// geschrieben nach: öffentliche TVmaze-Doku (www.tvmaze.com/api: GET https://api.tvmaze.com/search/shows?q=…, /shows/{id}?embed=episodes, /shows/{id}/images, kein Schlüssel, Rate-Limit 20 Aufrufe je 10 s, 429 bei Überschreitung); kein Server-Quelltext

import type { HttpFetch } from "../anilist/client"
import type { CoreEnvironment } from "../registry"

/*
 * The client of TVmaze, the second source of titles (docs/EIGENER-KERN.md §4t): series AniList does not have. Public,
 * no key. TVmaze allows 20 requests in 10 seconds; the client keeps the requests of the window and waits before one
 * more would go over. A 429 is waited out (Retry-After, else the window) and the request sent again, at most RETRIES times.
 */

export const TVMAZE_URL = "https://api.tvmaze.com"

/** TVmaze could not be asked or did not answer usefully: network, timeout, 404, 5xx, rate limit */
export class TvmazeFailure extends Error {
    readonly status: number

    constructor(message: string, status: number) {
        super(message)
        this.name = "TvmazeFailure"
        this.status = status
    }
}

const WINDOW_MS = 10_000
const LIMIT = 20
const TIMEOUT_MS = 10_000
const RETRIES = 2
/** Longer than this a request does not wait; the kept answer is better */
const LONGEST_WAIT_MS = 15_000

export type TvmazeRateLimit = { sent: number[], blockedUntil: number }

export function newTvmazeRateLimit(): TvmazeRateLimit {
    return { sent: [], blockedUntil: 0 }
}

/** One for the app */
const shared = newTvmazeRateLimit()

export type TvmazeClient = {
    fetch: HttpFetch
    now: () => number
    sleep?: (milliseconds: number) => Promise<void>
    rateLimit?: TvmazeRateLimit
}

export function tvmazeClientFor(environment: Pick<CoreEnvironment, "fetch" | "now" | "sleep">): TvmazeClient {
    return { fetch: environment.fetch, now: environment.now, sleep: environment.sleep }
}

const sleepFor = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

/** How long to wait before the next request may go out; 0 when it may go now */
export function tvmazeWait(rateLimit: TvmazeRateLimit, now: number): number {
    rateLimit.sent = rateLimit.sent.filter(time => now - time < WINDOW_MS)
    let wait = Math.max(0, rateLimit.blockedUntil - now)
    if (rateLimit.sent.length >= LIMIT) wait = Math.max(wait, rateLimit.sent[rateLimit.sent.length - LIMIT] + WINDOW_MS - now)
    return wait
}

/** GET of a TVmaze path ("/shows/1"); the parsed JSON. Throws TvmazeFailure for everything that went wrong. */
export async function askTvmaze(client: TvmazeClient, path: string): Promise<unknown> {
    const rateLimit = client.rateLimit ?? shared
    const sleep = client.sleep ?? sleepFor
    for (let attempt = 0; ; attempt++) {
        const wait = tvmazeWait(rateLimit, client.now())
        if (wait > LONGEST_WAIT_MS) throw new TvmazeFailure("TVmaze's rate limit is reached", 429)
        rateLimit.sent.push(client.now() + wait)
        rateLimit.sent.sort((a, b) => a - b)
        if (wait > 0) await sleep(wait)

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        let status: number
        let text: string
        let retryAfter: string | null
        try {
            const response = await client.fetch(TVMAZE_URL + path, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal })
            status = response.status
            retryAfter = response.headers.get("Retry-After")
            text = await response.text()
        }
        catch {
            throw new TvmazeFailure("TVmaze could not be reached", 503)
        }
        finally {
            clearTimeout(timer)
        }

        if (status === 429) {
            const seconds = Number(retryAfter)
            rateLimit.blockedUntil = Math.max(rateLimit.blockedUntil, client.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : WINDOW_MS))
            if (attempt < RETRIES) continue
            throw new TvmazeFailure("TVmaze's rate limit is reached", 429)
        }
        if (status === 404) throw new TvmazeFailure("Not Found.", 404)
        if (status !== 200) throw new TvmazeFailure(`TVmaze answered ${status}`, status >= 400 ? status : 502)
        try {
            return JSON.parse(text) as unknown
        }
        catch {
            throw new TvmazeFailure("TVmaze's answer could not be read", 502)
        }
    }
}
