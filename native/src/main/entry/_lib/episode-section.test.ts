import { describe, expect, it, vi } from "vitest"

// The hook part pulls in the API layer; the lists are plain functions
vi.mock("@/main/entry/_lib/handle-play-media", () => ({ useHandlePlayMedia: () => ({ playMediaFile: () => undefined }) }))

const { getEpisodesToWatch, getMainEpisodes, getNcEpisodes, getSpecialEpisodes } = await import("./handle-episode-section")

const ep = (type: string, progressNumber: number, extra: object = {}) => ({ type, progressNumber, displayTitle: `E${progressNumber}`, ...extra }) as never

describe("episode section lists", () => {
    const episodes = [ep("main", 1), ep("main", 2), ep("main", 3), ep("special", 10, { displayTitle: "S10" }), ep("special", 2, { displayTitle: "S2" }),
        ep("nc", 0, { localFile: { path: "b/OP2.mkv" } }), ep("nc", 0, { localFile: { path: "b/OP10.mkv" } }), ep("nc", 0)]

    it("splits main, specials (number order) and existing NC files (path order)", () => {
        const entry = { episodes } as never
        expect(getMainEpisodes(entry).map((e: { progressNumber: number }) => e.progressNumber)).toEqual([1, 2, 3])
        expect(getSpecialEpisodes(entry).map((e: { displayTitle: string }) => e.displayTitle)).toEqual(["S2", "S10"])
        expect(getNcEpisodes(entry).map((e: { localFile?: { path: string } }) => e.localFile?.path)).toEqual(["b/OP2.mkv", "b/OP10.mkv"])
    })

    it("lists what comes after the progress, or everything last-first once watched through", () => {
        const main = getMainEpisodes({ episodes } as never)
        expect(getEpisodesToWatch({ nextEpisode: main[1], listData: { progress: 1 } } as never, main).map((e: { progressNumber: number }) => e.progressNumber)).toEqual([2, 3])
        expect(getEpisodesToWatch({ listData: { progress: 3 } } as never, main).map((e: { progressNumber: number }) => e.progressNumber)).toEqual([3, 2, 1])
        expect(getEpisodesToWatch({ listData: { progress: 0 } } as never, main).map((e: { progressNumber: number }) => e.progressNumber)).toEqual([1, 2, 3])
    })
})
