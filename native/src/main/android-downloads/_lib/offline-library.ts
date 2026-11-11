import type { MobileOfflineBatch_Variables } from "@/api/generated/endpoint.types"
import type { AL_BaseAnime, MobileOffline_Item, MobileOffline_Snapshot, Onlinestream_Episode } from "@/api/generated/types"
import type { Translate } from "@/lib/app-language"

/*
 * Rules of the Downloads tab (web android-downloads/offline-library.ts + page.tsx, OfflineActivity.kt), on the Go
 * server's items (backend/internal/mobileoffline). Pure functions, tested in offline-library.test.ts.
 */

export type OfflineItem = MobileOffline_Item
export type OfflineGroup = { key: string, items: OfflineItem[] }

/** One anime: by AniList id, by title when the id is missing. */
export const animeKey = (item: OfflineItem) => item.mediaId ? `media-${item.mediaId}` : `title-${item.title ?? ""}`

const episodeNumber = (item: OfflineItem) => Number(item.episode) || 0

/** Anime sorted by title, their episodes by number. A row without a title must not take the whole page down. */
export function groupItems(items: OfflineItem[]): OfflineGroup[] {
    const groups = new Map<string, OfflineItem[]>()
    for (const item of items) {
        const key = animeKey(item)
        groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.entries()]
        .sort((a, b) => (a[1][0].title ?? "").localeCompare(b[1][0].title ?? ""))
        .map(([key, values]) => ({ key, items: values.slice().sort((a, b) => episodeNumber(a) - episodeNumber(b)) }))
}

/** Anything the server still works on: queued, preparing, loading, paused or failed. */
export const isActive = (item: OfflineItem) => !item.ready
export const canResume = (item: OfflineItem) => item.status === "paused" || item.status === "failed"
/** A failed download is retried (fresh source), a paused one resumed (the partial file continues). */
export const resumeAction = (item: OfflineItem) => item.status === "failed" ? "retry" : "resume"
/** A download that loaded part of the file keeps showing how far it got, also while paused or failed. */
export const showsProgress = (item: OfflineItem) => !item.ready && item.progress > 0

export function stateLabel(item: OfflineItem, t: Translate): string {
    switch (item.status) {
        case "ready": return t("Available offline", "Offline verfügbar")
        case "paused": return t("Paused", "Pausiert")
        case "failed": return t("Failed", "Fehlgeschlagen")
        case "downloading": return t("Downloading", "Wird geladen")
        case "queued": return t("Queued", "In der Warteschlange")
        case "resolving": return t("Preparing source", "Quelle wird vorbereitet")
        default: return item.status
    }
}

/** Under this position an episode was only opened by accident, not started. */
export const STARTED_MS = 10000
const started = (item: OfflineItem) => item.ready && item.position >= STARTED_MS

/** The episode the detail page offers to play: the first one already started, else the first saved one. */
export function nextEpisode(items: OfflineItem[]): OfflineItem | undefined {
    return items.find(started) ?? items.find(item => item.ready)
}

/** Saved episodes with a stored position, for the "Continue offline" row. */
export const startedItems = (items: OfflineItem[]) => items.filter(started)

/** Share of the episode watched (0-1) when its runtime (minutes) is known. */
export function watchedShare(item: OfflineItem): number | undefined {
    if (!item.duration || item.duration <= 0) return undefined
    return Math.min(1, Math.max(0, item.position / (item.duration * 60000)))
}

/** The next saved episode after this one in the same anime (auto next in the offline player). */
export function followingEpisode(items: OfflineItem[], current: OfflineItem): OfflineItem | undefined {
    const number = episodeNumber(current)
    return items
        .filter(item => item.ready && item.id !== current.id && animeKey(item) === animeKey(current) && episodeNumber(item) > number)
        .sort((a, b) => episodeNumber(a) - episodeNumber(b))[0]
}

// No-break space: a narrow card must not leave the unit alone on the next line ("1.4" / "GB")
export function formatSize(bytes: number, language: string): string {
    return bytes >= 1024 ** 3
        ? `${(bytes / 1024 ** 3).toLocaleString(language, { maximumFractionDigits: 1 })} GB`
        : `${(bytes / 1024 ** 2).toLocaleString(language, { maximumFractionDigits: 0 })} MB`
}

export const clock = (positionMs: number) =>
    `${Math.floor(positionMs / 60000).toString().padStart(2, "0")}:${Math.floor(positionMs / 1000 % 60).toString().padStart(2, "0")}`

