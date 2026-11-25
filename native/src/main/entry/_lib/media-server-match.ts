import type { MediaServerMapping, MediaServerSeason, MediaServerStatus } from "@/api/hooks/mediaserver.hooks"

/*
 * "Change match" of a media server series (media-server-match-sheet.tsx): what the sheet shows and what it saves. The
 * core subtracts the offset (server episode 1 with offset -12 is AniList episode 13), so the sheet asks for the AniList
 * episode of server episode 1 and works the offset out itself.
 */

/** The series the sheet is about: the match of an anime page, or a series of "Not matched" */
export type MatchSubject = {
    seriesId: string
    name: string
    year: number
    episodes: number
    seasons: MediaServerSeason[]
    /** how it is matched now; "none" for a series of "Not matched" */
    rule: MediaServerMapping["rule"] | "none"
    /** the rows made by hand (`itemId`: the series or a season) */
    mappings: { itemId: string, episodeOffset: number }[]
    /** the title picked when the sheet opens: the current one, or the core's suggestion */
    title: { id: number, title: string } | null
}

export function subjectOfMapping(mapping: MediaServerMapping, title: string): MatchSubject {
    return {
        seriesId: mapping.seriesId, name: mapping.name, year: mapping.year, episodes: mapping.episodes, seasons: mapping.seasons,
        rule: mapping.rule, mappings: mapping.mappings, title: { id: mapping.anilistId, title },
    }
}

export function subjectOfUnmatched(show: MediaServerStatus["unmatched"][number]): MatchSubject {
    return {
        seriesId: show.seriesId, name: show.name, year: show.year, seasons: show.seasons,
        episodes: show.seasons.reduce((sum, season) => sum + season.episodes, 0),
        rule: "none", mappings: [], title: show.suggestion ? { id: show.suggestion.anilistId, title: show.suggestion.title } : null,
    }
}

/** "Server episode 1 is AniList episode N" as the core's offset (subtracted from the server's number) */
export function offsetFromFirstEpisode(firstEpisode: number): number {
    return 1 - firstEpisode
}

/** The other way round, to fill the field from a match made by hand */
export function firstEpisodeFromOffset(offset: number): number {
    return 1 - offset
}

/** The field's text as an episode number (a whole number of at least 1), or null */
export function parseFirstEpisode(text: string): number | null {
    const trimmed = text.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const value = Number(trimmed)
    return Number.isSafeInteger(value) && value >= 1 ? value : null
}

/**
 * What gets saved: a season only when the series has more than one and the picked one is among them, otherwise the
 * whole series.
 */
export function matchItemId(subject: Pick<MatchSubject, "seriesId" | "seasons">, seasonId: string | null): string {
    if (seasonId && subject.seasons.length > 1 && subject.seasons.some(season => season.id === seasonId)) return seasonId
    return subject.seriesId
}

/** The field's start value for the picked item: from its match made by hand, else 1 */
export function startFirstEpisode(subject: Pick<MatchSubject, "mappings">, itemId: string): number {
    const row = subject.mappings.find(mapping => mapping.itemId === itemId)
    return row ? Math.max(1, firstEpisodeFromOffset(row.episodeOffset)) : 1
}

/** How the series is matched now, as a kind the sheet names */
export function ruleKind(rule: MatchSubject["rule"]): "numbers" | "title" | "manual" | "none" {
    if (rule === "manual") return "manual"
    if (rule === "S4") return "title"
    if (rule === "none") return "none"
    return "numbers"
}
