// geschrieben nach: öffentliche TVmaze-Doku (www.tvmaze.com/api: Felder von show, episode, image, search), den App-Typen AL_BaseAnime und Metadata_AnimeMetadata (src/api/generated/types.ts) und docs/EIGENER-KERN.md §4t; kein Server-Quelltext

import { keepAnswer, storedAnswer, storedAnswerWithTime } from "../anilist/store"
import { CoreError } from "../errors"
import type { CoreEnvironment } from "../registry"
import { TvmazeFailure, askTvmaze, tvmazeClientFor } from "./client"

/*
 * TVmaze as the second source of titles (docs/EIGENER-KERN.md §4t). A title of TVmaze has the app's number `-tvmazeId`
 * (Dreamland, TVmaze 95063, is -95063): AniList's numbers are always positive, so the database, downloads, torrents and
 * online streams take it without change. A show is turned into the form of an AniList anime (AL_BaseAnime) and its
 * episodes into the form of the episode metadata (Metadata_AnimeMetadata).
 *
 * Every answer is kept under its question (anilist/store.ts keepAnswer); when TVmaze fails, the kept one is the answer.
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "fetch" | "database" | "now" | "sleep">

/** The same text as AniList's reads when nothing was kept (anilist.ts NOTHING_KEPT) */
const NOTHING_KEPT = "no cached data available"

/** Whether the app's number of a title is one of TVmaze */
export function isTvmazeId(id: number): boolean {
    return Number.isInteger(id) && id < 0
}

/** TVmaze's number of a title of the app (-95063 → 95063) */
export function toTvmazeId(id: number): number {
    return -id
}

/** The app's number of a TVmaze show (95063 → -95063) */
export function fromTvmazeId(tvmazeId: number): number {
    return -tvmazeId
}

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const text = (value: unknown) => (typeof value === "string" ? value : "")
const positive = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0)

/** TVmaze's summaries are HTML ("<p>…</p>"): plain text with the paragraphs kept */
export function plainText(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, "\"")
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .trim()
}

/** "2026-03-09" → { year, month, day } */
function fuzzyDate(date: string): Json | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
    return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null
}

/** AniList's seasons: December to February WINTER (December counts to the next year), then SPRING, SUMMER, FALL */
function seasonOf(date: Json | null): { season: string, seasonYear: number } | null {
    if (!date) return null
    const month = date.month as number
    const year = date.year as number
    if (month === 12) return { season: "WINTER", seasonYear: year + 1 }
    return { season: ["WINTER", "WINTER", "SPRING", "SPRING", "SPRING", "SUMMER", "SUMMER", "SUMMER", "FALL", "FALL", "FALL"][month - 1], seasonYear: year }
}

function statusOf(show: Json, now: number): string {
    const premiered = text(show.premiered)
    const today = new Date(now).toISOString().slice(0, 10)
    if (show.status === "In Development" || !premiered || premiered > today) return "NOT_YET_RELEASED"
    return show.status === "Ended" ? "FINISHED" : "RELEASING"
}

/** The regular episodes in TVmaze's order (season, number); specials have no number */
function regularEpisodes(episodes: unknown): Json[] {
    if (!Array.isArray(episodes)) return []
    return episodes.filter((episode): episode is Json => isRecord(episode) && (episode.type ?? "regular") === "regular" && typeof episode.number === "number")
}

