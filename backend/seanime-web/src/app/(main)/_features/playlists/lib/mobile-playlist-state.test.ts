import { describe, expect, it } from "vitest"
import type { Anime_PlaylistEpisode } from "@/api/generated/types"
import { createPlaylistMutationGate, MAX_PLAYLIST_EPISODES, movePlaylistEpisode, selectPlaylistEpisodes, togglePlaylistEpisode } from "./mobile-playlist-state"

const episode = (anime: number, number: number) => ({ episode: { baseAnime: { id: anime }, aniDBEpisode: String(number), episodeNumber: number }, watchType: "torrent", isCompleted: false, isNakama: false }) as Anime_PlaylistEpisode

describe("mobile playlist draft", () => {
    it("preserves existing content and order through multi-anime selection, bulk toggles, reordering and removal", () => {
        const original = [episode(10, 1)]
        let draft = [...original]
        draft = togglePlaylistEpisode(draft, episode(10, 2))
        draft = selectPlaylistEpisodes(draft, [episode(20, 1), episode(20, 2)])
        expect(draft.map(n => n.episode?.baseAnime?.id)).toEqual([10, 10, 20, 20])
        draft = selectPlaylistEpisodes(draft, [episode(20, 1), episode(20, 2)])
        expect(draft).toEqual([original[0], episode(10, 2)])
        draft = movePlaylistEpisode(draft, 1, -1)
        expect(draft).toEqual([episode(10, 2), original[0]])
        draft = togglePlaylistEpisode(draft, episode(10, 2))
        expect(draft).toEqual(original)
        expect(original).toEqual([episode(10, 1)])
    })

    it("deduplicates bulk results and enforces the existing 200 episode cap without replacing old entries", () => {
        const existing = Array.from({ length: MAX_PLAYLIST_EPISODES - 1 }, (_, i) => episode(10, i))
        const full = selectPlaylistEpisodes(existing, [episode(10, 0), episode(20, 1), episode(20, 1), episode(20, 2)])
        expect(full).toHaveLength(200)
        expect(full.slice(0, -1)).toEqual(existing)
        expect(full.at(-1)).toEqual(episode(20, 1))
        expect(togglePlaylistEpisode(full, episode(20, 2))).toBe(full)
        expect(togglePlaylistEpisode(full, episode(10, 0))).toHaveLength(199)
    })

    it("does not reorder at either boundary", () => {
        const items = [episode(1, 1), episode(1, 2)]
        expect(movePlaylistEpisode(items, 0, -1)).toBe(items)
        expect(movePlaylistEpisode(items, 1, 1)).toBe(items)
    })

    it("blocks same-frame duplicate saves through completion and permits retry after failure", async () => {
        const gate = createPlaylistMutationGate()
        let finish!: () => void
        let calls = 0
        const first = gate(async () => { calls++; await new Promise<void>(resolve => { finish = resolve }) })
        expect(await gate(async () => { calls++ })).toBe(false)
        expect(calls).toBe(1)
        finish()
        expect(await first).toBe(true)
        await expect(gate(async () => { throw new Error("offline") })).rejects.toThrow("offline")
        expect(await gate(async () => { calls++ })).toBe(true)
        expect(calls).toBe(2)
    })
})
