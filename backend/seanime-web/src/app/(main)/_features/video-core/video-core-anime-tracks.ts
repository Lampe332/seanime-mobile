import type { VideoCoreSettings } from "@/app/(main)/_features/video-core/video-core.atoms"

// The audio and subtitle languages picked for an anime; its next episodes start with them before the global defaults
const STORAGE_KEY = "sea-video-core-anime-tracks"
const MAX_ANIME = 300

type AnimeTracks = Record<string, { audio?: string, subtitle?: string }>

function read(): AnimeTracks {
    try {
        return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {}) as AnimeTracks
    }
    catch {
        return {}
    }
}

/** `language` is the track's language code; "none" for subtitles turned off. Nothing is kept without a language. */
export function rememberAnimeTrack(mediaId: number | undefined, kind: "audio" | "subtitle", language: string | undefined | null) {
    const value = language?.trim()
    if (!mediaId || !value) return
    const all = read()
    const key = String(mediaId)
    // re-inserting moves the anime to the end, so the oldest ones go first when there are too many
    const entry = { ...all[key], [kind]: value }
    delete all[key]
    all[key] = entry
    const keys = Object.keys(all)
    for (const old of keys.slice(0, Math.max(keys.length - MAX_ANIME, 0))) delete all[old]
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    }
    catch {
    }
}

/** The settings with this anime's remembered languages in front of the preferred ones. */
export function withAnimeTracks(settings: VideoCoreSettings, mediaId: number | undefined): VideoCoreSettings {
    const tracks = mediaId ? read()[String(mediaId)] : undefined
    if (!tracks) return settings
    return {
        ...settings,
        preferredAudioLanguage: tracks.audio ? `${tracks.audio},${settings.preferredAudioLanguage}` : settings.preferredAudioLanguage,
        preferredSubtitleLanguage: tracks.subtitle ? `${tracks.subtitle},${settings.preferredSubtitleLanguage}` : settings.preferredSubtitleLanguage,
    }
}
