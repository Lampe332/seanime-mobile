import { atom } from "jotai"
import { atomWithStorage } from "@/lib/storage"

export const __onlinestream_selectedProviderAtom = atomWithStorage<string | null>("sea-onlinestream-provider", null)

export type OnlinestreamAudioTrackPreference = {
    trackId?: number
    language?: string
    name?: string
}

export type OnlinestreamSubtitlePreference = {
    off?: boolean
    language?: string
    label?: string
}

export const __onlinestream_dubbedPreferenceByMediaAtom = atomWithStorage<Record<string, boolean>>(
    "sea-onlinestream-dubbed-preference-by-media",
    {})

export const __onlinestream_audioTrackPreferenceByMediaAtom = atomWithStorage<Record<string, OnlinestreamAudioTrackPreference>>(
    "sea-onlinestream-audio-track-preference-by-media",
    {})

export const __onlinestream_subtitlePreferenceByMediaAtom = atomWithStorage<Record<string, OnlinestreamSubtitlePreference>>(
    "sea-onlinestream-subtitle-preference-by-media",
    {})

// Variable used for the episode source query
export const __onlinestream_selectedEpisodeNumberAtom = atom<number | null>(null)

export const __onlinestream_selectedServerAtom = atomWithStorage<string | undefined>("sea-onlinestream-server",
    undefined)

export const __onlinestream_qualityAtom = atomWithStorage<string | undefined>("sea-onlinestream-quality", undefined)