/** One TVmaze show as an AniList anime; `episodes` (TVmaze's list, embedded or asked) adds the count and the next airing */
export function mediaOfShow(show: Json, episodes: unknown, now: number, banner?: string): Json {
    const name = text(show.name)
    const image = isRecord(show.image) ? show.image : {}
    const medium = text(image.medium)
    const original = text(image.original) || medium
    const startDate = fuzzyDate(text(show.premiered))
    const season = seasonOf(startDate)
    const channel = isRecord(show.network) ? show.network : isRecord(show.webChannel) ? show.webChannel : {}
    const country = isRecord(channel.country) ? text(channel.country.code) : ""
    const regular = regularEpisodes(episodes)
    const media: Json = {
        id: fromTvmazeId(show.id as number),
        type: "ANIME",
        format: "TV",
        status: statusOf(show, now),
        title: { romaji: name, english: name, userPreferred: name },
        synonyms: [],
        coverImage: { extraLarge: original, large: original, medium: medium || original },
        description: plainText(text(show.summary)),
        genres: Array.isArray(show.genres) ? show.genres.filter(genre => typeof genre === "string") : [],
        isAdult: false,
        siteUrl: text(show.url),
    }
    if (banner) media.bannerImage = banner
    if (startDate) media.startDate = startDate
    const endDate = fuzzyDate(text(show.ended))
    if (endDate) media.endDate = endDate
    if (season) Object.assign(media, season)
    const duration = positive(show.averageRuntime) || positive(show.runtime)
    if (duration) media.duration = duration
    if (country) media.countryOfOrigin = country
    const rating = isRecord(show.rating) ? positive(show.rating.average) : 0
    if (rating) media.meanScore = Math.round(rating * 10)
    if (regular.length > 0) media.episodes = regular.length
    const nextIndex = regular.findIndex(episode => Date.parse(text(episode.airstamp)) > now)
    if (nextIndex >= 0) {
        const airingAt = Math.floor(Date.parse(text(regular[nextIndex].airstamp)) / 1000)
        media.nextAiringEpisode = { airingAt, timeUntilAiring: airingAt - Math.floor(now / 1000), episode: nextIndex + 1 }
    }
    return media
}

/** The show's episodes in the form of the episode metadata (library/metadata.ts), numbered 1… across the seasons */
export function metadataOfShow(show: Json, episodes: unknown): Json | null {
    const regular = regularEpisodes(episodes)
    if (regular.length === 0) return null
    const all = Array.isArray(episodes) ? episodes.filter(isRecord) : []
    const byNumber: Record<string, Json> = {}
    regular.forEach((episode, index) => {
        const image = isRecord(episode.image) ? text(episode.image.original) || text(episode.image.medium) : ""
        const summary = plainText(text(episode.summary))
        byNumber[String(index + 1)] = {
            anidbId: 0,
            tvdbId: 0,
            title: text(episode.name),
            image,
            airDate: text(episode.airdate),
            length: positive(episode.runtime),
            summary,
            overview: summary,
            episodeNumber: episode.number,
            episode: String(index + 1),
            seasonNumber: positive(episode.season),
            absoluteEpisodeNumber: index + 1,
            anidbEid: 0,
            hasImage: image !== "",
        }
    })
    const externals = isRecord(show.externals) ? show.externals : {}
    const mappings: Json = {}
    if (positive(externals.thetvdb)) mappings.thetvdbId = externals.thetvdb
    return {
        titles: { en: text(show.name) },
        episodes: byNumber,
        episodeCount: regular.length,
        specialCount: all.length - regular.length,
        mappings,
    }
}

/** How long a kept show is answered without asking TVmaze ("My shows" and the history ask for many at once; 20 a 10 s) */
export const SHOW_FRESH_MS = 12 * 60 * 60 * 1000

/**
 * Asks TVmaze and keeps the answer; when TVmaze fails, the kept answer; nothing kept: 404 when TVmaze has none, else 500.
 * With `freshFor`, a kept answer younger than that is the answer without asking.
 */
async function readKept(environment: Environment, question: string, ask: () => Promise<Json>, freshFor = 0): Promise<Json> {
    const database = await environment.database()
    if (freshFor > 0) {
        const kept = await storedAnswerWithTime(database, question)
        if (kept && isRecord(kept.answer) && environment.now() - kept.changedAt < freshFor) return kept.answer
    }
    let answer: Json
    try {
        answer = await ask()
    }
    catch (error) {
        if (!(error instanceof TvmazeFailure)) throw error
        const stored = await storedAnswer(database, question)
        if (isRecord(stored)) return stored
        throw error.status === 404 ? new CoreError("Not Found.", 404) : new CoreError(NOTHING_KEPT, 500)
    }
    await keepAnswer(database, question, answer, environment.now()).catch(() => undefined)
    return answer
}

