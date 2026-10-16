import type { AL_ListRecentAnime, Anime_ScheduleItem } from "@/api/generated/types"
import { addDays, isValid, parseISO, startOfDay } from "date-fns"

type PageRequest = { page: number, perPage: number, airingAt_greater: number, airingAt_lesser: number, notYetAired: boolean, sort: ["TIME"] }

/** AniList uses strict timestamp bounds. Request a whole local day, including midnight. */
export async function fetchGlobalScheduleDay(date: string, fetchPage: (variables: PageRequest) => Promise<AL_ListRecentAnime | undefined>, signal?: AbortSignal): Promise<Anime_ScheduleItem[]> {
    const start = startOfDay(parseISO(date))
    if (!isValid(start)) throw new Error("Ungültiges Kalenderdatum")
    const end = addDays(start, 1)
    const rows = new Map<number, Anime_ScheduleItem>()
    const seen = new Set<number>()
    for (let page = 1; ; page++) {
        signal?.throwIfAborted()
        const result = await fetchPage({ page, perPage: 50, airingAt_greater: Math.floor(start.getTime() / 1000) - 1, airingAt_lesser: Math.floor(end.getTime() / 1000), notYetAired: false, sort: ["TIME"] })
        signal?.throwIfAborted()
        if (!result?.Page || !Array.isArray(result.Page.airingSchedules)) throw new Error("AniList hat keine gültigen Kalenderdaten geliefert")
        let added = 0
        for (const row of result.Page.airingSchedules) {
            if (seen.has(row.id)) continue
            seen.add(row.id); added++
            const media = row.media
            if (!media || media.type !== "ANIME" || row.airingAt * 1000 < start.getTime() || row.airingAt * 1000 >= end.getTime()) continue
            rows.set(row.id, { mediaId: media.id, title: media.title?.userPreferred || media.title?.romaji || media.title?.english || "Anime", time: "", dateTime: new Date(row.airingAt * 1000).toISOString(), image: media.coverImage?.large || media.coverImage?.medium || "", episodeNumber: row.episode, isMovie: media.format === "MOVIE", isSeasonFinale: !!media.episodes && row.episode === media.episodes })
        }
        if (!result.Page.pageInfo?.hasNextPage) break
        if (!added) throw new Error("AniList-Ergebnisseiten konnten nicht vollständig geladen werden")
    }
    return [...rows.values()].sort((a, b) => a.dateTime!.localeCompare(b.dateTime!) || a.mediaId - b.mediaId || a.episodeNumber - b.episodeNumber)
}
