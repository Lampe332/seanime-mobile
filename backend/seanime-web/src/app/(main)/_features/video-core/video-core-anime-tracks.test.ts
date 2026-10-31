import { rememberAnimeTrack, withAnimeTracks } from "@/app/(main)/_features/video-core/video-core-anime-tracks"
import type { VideoCoreSettings } from "@/app/(main)/_features/video-core/video-core.atoms"
import { beforeEach, describe, expect, it, vi } from "vitest"

const store = new Map<string, string>()
vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    clear: () => store.clear(),
})

const settings = { preferredAudioLanguage: "jpn,jp", preferredSubtitleLanguage: "en,eng" } as VideoCoreSettings

describe("anime tracks", () => {
    beforeEach(() => localStorage.clear())

    it("puts the remembered languages first for that anime only", () => {
        rememberAnimeTrack(21087, "audio", "ger")
        rememberAnimeTrack(21087, "subtitle", "none")
        expect(withAnimeTracks(settings, 21087)).toMatchObject({ preferredAudioLanguage: "ger,jpn,jp", preferredSubtitleLanguage: "none,en,eng" })
        expect(withAnimeTracks(settings, 176496)).toBe(settings)
        expect(withAnimeTracks(settings, undefined)).toBe(settings)
    })

    it("keeps nothing without a language or an anime", () => {
        rememberAnimeTrack(21087, "audio", "")
        rememberAnimeTrack(undefined, "audio", "ger")
        expect(withAnimeTracks(settings, 21087)).toBe(settings)
    })

    it("keeps the latest choice", () => {
        rememberAnimeTrack(1, "subtitle", "ger")
        rememberAnimeTrack(1, "subtitle", "eng")
        expect(withAnimeTracks(settings, 1).preferredSubtitleLanguage).toBe("eng,en,eng")
    })
})
