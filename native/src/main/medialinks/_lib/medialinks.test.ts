import type { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { downloadedEpisodeGroups, encodeFilePath, episodeFacts, isWatched } from "./medialinks"

const t = (en: string) => en
const ep = (type: string, n: number, path?: string, extra: Partial<Anime_Episode> = {}) => ({
    type, progressNumber: n, displayTitle: `E${n}`, episodeTitle: "", localFile: path ? { path } : undefined, ...extra,
}) as unknown as Anime_Episode

describe("medialinks", () => {
    it("groups only downloaded episodes, main first", () => {
        const entry = { episodes: [ep("special", 1, "/s1"), ep("main", 1, "/e1"), ep("main", 2), ep("nc", 0, "/op")] } as unknown as Anime_Entry
        const groups = downloadedEpisodeGroups(entry, t)
        expect(groups.map(g => [g.key, g.episodes.length])).toEqual([["main", 1], ["special", 1], ["nc", 1]])
        expect(downloadedEpisodeGroups(undefined, t)).toEqual([])
    })
    it("marks main episodes up to the progress as watched", () => {
        expect(isWatched(ep("main", 3), 3)).toBe(true)
        expect(isWatched(ep("main", 4), 3)).toBe(false)
        expect(isWatched(ep("special", 1), 5)).toBe(false)
        expect(isWatched(ep("main", 0), 5)).toBe(false)
    })
    it("lists length, filler and missing metadata", () => {
        expect(episodeFacts(ep("main", 1, "/x", { episodeMetadata: { length: 24, isFiller: true } as never, isInvalid: true }), t)).toBe("24 min · Filler · No metadata")
    })
    it("encodes the path as the player link wants", () => {
        expect(encodeFilePath("/a b/ä.mkv", false)).toBe("%2Fa%20b%2F%C3%A4.mkv")
        expect(encodeFilePath("/ä", true)).toBe("L8Ok")
    })
})
