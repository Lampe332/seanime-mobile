// geschrieben nach: aufgezeichnete Antworten vom 13.11.2026 (ANILIST.*, MANGA.GetRawAnilistMangaCollection*, MANGA.AnilistListManga: Form, weggelassene leere Felder, Fehlertext „no cached data available“), App-Code src/api/generated (Adressen, Variablen der Anfragen) und der öffentlichen AniList-Doku; kein Server-Quelltext

import { eq } from "drizzle-orm"
import { account } from "../database/schema"
import { CoreError } from "../errors"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { ownSettingsAndLook } from "../settings/settings"
import { isTvmazeId, tvmazeMedia } from "../tvmaze/tvmaze"
import { listsWithWaitingChanges, localCollection, sendWaitingChanges, withoutAnilistAccount } from "./changes"
import { AnilistFailure, askAnilist, clientFor, waitForRateLimit } from "./client"
import {
    ANIME_DETAILS,
    LIST_ANIME,
    LIST_ANIME_VARIABLES,
    LIST_MANGA,
    LIST_MANGA_VARIABLES,
    LIST_RECENT_AIRING,
    LIST_RECENT_AIRING_VARIABLES,
    STUDIO_DETAILS,
    VIEWER_NAME,
    VIEWER_STATS,
    collectionQuery,
    collectionTagsQuery,
} from "./queries"
import {
    type ListCollection,
    type ListKind,
    keepAnswer,
    keepCollection,
    keepDetails,
    storedAnswer,
    storedCollection,
    storedDetails,
    withoutEmpty,
} from "./store"

/*
 * The area `anilist`: what the app reads from AniList, answered by the core (docs/EIGENER-KERN.md §4d). What the app
 * changes on AniList is in changes.ts (§4f).
 *
 * Every answer read from AniList is kept in the core's own store. When AniList cannot be asked (no network, down, rate
 * limit, an answer it refuses), the core answers with what it kept last. Only when it has nothing kept it fails, with the
 * text the server gives in that case.
 */

type Json = Record<string, unknown>

/** The recorded error of the server when AniList failed and nothing was kept (GetAnilistStudioDetails.unknown-id) */
export const NOTHING_KEPT = "no cached data available"

export { withoutEmpty }

/** The statistics keep their empty lists (recorded: "genres": []); only null goes */
function withoutNull(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutNull)
    if (value === null || typeof value !== "object") return value
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null && field !== undefined).map(([key, field]) => [key, withoutNull(field)]))
}

/**
 * "Turn off AniList caching" (settings anilist.disableCacheLayer): a read AniList fails is not answered from the store.
 * Answers are still kept: the store is also the core's own lists and the queue of changes works on them (changes.ts).
 */
async function cacheLayerOff(environment: CoreEnvironment): Promise<boolean> {
    const settings = (await ownSettingsAndLook(await environment.database())).settings
    const anilist = settings?.anilist
    return typeof anilist === "object" && anilist !== null && (anilist as Json).disableCacheLayer === true
}

/** How often a read with nothing kept waits for AniList's rate limit before it fails */
const RATE_LIMIT_WAITS = 3

/**
 * Asks AniList and keeps the answer; when AniList fails, gives what was kept (not with the caching turned off). Failing to keep an answer does not cost
 * the user the answer.
 */
export async function readThrough<T>(
    environment: CoreEnvironment,
    ask: () => Promise<T>,
    keep: (answer: T) => Promise<void>,
    kept: () => Promise<T | null>,
): Promise<T> {
    let answer: T
    try {
        answer = await ask()
    }
    catch (error) {
        if (!(error instanceof AnilistFailure)) throw error
        const stored = (await cacheLayerOff(environment)) ? null : await kept()
        if (stored !== null) return stored
        // nothing kept: AniList's rate limit is worth waiting for (it failed at once, without asking); with Home's sections
        // asking at the same time one wait may not be enough, so up to RATE_LIMIT_WAITS
        let failure = error
        for (let waits = 0; ; waits++) {
            if (failure.status !== 429 || waits >= RATE_LIMIT_WAITS || !(await waitForRateLimit(clientFor(environment)))) throw new CoreError(NOTHING_KEPT, 500)
            try {
                answer = await ask()
                break
            }
            catch (again) {
                if (!(again instanceof AnilistFailure)) throw again
                failure = again
            }
        }
    }
    await keep(answer).catch(() => undefined)
    return answer
}

