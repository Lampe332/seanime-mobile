import type { Anime_LibraryCollection, Anime_PlaylistEpisode } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import {
    createPlaylistMutationGate, defaultPlaylistWatchType, MAX_PLAYLIST_EPISODES, movePlaylistEpisode, playlistAnimeChoices, playlistLibraryCollection, playlistNavigation, samePlaylistEpisode,
    selectPlaylistEpisodes, togglePlaylistEpisode, playlistBackStep, playlistDraftChanged,
} from "./mobile-playlist-state"

const ep = (media: number, n: number, anidb = String(n)) => ({ episode: { aniDBEpisode: anidb, episodeNumber: n, baseAnime: { id: media } } }) as unknown as Anime_PlaylistEpisode

describe("hardware Back in the playlist editor", () => {
    it("goes one step up and asks before the editor's changes are dropped", () => {
        expect(playlistBackStep("episodes", true)).toBe("anime")
        expect(playlistBackStep("anime", true)).toBe("editor")
        expect(playlistBackStep("delete", false)).toBe("editor")
        expect(playlistBackStep("editor", false)).toBe("list")
        expect(playlistBackStep("editor", true)).toBe("discard")
        // Back on the question keeps the draft
        expect(playlistBackStep("discard", true)).toBe("editor")
        expect(playlistBackStep("list", false)).toBe("close")
    })
    it("knows a changed draft: name, episodes, their order and source", () => {
        const opened = { name: "Evening", episodes: [ep(1, 1), ep(1, 2)] }
        expect(playlistDraftChanged(opened, { ...opened })).toBe(false)
        expect(playlistDraftChanged(opened, { ...opened, name: "Night" })).toBe(true)
        expect(playlistDraftChanged(opened, { ...opened, episodes: [ep(1, 2), ep(1, 1)] })).toBe(true)
        expect(playlistDraftChanged(opened, { ...opened, episodes: [ep(1, 1)] })).toBe(true)
        expect(playlistDraftChanged(opened, { ...opened, episodes: [{ ...ep(1, 1), watchType: "online" }, ep(1, 2)] })).toBe(true)
    })
})

describe("default playlist source", () => {
    it("preselects online streaming when it is the only source", () => {
        expect(defaultPlaylistWatchType({ torrent: false, debrid: false, online: true })).toBe("online")
    })
    it("keeps torrent before debrid before online", () => {
        expect(defaultPlaylistWatchType({ torrent: true, debrid: true, online: true })).toBe("torrent")
        expect(defaultPlaylistWatchType({ torrent: false, debrid: true, online: true })).toBe("debrid")
    })
    it("stays empty without any source", () => {
        expect(defaultPlaylistWatchType({ torrent: false, debrid: false, online: false })).toBe("")
    })
})

describe("playlist episodes", () => {
    it("matches by anime, AniDB episode and number (specials too)", () => {
        expect(samePlaylistEpisode(ep(1, 1), ep(1, 1))).toBe(true)
        expect(samePlaylistEpisode(ep(1, 1, "S1"), ep(1, 1))).toBe(false)
        expect(samePlaylistEpisode(ep(1, 1), null)).toBe(false)
    })
    it("toggles, keeps the limit", () => {
        expect(togglePlaylistEpisode([ep(1, 1)], ep(1, 1))).toEqual([])
        const full = Array.from({ length: MAX_PLAYLIST_EPISODES }, (_, i) => ep(2, i))
        expect(togglePlaylistEpisode(full, ep(3, 1))).toBe(full)
    })
    it("selects all of an anime, or deselects when all were chosen", () => {
        const avail = [ep(1, 1), ep(1, 2)]
        expect(selectPlaylistEpisodes([ep(9, 1)], avail)).toHaveLength(3)
        expect(selectPlaylistEpisodes([ep(9, 1), ...avail], avail)).toEqual([ep(9, 1)])
    })
    it("moves within bounds", () => {
        const list = [ep(1, 1), ep(1, 2), ep(1, 3)]
        expect(movePlaylistEpisode(list, 0, 1).map(e => e.episode?.episodeNumber)).toEqual([2, 1, 3])
        expect(movePlaylistEpisode(list, 0, -1)).toBe(list)
    })
    it("lets one save run at a time", async () => {
        const gate = createPlaylistMutationGate()
        let release!: () => void
        const first = gate(() => new Promise<void>(resolve => { release = resolve }))
        expect(await gate(async () => {})).toBe(false)
        release()
        expect(await first).toBe(true)
    })
})

describe("playlist library", () => {
    const data = {
        lists: [
            { type: "CURRENT", status: "CURRENT", entries: [{ mediaId: 1, media: { id: 1, title: { romaji: "Frieren" } } }] },
            { type: "PLANNING", status: "PLANNING", entries: [{ mediaId: 2, media: { id: 2, title: { english: "Dandadan" } } }, { mediaId: 1, media: { id: 1, title: {} } }] },
            { type: "COMPLETED", status: "COMPLETED", entries: [{ mediaId: 3, media: { id: 3, title: {} } }] },
        ],
        stream: { anime: [{ id: 1 }, { id: 4, title: { romaji: "Streamed" } }], listData: { 4: { progress: 2 } } },
    } as unknown as Anime_LibraryCollection
    it("adds streamed anime to Current once", () => {
        const merged = playlistLibraryCollection(data)!
        expect(merged.lists![0].entries!.map(e => e.mediaId)).toEqual([1, 4])
        expect(merged.lists![0].entries![1].listData?.progress).toBe(2)
        expect(playlistLibraryCollection(undefined)).toBeUndefined()
    })
    it("lists the chosen category, all with a search, each anime once", () => {
        const merged = playlistLibraryCollection(data)
        expect(playlistAnimeChoices(merged, "CURRENT", "").map(e => e.mediaId)).toEqual([1, 4])
        expect(playlistAnimeChoices(merged, "-", "").map(e => e.mediaId)).toEqual([1, 4, 2])
        expect(playlistAnimeChoices(merged, "CURRENT", "danda").map(e => e.mediaId)).toEqual([2])
    })
})

describe("previous/next while a playlist runs", () => {
    it("follows the playlist's neighbours and asks the server as finished (web VideoCorePlaylistControl)", () => {
        const calls: [string, boolean][] = []
        const nav = playlistNavigation(ep(97940, 14), null, (which, done) => calls.push([which, done]))
        expect(nav.hasNextEpisode).toBe(true)
        expect(nav.hasPreviousEpisode).toBe(false)
        nav.playEpisode("previous")
        nav.playEpisode("next")
        expect(calls).toEqual([["next", true]])
    })
})
