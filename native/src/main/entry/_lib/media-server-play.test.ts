import { describe, expect, it } from "vitest"
import type { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { isMediaServerEntry, mediaServerPlayError, playRouteOf, showsLibraryEpisodes } from "./media-server-play"

const episode = (marks: Record<string, unknown>) => ({ type: "main", progressNumber: 1, ...marks }) as unknown as Anime_Episode
const english = (en: string) => en
const german = (_en: string, de: string) => de

describe("which way a library episode starts", () => {
    it("sends server episodes to the media server and everything else the old way", () => {
        expect(playRouteOf(episode({ _isMediaServerEpisode: true }))).toBe("mediaserver")
        expect(playRouteOf(episode({ _isNakamaEpisode: true }))).toBe("nakama")
        expect(playRouteOf(episode({}))).toBe("local")
        expect(playRouteOf(episode({ _isMediaServerEpisode: "true" }))).toBe("local")
    })

    it("knows a server entry by its marker only", () => {
        expect(isMediaServerEntry({ _isMediaServerEntry: true } as unknown as Anime_Entry)).toBe(true)
        expect(isMediaServerEntry({ _isNakamaEntry: true } as unknown as Anime_Entry)).toBe(false)
        expect(isMediaServerEntry(undefined)).toBe(false)
    })
})

describe("why a server episode did not start", () => {
    it("says each of the core's reasons in plain words", () => {
        expect(mediaServerPlayError("The media server's address is missing", english)).toContain("address is missing")
        expect(mediaServerPlayError("Not signed in to a media server", german)).toContain("nicht beim Medienserver angemeldet")
        expect(mediaServerPlayError("The episode is not in the media server's library", english)).toContain("no longer on the media server")
        expect(mediaServerPlayError("Network request failed", german)).toBe("Die Folge konnte nicht vom Medienserver gestartet werden.")
    })
})

describe("when the library tab lists the entry's own episodes", () => {
    const entry = (fields: Record<string, unknown>) => ({ mediaId: 1, libraryData: { allFilesLocked: false }, ...fields }) as unknown as Anime_Entry

    it("lists a server title's episodes although the title is on none of the user's lists", () => {
        expect(showsLibraryEpisodes(entry({ _isMediaServerEntry: true }))).toBe(true)
    })

    it("keeps the old rule for everything else", () => {
        expect(showsLibraryEpisodes(entry({ listData: { progress: 0 } }))).toBe(true)
        expect(showsLibraryEpisodes(entry({ _isNakamaEntry: true }))).toBe(true)
        expect(showsLibraryEpisodes(entry({}))).toBe(false)
        expect(showsLibraryEpisodes(entry({ _isMediaServerEntry: true, libraryData: undefined }))).toBe(false)
    })
})
