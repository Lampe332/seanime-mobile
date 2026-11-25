// geschrieben nach: App-Typen Anime_AutoSelectProfile, Anime_AutoSelectPreference und HibikeTorrent_AnimeTorrent (src/api/generated), Form der Aufzeichnungen TORRENT_SEARCH.GetAutoSelectProfile/SaveAutoSelectProfile/DeleteAutoSelectProfile vom 13.11.2026 (search.recorded.json), eigenem $habari (extensions/helpers/prelude/habari.js) und docs/EIGENER-KERN.md §4q (Phase 6c-1, eigene Auswahl-Regel); kein Server-Quelltext

import { eq } from "drizzle-orm"
import { inOrder } from "../database/database"
import { torrentKept } from "../database/schema"
import { CoreError } from "../errors"
import { parse } from "../extensions/helpers/prelude/habari"
import type { CoreEnvironment, CoreRequest } from "../registry"

/*
 * The auto-select profile (one at a time, kept in core.db, table `torrent_kept`) and the core's own rule for picking a
 * torrent when the user lets the app choose (docs/EIGENER-KERN.md §4q, phase 6c-1). The rule, in this order:
 *
 * 0. A provider whose every torrent (three or more) says the same seeder number does not count: its number is unknown
 *    (phase 6e, `providersWithoutCount`).
 * 1. Out: no way to the torrent (no magnet, no info hash, no provider to ask), no way to its data (nobody seeds it as
 *    counted, its magnet link names no web seed, and an unknown number comes without a `.torrent` file over HTTPS –
 *    phases 6b-3, 6e), fewer counted seeders than the profile's minimum, a term of `excludeTerms` in the name, outside `minSize`/`maxSize`,
 *    a resolution the profile does not list (when it lists some), a preference "never" that applies (batch, best
 *    release, several audio tracks, several subtitles), a preference "only" that does not, a required language, codec
 *    or source that is missing, a torrent of another episode (a batch, or a name without an episode, stays in), and a
 *    name dated for another show (4.2.0 E, `namesOtherYear`): it carries a year as a word, and none of its years lies
 *    within one of the anime's start year. That is the live-action series ("ONE.PIECE.2023.S01E01…" for the One Piece
 *    of 1999), the remake for the original and the original for the remake ("Hunter x Hunter (2011)"). A later season
 *    named with the series' earlier year ("Frieren (2023) S02E05") stays in; without a start year nothing is read.
 *    A film (`isMovieRelease`, "One Piece - Movie 01") is out for an anime whose format is known and not MOVIE (4.2.0 E).
 * 2. The rest is ordered by: the way to the data (counted seeders, then a web seed in the magnet link, then an unknown
 *    number with a `.torrent` file) → resolution (the profile's order, else the settings' preferred resolution first, else the
 *    higher one) → preferences (+1 for each "prefer" that applies, −1 for each "avoid") plus one for each preferred
 *    language, codec and source found → release group (the profile's order, listed ones first) → provider (the
 *    profile's order) → seeders → the smaller download. With `preferLargerFiles` (4.2.0, off by default) the larger
 *    download comes right after the provider, before the seeders: among equals the bigger release, the better quality.
 * 3. The first one wins; none left: no choice (the caller says so).
 */

type Json = Record<string, unknown>

export type AutoSelectPreference = "neutral" | "prefer" | "avoid" | "only" | "never"

export type AutoSelectProfile = {
    dbId: number
    providers: string[] | null
    releaseGroups: string[] | null
    resolutions: string[] | null
    excludeTerms: string[] | null
    preferredLanguages: string[] | null
    preferredCodecs: string[] | null
    preferredSources: string[] | null
    multipleAudioPreference: string
    multipleSubsPreference: string
    batchPreference: string
    bestReleasePreference: string
    requireLanguage: boolean
    requireCodec: boolean
    requireSource: boolean
    minSeeders?: number
    minSize?: string
    maxSize?: string
    /** 4.2.0: among otherwise equal torrents the larger one before the one with more seeders; only kept when true */
    preferLargerFiles?: boolean
}

const PROFILE_KEY = "autoselect-profile"
const LISTS = ["providers", "releaseGroups", "resolutions", "excludeTerms", "preferredLanguages", "preferredCodecs", "preferredSources"] as const
const PREFERENCES = ["multipleAudioPreference", "multipleSubsPreference", "batchPreference", "bestReleasePreference"] as const
const REQUIRES = ["requireLanguage", "requireCodec", "requireSource"] as const

