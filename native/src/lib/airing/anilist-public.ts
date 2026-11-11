import { getServerBaseUrl } from "@/api/client/server-url"
import { storage } from "@/lib/storage"

/*
 * The public AniList list of the logged-in user, read straight from AniList like the old notifier and widget did
 * (AiringNotifier.kt, AnimeListService.kt): they run while the app and its server may be off (background task, widget),
 * so only the user name comes from the local server, and the last one is remembered.
 */

const USER_KEY = "seanime-mobile-anilist-user"
const userIdKey = (name: string) => `seanime-mobile-anilist-user-id:${name}`

export class NoAniListUserError extends Error {
    constructor() {
        super("no AniList user")
    }
}

/** AniList name the local server reported last. */
export function knownUser(): string | null {
    return storage.getString(USER_KEY) ?? null
}

export function rememberUser(name: string) {
    if (name && name !== knownUser()) storage.set(USER_KEY, name)
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    try {
        return await run(controller.signal)
    }
    finally {
        clearTimeout(timer)
    }
}

/** The local server's AniList user (none for the simulated user); a booting server gets several attempts. */
export async function serverUser(attempts: number, pauseMs: number): Promise<string | null> {
    for (let i = 0; i < attempts; i++) {
        try {
            const body = await withTimeout(3000, signal => fetch(`${getServerBaseUrl()}/api/v1/status`, {
                signal, headers: { Origin: getServerBaseUrl(), Accept: "application/json" },
            }).then(res => res.json()))
            const user = body?.data?.user
            if (user && !user.isSimulated && typeof user.viewer?.name === "string" && user.viewer.name) return user.viewer.name
            // the server answered: it has no AniList user, waiting does not help
            if (body?.data) return null
        }
        catch {
            // not up yet
        }
        if (i < attempts - 1) await sleep(pauseMs)
    }
    return null
}

/** The user to read the list of: the server's (remembered), else the last one; without either NoAniListUserError. */
export async function resolveUser(attemptsWithoutKnown: number, pauseMs: number): Promise<string> {
    const known = knownUser()
    const name = await serverUser(known ? 1 : attemptsWithoutKnown, pauseMs)
    if (name) {
        rememberUser(name)
        return name
    }
    if (known) return known
    throw new NoAniListUserError()
}

export async function anilist<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await withTimeout(8000, signal => fetch("https://graphql.anilist.co", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
    }))
    if (!res.ok) throw new Error(`AniList HTTP ${res.status}`)
    const body = await res.json()
    if (body?.errors?.length) throw new Error(body.errors[0]?.message ?? "AniList error")
    return body.data as T
}

/** AniList id of a user name, cached. */
export async function userId(name: string): Promise<number> {
    const cached = storage.getNumber(userIdKey(name))
    if (cached && cached > 0) return cached
    const data = await anilist<{ User: { id: number } }>("query ($name: String) { User(name: $name) { id } }", { name })
    storage.set(userIdKey(name), data.User.id)
    return data.User.id
}

/** AniList id of a MyAnimeList anime (null when AniList does not know it). */
export async function anilistIdFromMal(malId: number): Promise<number | null> {
    try {
        const data = await anilist<{ Media: { id: number } | null }>("query ($id: Int) { Media(idMal: $id, type: ANIME) { id } }", { id: malId })
        return data.Media?.id ?? null
    }
    catch {
        return null
    }
}

type ListMedia<N> = { id: number, title: { userPreferred: string }, coverImage?: { medium?: string | null }, nextAiringEpisode: N | null }
type Lists<N> = { MediaListCollection: { lists: { entries: { media: ListMedia<N> }[] }[] } }

/** Every media of the lists once, with its next episode. */
export function listMedia<N>(data: Lists<N>): (ListMedia<N> & { nextAiringEpisode: N })[] {
    const seen = new Set<number>()
    const out: (ListMedia<N> & { nextAiringEpisode: N })[] = []
    for (const list of data.MediaListCollection?.lists ?? []) {
        for (const entry of list?.entries ?? []) {
            const media = entry?.media
            if (!media?.nextAiringEpisode || seen.has(media.id)) continue
            seen.add(media.id)
            out.push(media as ListMedia<N> & { nextAiringEpisode: N })
        }
    }
    return out
}

export type AiringFetch = Lists<{ airingAt: number, episode: number }>
export type UpcomingFetch = Lists<{ timeUntilAiring: number, episode: number }>

/** Watching and rewatching only (the notifier). */
export const AIRING_QUERY = `
query ($userId: Int) {
    MediaListCollection(userId: $userId, type: ANIME, status_in: [CURRENT, REPEATING]) {
        lists { entries { media { id title { userPreferred } nextAiringEpisode { airingAt episode } } } }
    }
}`

/** The whole anime list (the widget). */
export const UPCOMING_QUERY = `
query ($userId: Int) {
    MediaListCollection(userId: $userId, type: ANIME) {
        lists { entries { media { id title { userPreferred } coverImage { medium } nextAiringEpisode { timeUntilAiring episode } } } }
    }
}`
