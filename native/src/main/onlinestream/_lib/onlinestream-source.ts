import type { MobileOfflineDownload_Variables } from "@/api/generated/endpoint.types"
import type { AL_BaseAnime, Onlinestream_EpisodeSource, Onlinestream_Episode, Onlinestream_VideoSource } from "@/api/generated/types"
import type { OnlinestreamSubtitlePreference } from "./onlinestream.atoms"
import { findPreferredSubtitleTrack, isDefaultSubtitleTrack } from "./onlinestream-subtitle-preference"

/*
 * The source choice of the online stream page (web onlinestream-page.tsx: videoSources, servers, videoSource, the
 * stream URL effect), as plain rules so the screen and the tests share them.
 */

function normalizeLabel(value: string | null | undefined) {
    return value?.trim().toLowerCase() ?? null
}

function qualityResolution(value: string | null | undefined) {
    const normalized = normalizeLabel(value)
    if (!normalized) return null
    return normalized.match(/\b(\d{3,4}p|auto|default)\b/i)?.[1]?.toLowerCase() ?? null
}

/** Only real URLs may reach the player; status-only entries stay in the server list so a hoster remains selectable. */
export function playableVideoSources(source: Onlinestream_EpisodeSource | undefined, server: string | undefined) {
    const seen = new Set<string>()
    return (source?.videoSources ?? []).filter(item => {
        if (item.server !== server || !item.url?.trim()) return false
        const key = `${item.url}|${item.quality}|${item.server}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

/** The servers of an episode: the ones with a status first, then those that only have sources. */
export function episodeServers(source: Onlinestream_EpisodeSource | undefined) {
    if (!source) return []
    const names = [
        ...(source.servers ?? []).map(status => status.server),
        ...(source.videoSources ?? []).map(item => item.server),
    ].filter((value): value is string => !!value?.trim())
    return [...new Set(names)]
}

/**
 * The source to play for the stored quality: the exact label, else the same resolution, else "auto"/"default", else the
 * best of 1080p/720p/480p/360p (preferring "default" among them).
 */
export function chooseVideoSource(sources: Onlinestream_VideoSource[], server: string | undefined, quality: string | undefined) {
    let filtered = [...sources]
    if (server && filtered.some(n => n.server === server)) filtered = filtered.filter(n => n.server === server)
    const normalizedQuality = normalizeLabel(quality)
    const preferredResolution = qualityResolution(quality)
    const hasExactQuality = !!normalizedQuality && filtered.some(n => normalizeLabel(n.quality) === normalizedQuality)
    const hasPreferredResolution = !!preferredResolution && filtered.some(n => qualityResolution(n.quality) === preferredResolution)
    const hasAuto = filtered.some(n => n.quality === "auto")

    if (hasExactQuality) {
        filtered = filtered.filter(n => normalizeLabel(n.quality) === normalizedQuality)
    } else if (hasPreferredResolution) {
        filtered = filtered.filter(n => qualityResolution(n.quality) === preferredResolution)
    } else if (hasAuto) {
        filtered = filtered.filter(n => n.quality.toLowerCase() === "auto" || n.quality.toLowerCase().includes("default"))
    } else {
        for (const resolution of ["1080p", "720p", "480p", "360p"]) {
            if (filtered.some(n => n.quality.includes(resolution))) {
                filtered = filtered.filter(n => n.quality.includes(resolution))
                break
            }
        }
        if (filtered.some(n => n.quality.includes("default"))) filtered = filtered.filter(n => n.quality.includes("default"))
    }
    return filtered[0]
}

/** The server's proxy URL for a source that needs headers (web onlinestream-proxy.ts); tokenQuery starts with "&". */
export function proxyUrl(baseUrl: string, url: string, headers: Record<string, string>, tokenQuery: string) {
    return `${baseUrl}/api/v1/proxy?url=${encodeURIComponent(url)}&headers=${encodeURIComponent(JSON.stringify(headers))}${tokenQuery}`
}

export type OnlineStream = {
    url: string
    subtitles: { index: number, label: string, language: string, src: string, default: boolean }[]
}

/**
 * The URL the player gets, with its subtitle files: a source with headers goes through the server's proxy (which sends
 * the headers to the provider), the others are played directly.
 */
export function buildOnlineStream(source: Onlinestream_VideoSource, baseUrl: string, tokenQuery: string): OnlineStream {
    const headers = source.headers
    const shouldProxy = !!headers && Object.keys(headers).length > 0
    const wrap = (url: string) => shouldProxy ? proxyUrl(baseUrl, url, headers!, tokenQuery) : url
    return {
        url: wrap(source.url),
        subtitles: (source.subtitles ?? []).map((sub, index) => ({
            index,
            label: sub.language,
            language: sub.language,
            src: wrap(sub.url),
            default: !!isDefaultSubtitleTrack(source.subtitles ?? [], index),
        })),
    }
}

/** Whether a source needs the proxy, i.e. whether its stream URL carries the app's token. */
export function needsProxy(source: Onlinestream_VideoSource) {
    return !!source.headers && Object.keys(source.headers).length > 0
}

/**
 * "Save this episode" in the player: the provider's own URL, headers and subtitle files, never the proxy URL the player
 * plays (that one carries the app's token; the Go server downloads from the provider itself and never sends its token
 * there). Offline downloads only take whole episode numbers.
 */
export function onlineDownloadRequest({ media, episode, source, dubbed }: {
    media: AL_BaseAnime
    episode: Onlinestream_Episode
    source: Onlinestream_VideoSource
    dubbed: boolean
}): MobileOfflineDownload_Variables | null {
    if (!Number.isInteger(episode.number) || !source.url?.trim()) return null
    return {
        key: "",
        url: source.url,
        type: source.type === "m3u8" ? "m3u8" : "mp4",
        headers: source.headers ?? {},
        subtitles: (source.subtitles ?? []).map((sub, index) => ({
            url: sub.url,
            language: sub.language,
            isDefault: !!isDefaultSubtitleTrack(source.subtitles ?? [], index),
        })),
        mediaId: media.id,
        episode: String(episode.number),
        dubbed,
        quality: source.quality,
        title: media.title?.userPreferred || media.title?.romaji || "",
        coverUrl: media.coverImage?.extraLarge || media.coverImage?.large || "",
        bannerUrl: media.bannerImage || "",
        episodeTitle: episode.title || episode.metadata?.episodeTitle || "",
        episodeImageUrl: episode.image || episode.metadata?.episodeMetadata?.image || "",
        episodeDescription: episode.description || "",
    }
}

/**
 * The subtitle of an online stream once mpv lists its tracks (web OnlinestreamSubtitlePreferenceSync): the one saved for
 * this anime (-1 = off), else null so the player's usual choice (track memory, preferred languages) runs.
 */
export function preferredOnlineSubtitle(tracks: { id: number, type: string, lang: string, title: string }[], preference: OnlinestreamSubtitlePreference | undefined) {
    if (!preference) return null
    if (preference.off) return -1
    const subs = tracks.filter(track => track.type === "sub").map(track => ({ number: track.id, language: track.lang, label: track.title }))
    return findPreferredSubtitleTrack(subs, preference)?.number ?? null
}
