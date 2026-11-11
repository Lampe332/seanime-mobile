import type { AL_BaseAnime, AL_BaseManga, Anime_EntryLibraryData, Anime_NakamaEntryLibraryData, Nullish } from "@/api/generated/types"
import { anilist_getCurrentEpisodes } from "@/lib/helpers/media"

/*
 * What a media card shows, from media-entry-card.tsx / -components.tsx / anime-entry-card-unwatched-badge.tsx of the web
 * app (pure, so it is tested without React Native).
 */

type ListData = Nullish<{ progress?: number, status?: string, score?: number }>

/** The page a card opens, at the web app's paths: the anime page or the manga page. */
export function mediaEntryHref(type: "anime" | "manga", mediaId: number) {
    return type === "manga" ? `/manga/entry?id=${mediaId}` : `/entry?id=${mediaId}`
}

/** Episodes (anime) or chapters (manga) the progress counts against. */
export function cardProgressTotal(type: "anime" | "manga", media: Nullish<AL_BaseAnime | AL_BaseManga>) {
    return type === "anime" ? (media as AL_BaseAnime | undefined)?.episodes : (media as AL_BaseManga | undefined)?.chapters
}

/**
 * The thin progress line on top of the cover. The web condition reads `progress && anime ? episodes : chapters && not
 * completed` (operator precedence kept as shipped); the body then also needs progress and a total and hides it for
 * completed entries.
 */
export function cardProgressBar(type: "anime" | "manga", media: Nullish<AL_BaseAnime | AL_BaseManga>, listData: ListData) {
    const total = cardProgressTotal(type, media)
    const episodes = (media as AL_BaseAnime | undefined)?.episodes
    const chapters = (media as AL_BaseManga | undefined)?.chapters
    const show = (!!listData?.progress && type === "anime") ? !!episodes : (!!chapters && listData?.status !== "COMPLETED")
    if (!show || !listData?.progress || !total || listData.status === "COMPLETED") return null
    return { percent: Math.min(100, Math.ceil((listData.progress / total) * 100)), current: listData.status === "CURRENT" }
}

/** The dark pill at the cover's foot: "6/12", manga always with a total ("7/-"); nothing without progress. */
export function cardProgressLabel(type: "anime" | "manga", progress: Nullish<number>, total: Nullish<number>) {
    if (!progress) return null
    if (!total && type !== "manga") return String(progress)
    return `${progress}/${total || "-"}`
}

/** Unwatched episodes of a series being watched: from the local files when it is in the library, else from AniList. */
export function cardUnwatchedCount(media: Nullish<AL_BaseAnime>, progress: Nullish<number>,
    libraryData?: Nullish<Anime_EntryLibraryData>, nakamaLibraryData?: Nullish<Anime_NakamaEntryLibraryData>) {
    const unwatched = anilist_getCurrentEpisodes(media) - (progress ?? 0)
    const fromLibrary = nakamaLibraryData?.unwatchedCount ?? libraryData?.unwatchedCount ?? 0
    const inLibrary = !!nakamaLibraryData?.mainFileCount || !!libraryData?.mainFileCount
    const count = inLibrary ? fromLibrary : unwatched
    return count > 0 ? count : 0
}

/** "Fall 2023": the season capitalised and the year (seasonYear for anime, else the start year). */
export function cardSeasonLine(media: Nullish<AL_BaseAnime | AL_BaseManga>) {
    const season = (media as AL_BaseAnime | undefined)?.season
    const year = (media as AL_BaseAnime | undefined)?.seasonYear ?? media?.startDate?.year
    const name = season ? season.charAt(0) + season.slice(1).toLowerCase() : ""
    return [name, year].filter(Boolean).join(" ")
}

/** The user's score badge colour (getScoreColor "user", as plain colours; Tailwind 4 has no bg-opacity). */
export function userScoreColor(score: number) {
    if (score < 40) return "rgba(220, 38, 38, 0.9)"
    if (score < 60) return "rgba(146, 64, 14, 0.9)"
    if (score < 70) return "rgba(101, 163, 13, 0.9)"
    if (score < 82) return "rgba(22, 163, 74, 0.9)"
    return "rgba(79, 70, 229, 0.8)"
}
