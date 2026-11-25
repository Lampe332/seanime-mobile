// geschrieben nach: Seanime_Jellyfin_Plan.md §2 (Reihenfolge, Staffel-Regeln S1 bis S4, Prüfung), den ani.zip-Feldern aus core/library/metadata.ts und der Titel-Bewertung aus core/library/local-files.ts; kein Server-Quelltext

import { titleScore } from "../library/local-files"
import { type JellyfinEpisode, type JellyfinSeason, type JellyfinSeries, providerId } from "./client"

/*
 * Which episodes of a media server belong to an AniList title. The question is asked from the title's side: not "which
 * title is this season" but "which server episodes are this title's". Rules (Seanime_Jellyfin_Plan.md §2):
 *
 * - S1: the series or one of its seasons carries exactly this AniList id (provider key "AniList") and the series has one
 *   season besides season 0: episode = `IndexNumber`. The id on the series counts for S1 only; it is never read as
 *   "the first season".
 * - S2: the series is found by AniDB, then Tvdb, then Tmdb (the numbers ani.zip gives for the title). Each episode of
 *   ani.zip names `seasonNumber` and `episodeNumber`; the server episode is `ParentIndexNumber` = season and
 *   `IndexNumber` = episode. Season 0 (specials) is matched here and only here.
 * - S3: the series found as in S2 has one season besides season 0, its episodes counted through: the server episode is
 *   `IndexNumber` = `absoluteEpisodeNumber`.
 * - S4: no numbers: the series' name plus "Season N" (the name alone when it has one season) is scored against the
 *   title's names with `titleScore`; a series whose year is more than one off is left out. Always uncertain.
 * - Choice: the rules are tried in order. A rule that finds a file for fewer than half of the aired episodes gives way to
 *   the next one when that finds more.
 * - Check over all titles: no server episode belongs to two titles. A certain match beats an uncertain one, then the
 *   earlier rule wins; when that is a tie the episode is dropped from both.
 */

type Json = Record<string, unknown>

export type MatchRule = "S1" | "S2" | "S3" | "S4"
const RULES: MatchRule[] = ["S1", "S2", "S3", "S4"]

/** S4 lowest score worth an uncertain match (the "near" bound of `bestMatch`) */
export const TITLE_ONLY_AT = 0.5

/** One series of the server with its seasons and the episodes that have a file */
export interface ServerShow {
    series: JellyfinSeries
    seasons: JellyfinSeason[]
    episodes: JellyfinEpisode[]
}

/** An AniList title as far as matching needs it */
export interface AnilistTitle {
    id: number
    /** Every name of the title (romaji, English, native, synonyms) */
    titles: string[]
    /** Year of the first airing, 0 when unknown */
    year: number
    /** Aired episodes, 0 when unknown */
    aired: number
    /** The ani.zip answer in the app's form (`metadataOf`), null when there is none */
    metadata: Json | null
}

export interface EpisodeMatch {
    /** The episode's number on AniList */
    episode: number
    serverEpisodeId: string
}

export interface TitleMatch {
    anilistId: number
    serverId: string
    seriesId: string
    rule: MatchRule
    certain: boolean
    episodes: EpisodeMatch[]
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const whole = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null)

/** The season number of a server episode: `ParentIndexNumber`, else the index of its season */
function seasonNumberOf(show: ServerShow, episode: JellyfinEpisode): number | null {
    if (episode.season !== null) return episode.season
    return show.seasons.find(season => season.id === episode.seasonId)?.index ?? null
}

/** The season numbers of a series besides season 0 */
function regularSeasons(show: ServerShow): number[] {
    const numbers = new Set<number>()
    for (const season of show.seasons) if (season.index !== 0) numbers.add(season.index ?? -1)
    if (!show.seasons.length) for (const episode of show.episodes) if (episode.season !== 0) numbers.add(episode.season ?? -1)
    return [...numbers]
}

/** The ani.zip episodes of a title with an AniList number (keys "1", "2", …; "S1" and the like are left out) */
function aniEpisodes(metadata: Json | null): { episode: number, season: number | null, number: number | null, absolute: number | null }[] {
    if (!metadata || !isRecord(metadata.episodes)) return []
    const list = []
    for (const [key, raw] of Object.entries(metadata.episodes)) {
        if (!/^\d+$/.test(key) || !isRecord(raw) || Number(key) < 1) continue
        list.push({ episode: Number(key), season: whole(raw.seasonNumber), number: whole(raw.episodeNumber), absolute: whole(raw.absoluteEpisodeNumber) })
    }
    return list.sort((a, b) => a.episode - b.episode)
}

function matchOf(title: AnilistTitle, show: ServerShow, rule: MatchRule, pairs: EpisodeMatch[]): TitleMatch {
    const episodes: EpisodeMatch[] = []
    const seenEpisode = new Set<number>()
    const seenFile = new Set<string>()
    for (const pair of pairs) {
        if (seenEpisode.has(pair.episode) || seenFile.has(pair.serverEpisodeId)) continue
        seenEpisode.add(pair.episode)
        seenFile.add(pair.serverEpisodeId)
        episodes.push(pair)
    }
    return { anilistId: title.id, serverId: show.series.serverId, seriesId: show.series.id, rule, certain: rule !== "S4", episodes }
}

/** The episodes of the one regular season, numbered by `IndexNumber` */
function byIndexInOneSeason(show: ServerShow, number: (index: number) => number | null): EpisodeMatch[] {
    const pairs: EpisodeMatch[] = []
    for (const episode of show.episodes) {
        if (seasonNumberOf(show, episode) === 0 || episode.index === null) continue
        const anilist = number(episode.index)
        if (anilist !== null && anilist >= 1) pairs.push({ episode: anilist, serverEpisodeId: episode.id })
    }
    return pairs.sort((a, b) => a.episode - b.episode)
}