/** The user's name on AniList: from the account the core keeps, else asked of AniList with the token */
async function userName(environment: CoreEnvironment): Promise<string> {
    const database = await environment.database()
    const rows = await database.select({ username: account.username }).from(account).where(eq(account.id, 1))
    if (rows[0]?.username) return rows[0].username
    const viewer = (await askAnilist(clientFor(environment), VIEWER_NAME, {})).Viewer as Json | null | undefined
    if (typeof viewer?.name !== "string" || !viewer.name) throw new AnilistFailure("not logged in to AniList", 401)
    return viewer.name
}

async function rawCollection(kind: ListKind, environment: CoreEnvironment): Promise<ListCollection> {
    // the local account (no AniList account): its lists are the core's own, AniList has none to read
    if (await withoutAnilistAccount(environment)) return localCollection(await environment.database(), kind, environment.now())
    // what waits to be sent goes first, so that the lists read are the lists with it (changes.ts)
    await sendWaitingChanges(environment).catch(() => undefined)
    const read = await readThrough(
        environment,
        async () => {
            const data = await askAnilist(clientFor(environment), collectionQuery(kind), { userName: await userName(environment) })
            // a megabyte for a long list: entry by entry, with a pause between, instead of the whole tree in one piece
            await environment.pause("shaping the lists")
            const lists: Json[] = []
            for (const list of ((data.MediaListCollection as Json | null)?.lists ?? []) as Json[]) {
                const entries: unknown[] = []
                for (const entry of (list.entries ?? []) as unknown[]) {
                    entries.push(withoutEmpty(entry))
                    await environment.pause()
                }
                // the list's own fields in their order; like every empty list, no entries means no field
                const shaped = withoutEmpty({ ...list, entries: null }) as Json
                lists.push(entries.length > 0 ? Object.fromEntries(Object.keys(list).filter(key => key === "entries" || key in shaped).map(key => [key, key === "entries" ? entries : shaped[key]])) : shaped)
            }
            return { MediaListCollection: { lists } } as ListCollection
        },
        async answer => {
            await environment.pause("keeping the lists")
            await keepCollection(await environment.database(), kind, answer, environment.now())
        },
        async () => storedCollection(await environment.database(), kind),
    )
    return listsWithWaitingChanges(environment, kind, read)
}

/** GET /api/v1/anilist/collection: the anime collection without the user's own (custom) lists */
export async function animeCollection(_request: CoreRequest, environment: CoreEnvironment): Promise<ListCollection> {
    const raw = await rawCollection("ANIME", environment)
    return { MediaListCollection: { lists: raw.MediaListCollection.lists.filter(list => list.isCustomList !== true) } }
}

/** GET /api/v1/anilist/collection/raw and /api/v1/manga/anilist/collection/raw: every list, custom ones included */
export function rawCollectionOf(kind: ListKind) {
    return (_request: CoreRequest, environment: CoreEnvironment) => rawCollection(kind, environment)
}

/** GET …/collection/raw/tags: the tag names of every title in the user's lists, by AniList number */
export function collectionTagsOf(kind: ListKind) {
    return (_request: CoreRequest, environment: CoreEnvironment) => {
        const question = `tags/${kind}`
        return readThrough<Json>(
            environment,
            async () => {
                const data = await askAnilist(clientFor(environment), collectionTagsQuery(kind), { userName: await userName(environment) })
                await environment.pause("collecting the tags")
                const tags: Json = {}
                for (const list of ((data.MediaListCollection as Json | null)?.lists ?? []) as Json[]) {
                    for (const entry of (list.entries ?? []) as Json[]) {
                        const media = entry.media as { id?: number, tags?: { name?: string }[] | null } | null
                        const names = (media?.tags ?? []).map(tag => tag.name).filter((name): name is string => typeof name === "string")
                        if (typeof media?.id === "number" && names.length > 0) tags[String(media.id)] = names
                    }
                    await environment.pause()
                }
                return tags
            },
            async answer => keepAnswer(await environment.database(), question, answer, environment.now()),
            async () => (await storedAnswer(await environment.database(), question)) as Json | null,
        )
    }
}

