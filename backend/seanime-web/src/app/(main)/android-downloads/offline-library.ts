export type OfflineEpisode = {
    id: string, mediaId?: number, title: string, episode: number | string, ready: boolean,
    status: "ready" | "paused" | "failed" | "downloading" | "removing" | "queued" | "resolving", progress: number, bytes: number, position: number,
    quality?: string, provider?: string, description?: string, genres?: string[], year?: number,
    format?: string, totalEpisodes?: number, duration?: number, score?: number,
    coverAsset?: string, bannerAsset?: string, episodeImageAsset?: string,
    episodeTitle?: string, episodeDescription?: string, airDate?: string,
}

export const offlineAsset = (key?: string) => key && /^[a-f0-9]{64}\.jpg$/.test(key) ? `/__android_offline/${key}` : undefined
export const animeKey = (episode: OfflineEpisode) => episode.mediaId ? `media-${episode.mediaId}` : `title-${episode.title}`

export function groupEpisodes(episodes: OfflineEpisode[]) {
    const groups = new Map<string, OfflineEpisode[]>()
    episodes.forEach(episode => { const key = animeKey(episode); groups.set(key, [...(groups.get(key) || []), episode]) })
    return [...groups.entries()].sort((a, b) => a[1][0].title.localeCompare(b[1][0].title))
        .map(([key, values]) => ({ key, episodes: values.sort((a, b) => Number(a.episode) - Number(b.episode)) }))
}

/** Anything the native manager is still working on: queued, loading, paused, failed or being deleted. */
export const isActive = (episode: OfflineEpisode) => !episode.ready
export const canResume = (episode: OfflineEpisode) => episode.status === "paused" || episode.status === "failed"

/** The episode the detail page offers to play: the first one already started, else the first saved one. */
export function nextEpisode(episodes: OfflineEpisode[]) {
    const ready = episodes.filter(episode => episode.ready)
    return ready.find(episode => episode.position > 0) || ready[0]
}

/** Saved episodes with a stored position, for the "Continue offline" row. */
export const startedEpisodes = (episodes: OfflineEpisode[]) => episodes.filter(episode => episode.ready && episode.position > 0)

/** Share of the episode watched (0-1) when its runtime is known. */
export function watchedShare(episode: OfflineEpisode) {
    if (!episode.duration || episode.duration <= 0) return undefined
    return Math.min(1, Math.max(0, episode.position / (episode.duration * 60000)))
}

/**
 * Poll the native snapshot every second only while something moves. Paused, failed and saved episodes change
 * only through actions on this page (which refresh themselves) or elsewhere in the app (caught by focus / visibility).
 */
export const OFFLINE_ACTIVE_POLL_MS = 1000
const moving = new Set<OfflineEpisode["status"]>(["downloading", "queued", "resolving", "removing"])
/** Manga chapters come from the server queue: quick while one loads, slow while others wait, idle otherwise. */
export const mangaPollDelay = (queue: { status: string }[]) => queue.some(item => item.status === "downloading") ? 2000
    : queue.some(item => item.status !== "errored") ? 5000 : null
export const offlinePollDelay =(episodes: OfflineEpisode[]) => episodes.some(episode => !episode.ready && moving.has(episode.status))
    ? OFFLINE_ACTIVE_POLL_MS : null
