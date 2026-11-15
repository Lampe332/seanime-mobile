// geschrieben nach: öffentliche Doku des Dienstes ani.zip (api.ani.zip/mappings?anilist_id=…, Felder titles, episodes, episodeCount, specialCount, mappings), der Aufzeichnung api vom 13.11.2026 (ANIME.GetAnimeEpisodeCollection: Form von `metadata`), den App-Typen Metadata_AnimeMetadata/Metadata_EpisodeMetadata (src/api/generated/types.ts) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext

import { eq } from "drizzle-orm"
import { type CoreDatabase, inOrder } from "../database/database"
import { episodeMetadata } from "../database/schema"
import type { CoreEnvironment } from "../registry"

/*
 * The episode metadata of an anime: titles in several languages, a title, picture, air date and length for each episode,
 * and the anime's numbers in other databases (AniDB, TheTVDB, MyAnimeList, …). The source is the public service ani.zip
 * (free, no key, asked by AniList number); its answer is turned into the form the app knows (`Metadata_AnimeMetadata`)
 * and kept in `core.db` (table `episode_metadata`). Own rules (docs/EIGENER-KERN.md §4p):
 *
 * - A kept answer younger than a day is used as it is; an older one is asked again.
 * - The service fails (no network, timeout after 10 s, an error, an answer without episodes): the last kept state, of
 *   any age. Nothing kept: no metadata (`null`); the caller builds the episodes from AniList alone.
 * - Titles: all languages of the service, its romanised title ("x-jat") under "main".
 * - An episode: title in English, else romanised, else Japanese; `summary` = `overview`; `length` = the runtime;
 *   `anidbId` = the AniDB number of the episode; `hasImage` when a picture is there.
 * - Mappings: the numbers the app's type names, in its spelling (`anidb_id` → `anidbId`).
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "fetch" | "database" | "now">

export const METADATA_URL = "https://api.ani.zip/mappings?anilist_id="
/** A kept answer this young is not asked again */
export const METADATA_FRESH_MS = 24 * 60 * 60 * 1000
const METADATA_TIMEOUT_MS = 10_000

/** The service's names of the mappings and the app's */
const MAPPINGS: [string, string][] = [
    ["kitsu_id", "kitsuId"], ["mal_id", "malId"], ["type", "type"], ["anilist_id", "anilistId"], ["anisearch_id", "anisearchId"],
    ["anidb_id", "anidbId"], ["livechart_id", "livechartId"], ["thetvdb_id", "thetvdbId"], ["themoviedb_id", "themoviedbId"],
]

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const text = (value: unknown) => (typeof value === "string" ? value : "")
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/** One episode of the service in the app's form */
function episodeOf(raw: Json): Json {
    const titles = isRecord(raw.title) ? raw.title : {}
    const image = text(raw.image)
    const overview = text(raw.overview) || text(raw.summary)
    return {
        anidbId: number(raw.anidbEid),
        tvdbId: number(raw.tvdbId),
        title: text(titles.en) || text(titles["x-jat"]) || text(titles.ja),
        image,
        airDate: text(raw.airDate) || text(raw.airdate),
        length: number(raw.runtime) || number(raw.length),
        summary: overview,
        overview,
        episodeNumber: number(raw.episodeNumber),
        episode: text(raw.episode),
        seasonNumber: number(raw.seasonNumber),
        absoluteEpisodeNumber: number(raw.absoluteEpisodeNumber),
        anidbEid: number(raw.anidbEid),
        hasImage: image !== "",
    }
}

/** The service's answer in the app's form, or null when it has no episodes */
export function metadataOf(raw: unknown): Json | null {
    if (!isRecord(raw) || !isRecord(raw.episodes) || Object.keys(raw.episodes).length === 0) return null
    const titles: Record<string, string> = {}
    if (isRecord(raw.titles)) {
        for (const [language, title] of Object.entries(raw.titles)) {
            if (typeof title === "string" && title !== "") titles[language === "x-jat" ? "main" : language] = title
        }
    }
    const episodes: Record<string, Json> = {}
    for (const [key, episode] of Object.entries(raw.episodes)) if (isRecord(episode)) episodes[key] = episodeOf(episode)
    const mappings: Json = {}
    if (isRecord(raw.mappings)) {
        for (const [theirs, ours] of MAPPINGS) {
            const value = raw.mappings[theirs]
            if (value !== null && value !== undefined && value !== "") mappings[ours] = value
        }
    }
    return { titles, episodes, episodeCount: number(raw.episodeCount), specialCount: number(raw.specialCount), mappings }
}

async function kept(database: CoreDatabase, anilistId: number): Promise<{ content: Json, fetchedAt: number } | null> {
    const rows = await inOrder(database, () => database.select().from(episodeMetadata).where(eq(episodeMetadata.anilistId, anilistId)))
    return rows[0] ? { content: rows[0].content, fetchedAt: rows[0].fetchedAt } : null
}

async function ask(environment: Environment, anilistId: number): Promise<Json | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS)
    try {
        const response = await environment.fetch(METADATA_URL + anilistId, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal })
        if (response.status !== 200) return null
        return metadataOf(JSON.parse(await response.text()))
    }
    catch {
        return null
    }
    finally {
        clearTimeout(timer)
    }
}

/** The anime's episode metadata: kept and fresh, else asked, else the last kept state; null when there is none */
export async function animeMetadata(environment: Environment, anilistId: number): Promise<Json | null> {
    const database = await environment.database()
    const last = await kept(database, anilistId)
    if (last && environment.now() - last.fetchedAt < METADATA_FRESH_MS) return last.content
    const fresh = await ask(environment, anilistId)
    if (!fresh) return last?.content ?? null
    const now = environment.now()
    try {
        await inOrder(database, () => database.insert(episodeMetadata).values({ anilistId, content: fresh, fetchedAt: now })
            .onConflictDoUpdate({ target: episodeMetadata.anilistId, set: { content: fresh, fetchedAt: now } }))
    }
    catch {
        // the page gets the metadata all the same; the next opening asks again
    }
    return fresh
}