function wholeNumber(text: string | undefined): number {
    const number = Number(text)
    if (!Number.isInteger(number)) throw new CoreError("invalid id", 400)
    return number
}

/** GET /api/v1/anilist/media-details/{id} */
export async function animeDetails(request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    const id = wholeNumber(request.path.id)
    // a negative number is a title of TVmaze (tvmaze/tvmaze.ts), not of AniList
    if (isTvmazeId(id)) return tvmazeMedia(environment, id)
    return readThrough<Json>(
        environment,
        async () => {
            const media = (await askAnilist(clientFor(environment), ANIME_DETAILS, { id })).Media
            if (!media) throw new AnilistFailure("Not Found.", 404)
            // the details are long (characters, relations, recommendations): reading, trimming and keeping are pieces of their own
            await environment.pause("anilist details read")
            const trimmed = withoutEmpty(media) as Json
            await environment.pause("anilist details trimmed")
            return trimmed
        },
        async answer => keepDetails(await environment.database(), "ANIME", id, answer, environment.now()),
        async () => storedDetails(await environment.database(), "ANIME", id),
    )
}

/** An answer kept under its question only (no table of its own) */
function keptUnder(environment: CoreEnvironment, question: string, ask: () => Promise<Json>): Promise<Json> {
    return readThrough<Json>(
        environment,
        ask,
        async answer => keepAnswer(await environment.database(), question, answer, environment.now()),
        async () => (await storedAnswer(await environment.database(), question)) as Json | null,
    )
}

/** GET /api/v1/anilist/studio-details/{id} */
export async function studioDetails(request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    const id = wholeNumber(request.path.id)
    return keptUnder(environment, `studio/${id}`, async () => {
        const studio = (await askAnilist(clientFor(environment), STUDIO_DETAILS, { id })).Studio
        if (!studio) throw new AnilistFailure("Not Found.", 404)
        return withoutEmpty({ Studio: studio }) as Json
    })
}

/** The variables a page query declares, in its order, so that the same request is the same question */
function pick(body: unknown, names: string[]): Json {
    const given = typeof body === "object" && body !== null ? body as Json : {}
    return Object.fromEntries(names.filter(name => given[name] !== undefined && given[name] !== null).map(name => [name, given[name]]))
}

function page(environment: CoreEnvironment, name: string, document: string, variables: Json): Promise<Json> {
    return keptUnder(environment, `${name}/${JSON.stringify(variables)}`, async () => {
        const data = await askAnilist(clientFor(environment), document, variables)
        return withoutEmpty({ Page: data.Page ?? {} }) as Json
    })
}

/** POST /api/v1/anilist/list-anime (search, discover) */
export function listAnime(request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    return page(environment, "list-anime", LIST_ANIME, pick(request.body, LIST_ANIME_VARIABLES))
}

/** POST /api/v1/manga/anilist/list. The request's `year` is the year the manga started. */
export function listManga(request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    const variables = pick(request.body, LIST_MANGA_VARIABLES)
    const year = (request.body as Json | null | undefined)?.year
    if (typeof year === "number" && Number.isInteger(year)) {
        variables.startDate_greater = year * 10000
        variables.startDate_lesser = (year + 1) * 10000
    }
    return page(environment, "list-manga", LIST_MANGA, variables)
}

/** POST /api/v1/anilist/list-recent-anime (schedule) */
export function listRecentAiring(request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    return page(environment, "list-recent-anime", LIST_RECENT_AIRING, pick(request.body, LIST_RECENT_AIRING_VARIABLES))
}

/** GET /api/v1/anilist/stats: the user's statistics; needs the token */
export function viewerStats(_request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    return keptUnder(environment, "stats", async () => {
        const statistics = ((await askAnilist(clientFor(environment), VIEWER_STATS, {})).Viewer as Json | null)?.statistics as Json | undefined
        if (!statistics) throw new AnilistFailure("not logged in to AniList", 401)
        return withoutNull({ animeStats: statistics.anime ?? {}, mangaStats: statistics.manga ?? {} }) as Json
    })
}