/** AniList descriptions carry HTML; the detail shows plain text. */
export const plainText = (value?: string) => (value ?? "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim()

export const episodeWord = (count: number, t: Translate) => count === 1 ? t("episode", "Folge") : t("episodes", "Folgen")

export const totalBytes = (items: OfflineItem[]) => items.reduce((sum, item) => sum + item.bytes, 0)

/** Columns of the saved episodes (OfflineActivity.kt columns()): one on phones, a grid of 320dp cells from 600dp. */
export function offlineColumns(widthDp: number): number {
    if (widthDp < 600) return 1
    return Math.min(4, Math.max(2, Math.floor(widthDp / 320)))
}

export type DownloadFilter = "all" | "ready" | "active"

export function filterGroups(groups: OfflineGroup[], filter: DownloadFilter): OfflineGroup[] {
    if (filter === "all") return groups
    return groups.filter(group => group.items.some(item => filter === "ready" ? item.ready : isActive(item)))
}

/**
 * Episode numbers of an anime the queue already holds in that audio (episode-download-picker.tsx): saved or on their
 * way, failed ones may be queued again. Old rows without an audio language compare by the dub flag.
 */
export function storedEpisodes(items: OfflineItem[] | undefined, mediaId: number, dubbed: boolean): Set<number> {
    const language = dubbed ? "de" : "ja"
    return new Set((items ?? [])
        .filter(item => item.mediaId === mediaId && item.status !== "failed"
            && (item.audioLanguage ? item.audioLanguage === language : item.dubbed === dubbed))
        .map(episodeNumber))
}

/** The picker's quick selections: the whole season, from the current episode on, only the current one. */
export function downloadPresets(available: number[], current: number | null) {
    const from = current || 1
    return {
        season: available,
        from: available.filter(number => number >= from),
        this: current !== null && available.includes(current) ? [current] : [],
    }
}

/**
 * POST /mobile-offline/batch for the picked episodes of an online stream (episode-download-picker.tsx submit): the
 * provider, server, quality ("Auto" when none) and audio the stream page plays with, the anime's title and artwork, each
 * episode's title, picture and a short description (400 characters, as before). The server resolves each source only
 * once a download slot is free.
 */
export function batchRequest(media: AL_BaseAnime, episodes: Onlinestream_Episode[], picked: Set<number>,
    source: { provider: string, server: string | null, quality: string | null, dubbed: boolean }): MobileOfflineBatch_Variables {
    return {
        mediaId: media.id,
        provider: source.provider,
        server: source.server ?? "",
        quality: source.quality || "Auto",
        dubbed: source.dubbed,
        title: media.title?.userPreferred || media.title?.romaji || "Anime",
        coverUrl: media.coverImage?.extraLarge || media.coverImage?.large || "",
        bannerUrl: media.bannerImage ?? "",
        episodes: episodes.filter(episode => picked.has(episode.number)).sort((a, b) => a.number - b.number).map(episode => ({
            number: episode.number,
            title: episode.title || episode.metadata?.episodeTitle || "",
            image: episode.image || episode.metadata?.episodeMetadata?.image || "",
            description: (episode.description || episode.metadata?.episodeMetadata?.summary || "").slice(0, 400),
        })),
    }
}

export type OfflineNotice =
    | { kind: "finished", item: OfflineItem }
    | { kind: "failed", item: OfflineItem }
    | { kind: "waiting-wifi" }
    | { kind: "waiting-wifi-over" }

/**
 * What the download notices (EpisodeDownloads.kt notifyResult / updateWaitingNotice) announce between two snapshots:
 * an episode that became ready, one that failed (once per failure), and the start and end of "waiting for Wi-Fi".
 * The first snapshot after the app starts only sets the baseline, so old results are not announced again.
 */
export function offlineNotices(previous: MobileOffline_Snapshot | undefined, next: MobileOffline_Snapshot): OfflineNotice[] {
    if (!previous) return []
    const before = new Map((previous.items ?? []).map(item => [item.id, item]))
    const notices: OfflineNotice[] = []
    for (const item of next.items ?? []) {
        // an episode queued and finished between two snapshots counts as new
        const old = before.get(item.id)
        if (item.ready && !old?.ready) notices.push({ kind: "finished", item })
        else if (item.status === "failed" && old?.status !== "failed") notices.push({ kind: "failed", item })
    }
    const wasWaiting = previous.waiting === "wifi"
    const waiting = next.waiting === "wifi"
    if (waiting && !wasWaiting) notices.push({ kind: "waiting-wifi" })
    if (!waiting && wasWaiting) notices.push({ kind: "waiting-wifi-over" })
    return notices
}

/** "Title · Episode 3" of a notice; "Anime episode" without a saved title. */
export function noticeName(item: OfflineItem, t: Translate): string {
    return [item.title || t("Anime episode", "Anime-Folge"), item.episode ? t(`Episode ${item.episode}`, `Folge ${item.episode}`) : null]
        .filter(Boolean).join(" · ")
}