/** The profile the screens see when none is saved (recorded: `dbId` 0, every list null, every preference "") */
export function emptyProfile(): AutoSelectProfile {
    return {
        dbId: 0, providers: null, releaseGroups: null, resolutions: null, excludeTerms: null, preferredLanguages: null, preferredCodecs: null,
        preferredSources: null, multipleAudioPreference: "", multipleSubsPreference: "", batchPreference: "", bestReleasePreference: "",
        requireLanguage: false, requireCodec: false, requireSource: false,
    }
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

/** A profile as the screens send it, in the recorded form: an empty list is null, unknown fields are left out */
export function profileOf(value: unknown): AutoSelectProfile {
    if (!isRecord(value)) throw new CoreError("profile must be an object", 400)
    const profile = emptyProfile()
    for (const name of LISTS) {
        const list = Array.isArray(value[name]) ? (value[name] as unknown[]).filter((item): item is string => typeof item === "string" && item.trim() !== "") : []
        profile[name] = list.length > 0 ? list : null
    }
    for (const name of PREFERENCES) profile[name] = typeof value[name] === "string" ? value[name] as string : ""
    for (const name of REQUIRES) profile[name] = value[name] === true
    if (typeof value.minSeeders === "number" && Number.isInteger(value.minSeeders) && value.minSeeders >= 0) profile.minSeeders = value.minSeeders
    if (typeof value.minSize === "string" && value.minSize !== "") profile.minSize = value.minSize
    if (typeof value.maxSize === "string" && value.maxSize !== "") profile.maxSize = value.maxSize
    if (value.preferLargerFiles === true) profile.preferLargerFiles = true
    return profile
}

async function keptProfile(environment: Pick<CoreEnvironment, "database">): Promise<AutoSelectProfile | null> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select({ content: torrentKept.content }).from(torrentKept).where(eq(torrentKept.key, PROFILE_KEY)))
    return rows.length > 0 ? (rows[0].content as unknown as AutoSelectProfile) : null
}

/** GET /api/v1/auto-select/profile: the saved profile, else the empty one */
export async function getAutoSelectProfile(_request: CoreRequest | null, environment: Pick<CoreEnvironment, "database">): Promise<AutoSelectProfile> {
    return (await keptProfile(environment)) ?? emptyProfile()
}

/** POST /api/v1/auto-select/profile: creates or replaces the one profile → the saved profile (`dbId` 1) */
export async function saveAutoSelectProfile(request: CoreRequest, environment: Pick<CoreEnvironment, "database" | "now">): Promise<AutoSelectProfile> {
    const body = isRecord(request.body) ? request.body : {}
    const profile = { ...profileOf(body.profile), dbId: 1 }
    const database = await environment.database()
    const values = { key: PROFILE_KEY, content: profile as unknown as Json, changedAt: environment.now() }
    await inOrder(database, () => database.insert(torrentKept).values(values).onConflictDoUpdate({ target: torrentKept.key, set: values }))
    return profile
}

/** DELETE /api/v1/auto-select/profile → true; afterwards the empty profile is read */
export async function deleteAutoSelectProfile(_request: CoreRequest, environment: Pick<CoreEnvironment, "database">): Promise<true> {
    const database = await environment.database()
    await inOrder(database, () => database.delete(torrentKept).where(eq(torrentKept.key, PROFILE_KEY)))
    return true
}

/* ---- The rule ---- */

/** A torrent of a provider as the search hands it on (HibikeTorrent_AnimeTorrent plus `provider`) */
export type FoundTorrent = Json & {
    provider: string
    name: string
    size: number
    seeders: number
    magnetLink?: string
    infoHash?: string
    resolution?: string
    isBatch?: boolean
    episodeNumber?: number
    releaseGroup?: string
    isBestRelease: boolean
}

/**
 * `startYear`: the year the anime began (AniList `startDate.year`); 0 or left out: the names' years are not read.
 * `format`: the anime's AniList format; any but "MOVIE" rules films out, "" or left out: unknown, nothing ruled out.
 */
export type AutoSelectWanted = { episodeNumber: number, preferredResolution: string, startYear?: number, format?: string }

const lower = (text: unknown) => (typeof text === "string" ? text.toLowerCase() : "")
const listOf = (value: unknown): string[] => (Array.isArray(value) ? value.map(lower).filter(Boolean) : typeof value === "string" && value ? [value.toLowerCase()] : [])

const UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }

/** "1.5 GB", "700MiB", "2g" → bytes; 0 when it cannot be read */
export function bytesOf(text: string | undefined): number {
    const found = /^\s*(\d+(?:[.,]\d+)?)\s*([kmgt]?i?b?)\s*$/i.exec(text ?? "")
    if (!found) return 0
    let unit = (found[2] ?? "").toLowerCase()
    if (unit === "") unit = "b"
    else if (!unit.endsWith("b")) unit += "b"
    return Math.round(Number(found[1]!.replace(",", ".")) * (UNITS[unit] ?? 0))
}

/** Release names sometimes come with HTML entities from the provider ("Returner&#39;s", "[A&amp;C]") */
export function decodeEntities(text: string) {
    return text.replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code: string) => {
        const lower = code.toLowerCase()
        if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16))
        if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10))
        return ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " } as Record<string, string>)[lower] ?? match
    })
}

/**
 * A film rather than an episode (4.2.0 E): the parser's type ("Movie", "Movies"), or a word for it in the name ("Film
 * Red", "Gekijouban", "劇場版"). Its number counts films: "One Piece - Movie 01" is no episode 1 of the series.
 */
export function isMovieRelease(name: string, animeTypes: unknown): boolean {
    return listOf(animeTypes).some(type => type === "movie" || type === "movies") || /\b(?:movies?|film|gekijou?ban)\b|劇場版/i.test(name)
}

/** What the name of a torrent says, read once */
export type ReadTorrent = {
    torrent: FoundTorrent
    resolution: string
    group: string
    episodes: number[]
    batch: boolean
    languages: string[]
    codecs: string[]
    sources: string[]
    multipleAudio: boolean
    multipleSubs: boolean
    /** The seasons the name numbers ("S2", "2nd Season", "Season 2") */
    seasons: number[]
    /** A film (isMovieRelease): only an anime that is a film takes it */
    movie: boolean
}

export function readTorrent(torrent: FoundTorrent): ReadTorrent {
    const decoded = decodeEntities(torrent.name ?? "")
    const read = parse(decoded) as unknown as Json
    const episodes = listOf(read.episode_number).flatMap(text => {
        const range = /^(\d+)\s*[-~]\s*(\d+)$/.exec(text)
        return range ? [Number(range[1]), Number(range[2])] : [Number(text)]
    }).filter(number => Number.isFinite(number))
    const own = typeof torrent.episodeNumber === "number" && torrent.episodeNumber > 0 ? torrent.episodeNumber : 0
    const name = lower(decoded)
    // a range of episodes in the name ("(01-12)", " 13-24 "), which the parser leaves in the title
    const range = /(?:^|[\s([_])(\d{1,4})\s*[-~]\s*(\d{1,4})(?=$|[\s)\]_])/.exec(name)
    if (episodes.length === 0 && range && Number(range[1]) < Number(range[2])) episodes.push(Number(range[1]), Number(range[2]))
    const audio = listOf(read.audio_term)
    const subtitles = listOf(read.subtitles)
    const languages = listOf(read.language)
    const seasons = [...listOf(read.season_number).map(Number), ...[...name.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)[ ._-]season\b|\bseason[ ._-]?(\d{1,2})\b/g)]
        .map(found => Number(found[1] ?? found[2]))].filter(number => Number.isFinite(number) && number > 0)
    return {
        torrent,
        resolution: lower(torrent.resolution) || lower(read.video_resolution),
        group: lower(decodeEntities(torrent.releaseGroup ?? "")) || lower(read.release_group),
        episodes: own ? [own] : episodes,
        batch: torrent.isBatch === true || (own === 0 && (episodes.length !== 1 || /\b(batch|complete|season)\b/.test(name))),
        languages: [...languages, ...subtitles],
        codecs: listOf(read.video_term),
        sources: listOf(read.source),
        multipleAudio: /\b(dual|multi)[ ._-]?audio\b/.test(name) || audio.some(term => /dual|multi/.test(term)) || languages.length > 1,
        multipleSubs: /\bmulti[ ._-]?subs?\b/.test(name) || subtitles.some(term => /multi/.test(term)) || subtitles.length > 1,
        seasons,
        movie: isMovieRelease(name, read.anime_type),
    }
}