/** The banner: TVmaze's main background picture, else any background or banner; none when the pictures cannot be read */
async function bannerOf(environment: Environment, tvmazeId: number): Promise<string> {
    try {
        const images = await askTvmaze(tvmazeClientFor(environment), `/shows/${tvmazeId}/images`)
        if (!Array.isArray(images)) return ""
        const wide = images.filter((image): image is Json => isRecord(image) && (image.type === "background" || image.type === "banner"))
        const chosen = wide.find(image => image.type === "background" && image.main === true) ?? wide.find(image => image.type === "background") ?? wide[0]
        const resolutions = isRecord(chosen?.resolutions) ? chosen.resolutions : {}
        return isRecord(resolutions.original) ? text(resolutions.original.url) : ""
    }
    catch {
        return ""
    }
}

/** The show with its episodes and banner, as TVmaze sends them (kept under `tvmaze/show/{id}`) */
async function showOf(environment: Environment, id: number): Promise<Json> {
    const tvmazeId = toTvmazeId(id)
    return readKept(environment, `tvmaze/show/${tvmazeId}`, async () => {
        const show = await askTvmaze(tvmazeClientFor(environment), `/shows/${tvmazeId}?embed=episodes`)
        if (!isRecord(show)) throw new TvmazeFailure("Not Found.", 404)
        const embedded = isRecord(show._embedded) ? show._embedded : {}
        return { show, episodes: Array.isArray(embedded.episodes) ? embedded.episodes : [], banner: await bannerOf(environment, tvmazeId) }
    }, SHOW_FRESH_MS)
}

/** The details of a title of TVmaze (the app's number, negative) in the form of AniList's */
export async function tvmazeMedia(environment: Environment, id: number): Promise<Json> {
    const kept = await showOf(environment, id)
    return mediaOfShow(kept.show as Json, kept.episodes, environment.now(), text(kept.banner))
}

/** The episode metadata of a title of TVmaze; null when it has no episodes or nothing can be read */
export async function tvmazeMetadata(environment: Environment, id: number): Promise<Json | null> {
    try {
        const kept = await showOf(environment, id)
        return metadataOfShow(kept.show as Json, kept.episodes)
    }
    catch {
        return null
    }
}

/** Words of a title or a search: lower case, accents and punctuation gone ("Les Frères: Apocalypse" → les freres apocalypse). */
function searchWords(text: string): string[] {
    return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/**
 * TVmaze searches fuzzily ("frieren" finds "Les Frères Apocalypse", "naruto" finds "Subete ga F ni Naru"). A title is
 * kept only when every word of the search starts a word of the title, or the search without spaces starts the title
 * without spaces ("spiderman" → "Spider-Man").
 */
export function titleMatchesSearch(title: string, query: string): boolean {
    const asked = searchWords(query)
    if (!asked.length) return false
    const words = searchWords(title)
    if (asked.every(part => words.some(word => word.startsWith(part)))) return true
    return words.join("").startsWith(asked.join(""))
}

/**
 * Search of the other sources (TVmaze) in the form of AniList's search (list-anime: { Page: { pageInfo, media } }).
 * Search results have no episodes, so no episode count and no next airing. Only shows of TVmaze's type "Animation"
 * whose name matches the search (titleMatchesSearch).
 */
export async function searchOtherSources(environment: Environment, query: string): Promise<Json> {
    const asked = query.trim()
    if (!asked) return { Page: { pageInfo: { hasNextPage: false, total: 0 }, media: [] } }
    const found = await readKept(environment, `tvmaze/search/${asked.toLowerCase()}`, async () => {
        const results = await askTvmaze(tvmazeClientFor(environment), `/search/shows?q=${encodeURIComponent(asked)}`)
        return { results: Array.isArray(results) ? results : [] }
    })
    const media = (found.results as unknown[])
        .map(result => (isRecord(result) && isRecord(result.show) ? result.show : null))
        // only animated shows: the app is for anime and cartoons, live-action series of the same name stay out
        .filter((show): show is Json => show !== null && typeof show.id === "number" && show.type === "Animation")
        .filter(show => typeof show.name === "string" && titleMatchesSearch(show.name, asked))
        .map(show => mediaOfShow(show, [], environment.now()))
    return { Page: { pageInfo: { hasNextPage: false, total: media.length }, media } }
}