export function matchS1(title: AnilistTitle, shows: ServerShow[]): TitleMatch | null {
    const id = String(title.id)
    const carries = (ids: Record<string, string>) => providerId(ids, "AniList") === id
    const show = shows.find(show => regularSeasons(show).length === 1
        && (carries(show.series.providerIds) || show.seasons.some(season => season.index !== 0 && carries(season.providerIds))))
    return show ? matchOf(title, show, "S1", byIndexInOneSeason(show, index => index)) : null
}

/** The series found by the title's AniDB, Tvdb or Tmdb number (in that order) */
export function showByIds(title: AnilistTitle, shows: ServerShow[]): ServerShow | null {
    const mappings = title.metadata && isRecord(title.metadata.mappings) ? title.metadata.mappings : {}
    for (const [ours, key] of [["anidbId", "AniDB"], ["thetvdbId", "Tvdb"], ["themoviedbId", "Tmdb"]] as const) {
        const value = mappings[ours]
        if ((typeof value !== "number" && typeof value !== "string") || String(value) === "" || String(value) === "0") continue
        const show = shows.find(show => providerId(show.series.providerIds, key) === String(value))
        if (show) return show
    }
    return null
}

export function matchS2(title: AnilistTitle, show: ServerShow | null): TitleMatch | null {
    if (!show) return null
    const pairs: EpisodeMatch[] = []
    for (const ani of aniEpisodes(title.metadata)) {
        if (ani.season === null || ani.number === null || ani.number < 1) continue
        const file = show.episodes.find(episode => seasonNumberOf(show, episode) === ani.season && episode.index === ani.number)
        if (file) pairs.push({ episode: ani.episode, serverEpisodeId: file.id })
    }
    return matchOf(title, show, "S2", pairs)
}

export function matchS3(title: AnilistTitle, show: ServerShow | null): TitleMatch | null {
    if (!show || regularSeasons(show).length !== 1) return null
    const byAbsolute = new Map<number, number>()
    for (const ani of aniEpisodes(title.metadata)) if (ani.absolute !== null && ani.absolute >= 1) byAbsolute.set(ani.absolute, ani.episode)
    return matchOf(title, show, "S3", byIndexInOneSeason(show, index => byAbsolute.get(index) ?? null))
}

export function matchS4(title: AnilistTitle, shows: ServerShow[]): TitleMatch | null {
    let best: { show: ServerShow, season: number | null, score: number } | null = null
    for (const show of shows) {
        const seasons = regularSeasons(show)
        for (const season of seasons) {
            const entry = show.seasons.find(item => (item.index ?? -1) === season)
            const year = entry?.year || show.series.year
            if (title.year && year && Math.abs(title.year - year) > 1) continue
            const label = seasons.length === 1 || season < 1 ? show.series.name : `${show.series.name} Season ${season}`
            const score = Math.max(0, ...title.titles.map(name => titleScore(label, 0, name)))
            if (score >= TITLE_ONLY_AT && (!best || score > best.score)) best = { show, season: season < 0 ? null : season, score }
        }
    }
    if (!best) return null
    const { show, season } = best
    const pairs = show.episodes
        .filter(episode => seasonNumberOf(show, episode) === season && episode.index !== null && episode.index >= 1)
        .map(episode => ({ episode: episode.index as number, serverEpisodeId: episode.id }))
        .sort((a, b) => a.episode - b.episode)
    return matchOf(title, show, "S4", pairs)
}

/** The choice between the rules' results in rule order (rule "Choice" above) */
export function chooseRule(results: (TitleMatch | null)[], aired: number): TitleMatch | null {
    let current: TitleMatch | null = null
    for (const next of results) {
        if (!next || !next.episodes.length) continue
        const found = current?.episodes.length ?? 0
        if (!current || (found < aired / 2 && next.episodes.length > found)) current = next
    }
    return current
}

/** The server episodes of one title, or null when no rule finds any */
export function matchTitle(title: AnilistTitle, shows: ServerShow[]): TitleMatch | null {
    const byIds = showByIds(title, shows)
    const aired = title.aired || aniEpisodes(title.metadata).length
    return chooseRule([matchS1(title, shows), matchS2(title, byIds), matchS3(title, byIds), matchS4(title, shows)], aired)
}

/** The matches of many titles, checked so that no server episode belongs to two titles */
export function matchLibrary(titles: AnilistTitle[], shows: ServerShow[]): TitleMatch[] {
    const matches = titles.map(title => matchTitle(title, shows)).filter((match): match is TitleMatch => match !== null)
    const rank = (match: TitleMatch) => (match.certain ? 0 : RULES.length) + RULES.indexOf(match.rule)
    const claims = new Map<string, TitleMatch[]>()
    for (const match of matches) {
        for (const pair of match.episodes) claims.set(pair.serverEpisodeId, [...(claims.get(pair.serverEpisodeId) ?? []), match])
    }
    const lost = new Map<TitleMatch, Set<string>>()
    for (const [file, claimants] of claims) {
        if (claimants.length < 2) continue
        const best = Math.min(...claimants.map(rank))
        const winners = claimants.filter(match => rank(match) === best)
        for (const match of claimants) {
            if (winners.length === 1 && match === winners[0]) continue
            lost.set(match, (lost.get(match) ?? new Set()).add(file))
        }
    }
    return matches
        .map(match => ({ ...match, episodes: match.episodes.filter(pair => !lost.get(match)?.has(pair.serverEpisodeId)) }))
        .filter(match => match.episodes.length > 0)
}