/** The years a name carries as a word ("ONE.PIECE.2023.S01E01", "Hunter x Hunter (2011)"); an episode it numbers is no year */
export function yearsIn(name: string, episodes: number[] = []): number[] {
    return [...name.matchAll(/(?:^|[\s._([-])((?:19|20)\d{2})(?=$|[\s._)\]-])/g)].map(found => Number(found[1])).filter(year => !episodes.includes(year))
}

/**
 * Whether the name is dated for another show than the anime that began in `startYear` (see the head of this file, step
 * 1). The wanted episode is no year either: the parser reads "Detective Conan - 2001" as a year, not as episode 2001.
 */
export function namesOtherYear(read: Pick<ReadTorrent, "torrent" | "episodes" | "seasons">, startYear: number, episodeNumber = 0): boolean {
    if (!(startYear > 0)) return false
    const years = yearsIn(read.torrent.name ?? "", [...read.episodes, episodeNumber])
    if (years.length === 0 || years.some(year => Math.abs(year - startYear) <= 1)) return false
    // a later season named with the year the series began ("Shingeki no Kyojin (2013) S04")
    return !(read.seasons.some(season => season >= 2) && years.every(year => year < startYear))
}

/**
 * Whether the torrent is of another show than the wanted anime (step 1's last two cases): a name dated for another show,
 * or a film for an anime whose format is known and not MOVIE. The torrent search's "Recommended" order puts these last.
 */
export function isOtherShow(read: Pick<ReadTorrent, "torrent" | "episodes" | "seasons" | "movie">, wanted: Pick<AutoSelectWanted, "episodeNumber" | "startYear" | "format">): boolean {
    return namesOtherYear(read, wanted.startYear ?? 0, wanted.episodeNumber) || (read.movie && !!wanted.format && wanted.format !== "MOVIE")
}

const contains = (found: string[], wanted: string[]) => wanted.some(item => found.some(one => one.includes(item)))
const rankIn = (list: string[], value: string) => {
    const at = list.findIndex(item => value === item || value.includes(item))
    return at < 0 ? list.length : at
}
/** The height a resolution names, so "1080p", "1080" and "1920x1080" are all 1080 ("4k": 2160); 0 when none */
export function resolutionHeight(resolution: string): number {
    const text = resolution.toLowerCase()
    const found = /(\d{3,4})[pi]/.exec(text) ?? /\d{3,4}\s*x\s*(\d{3,4})/.exec(text) ?? /(\d{3,4})/.exec(text)
    if (found) return Number(found[1])
    return /4k|uhd/.test(text) ? 2160 : 0
}
const height = resolutionHeight

function fitsPreference(preference: string, applies: boolean): boolean {
    if (preference === "never") return !applies
    if (preference === "only") return applies
    return true
}

const preferenceScore = (preference: string, applies: boolean) => (!applies ? 0 : preference === "prefer" ? 1 : preference === "avoid" ? -1 : 0)

/** Whether a magnet link names a web seed (BEP 19, `ws=`): a place that has the torrent's files without any peer */
export const namesWebSeed = (torrent: { magnetLink?: unknown }) => typeof torrent.magnetLink === "string" && /[?&]ws=/i.test(torrent.magnetLink)

/** The address of a torrent's `.torrent` file as its provider names it, over HTTPS only; "" without one */
export function torrentFileAddressOf(torrent: Json): string {
    const address = typeof torrent.downloadUrl === "string" ? torrent.downloadUrl.trim() : ""
    return /^https:\/\/\S+$/i.test(address) ? address : ""
}

/**
 * The providers that do not count seeders (phase 6e): every torrent of theirs in the list – three or more – says the
 * same number. A real swarm count is never the same for that many torrents; such a number (one provider says "1" for
 * everything) is no count, and the rule reads it as unknown.
 */
export function providersWithoutCount(torrents: { provider: string, seeders?: number }[]): Set<string> {
    const numbers = new Map<string, number[]>()
    for (const torrent of torrents) numbers.set(torrent.provider, [...(numbers.get(torrent.provider) ?? []), torrent.seeders ?? 0])
    return new Set([...numbers].filter(([, said]) => said.length >= 3 && said.every(number => number === said[0])).map(([provider]) => provider))
}

/** The torrent the rule picks (see the head of this file), with its reading; null when none fits */
export function chooseTorrent(torrents: FoundTorrent[], profile: AutoSelectProfile, wanted: AutoSelectWanted): ReadTorrent | null {
    const resolutions = listOf(profile.resolutions)
    const groups = listOf(profile.releaseGroups)
    const providers = listOf(profile.providers)
    const excluded = listOf(profile.excludeTerms)
    const languages = listOf(profile.preferredLanguages)
    const codecs = listOf(profile.preferredCodecs)
    const sources = listOf(profile.preferredSources)
    const minSeeders = profile.minSeeders ?? 0
    const uncounted = providersWithoutCount(torrents)
    /** The seeders as counted; a provider that does not count has none that count */
    const seeders = (read: ReadTorrent) => (uncounted.has(read.torrent.provider) ? 0 : read.torrent.seeders ?? 0)
    /**
     * The way to the data, the surer first: 0 counted seeders, 1 a web seed in the magnet link, 2 an uncounted number
     * with a `.torrent` file over HTTPS (its trackers and web seeds are read when it is added), 3 none
     */
    const way = (read: ReadTorrent) => {
        if (seeders(read) > 0) return 0
        if (namesWebSeed(read.torrent)) return 1
        if (uncounted.has(read.torrent.provider) && (read.torrent.seeders ?? 0) > 0 && torrentFileAddressOf(read.torrent)) return 2
        return 3
    }
    const minSize = bytesOf(profile.minSize)
    const maxSize = bytesOf(profile.maxSize)
    const preferred = resolutionHeight(wanted.preferredResolution)

    const fitting = torrents.map(readTorrent).filter(read => {
        const { torrent } = read
        const name = lower(torrent.name)
        if (!torrent.magnetLink && !torrent.infoHash && !torrent.provider) return false
        // no way to the torrent's data: nobody seeds it as counted, its link names no web seed, and an uncounted number
        // comes without a .torrent file
        if (way(read) === 3) return false
        if (seeders(read) < minSeeders) return false
        if (excluded.some(term => name.includes(term))) return false
        if (minSize && torrent.size < minSize) return false
        if (maxSize && torrent.size > maxSize) return false
        if (resolutions.length > 0 && !resolutions.some(item => read.resolution === item || read.resolution.includes(item))) return false
        if (!fitsPreference(profile.batchPreference, read.batch)) return false
        if (!fitsPreference(profile.bestReleasePreference, torrent.isBestRelease === true)) return false
        if (!fitsPreference(profile.multipleAudioPreference, read.multipleAudio)) return false
        if (!fitsPreference(profile.multipleSubsPreference, read.multipleSubs)) return false
        if (profile.requireLanguage && languages.length > 0 && !contains(read.languages, languages)) return false
        if (profile.requireCodec && codecs.length > 0 && !contains(read.codecs, codecs)) return false
        if (profile.requireSource && sources.length > 0 && !contains(read.sources, sources)) return false
        if (!read.batch && read.episodes.length > 0 && wanted.episodeNumber > 0 && !read.episodes.includes(wanted.episodeNumber)) return false
        if (read.batch && read.episodes.length === 2 && wanted.episodeNumber > 0 && (wanted.episodeNumber < read.episodes[0]! || wanted.episodeNumber > read.episodes[1]!)) return false
        return !isOtherShow(read, wanted)
    })

    const resolutionRank = (read: ReadTorrent) => {
        if (resolutions.length > 0) return rankIn(resolutions, read.resolution)
        if (preferred && height(read.resolution) === preferred) return -10_000
        return -height(read.resolution)
    }
    const score = (read: ReadTorrent) =>
        preferenceScore(profile.batchPreference, read.batch)
        + preferenceScore(profile.bestReleasePreference, read.torrent.isBestRelease === true)
        + preferenceScore(profile.multipleAudioPreference, read.multipleAudio)
        + preferenceScore(profile.multipleSubsPreference, read.multipleSubs)
        + Number(contains(read.languages, languages)) + Number(contains(read.codecs, codecs)) + Number(contains(read.sources, sources))

    const larger = profile.preferLargerFiles === true
    const bytes = (read: ReadTorrent) => read.torrent.size ?? 0
    fitting.sort((a, b) =>
        way(a) - way(b)
        || resolutionRank(a) - resolutionRank(b)
        || score(b) - score(a)
        || (groups.length > 0 ? rankIn(groups, a.group) - rankIn(groups, b.group) : 0)
        || (providers.length > 0 ? rankIn(providers, lower(a.torrent.provider)) - rankIn(providers, lower(b.torrent.provider)) : 0)
        || (larger ? bytes(b) - bytes(a) : 0)
        || seeders(b) - seeders(a)
        || bytes(a) - bytes(b))
    return fitting[0] ?? null
}
