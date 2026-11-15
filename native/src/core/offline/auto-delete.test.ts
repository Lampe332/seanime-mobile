// geschrieben nach: auto-delete.ts (Regel „Delete watched episodes“); erfundene Werte

import { describe, expect, it } from "vitest"
import { type SavedEpisode, deleteWatchedModeOf, watchedToDelete } from "./auto-delete"

const episode = (number: number, more: Partial<SavedEpisode> = {}): SavedEpisode => ({ id: `5-${number}`, mediaId: 5, episode: String(number), ready: true, ...more })

describe("Delete watched episodes", () => {
    it("reads only the known modes; anything else is off", () => {
        expect(["", "watched", "keep-one", "always", undefined, 1].map(deleteWatchedModeOf)).toEqual(["", "watched", "keep-one", "", "", ""])
    })

    it("off deletes nothing", () => {
        expect(watchedToDelete([episode(1, { watchedAt: 1 })], episode(1, { watchedAt: 1 }), "")).toEqual([])
    })

    it("\"watched\" deletes the watched episode only, and only when it is saved", () => {
        const items = [episode(1, { watchedAt: 1 }), episode(2), episode(3, { ready: false })]
        expect(watchedToDelete(items, items[1], "watched")).toEqual(["5-2"])
        expect(watchedToDelete(items, items[2], "watched")).toEqual([])
    })

    it("\"keep-one\" keeps the watched one and deletes the watched ones before it, not unwatched or other anime", () => {
        const items = [episode(1, { watchedAt: 1 }), episode(2), episode(3, { watchedAt: 2 }), episode(4, { watchedAt: 3 }), { ...episode(1, { watchedAt: 1 }), id: "6-1", mediaId: 6 }]
        expect(watchedToDelete(items, items[3], "keep-one")).toEqual(["5-1", "5-3"])
        expect(watchedToDelete(items, items[0], "keep-one")).toEqual([])
    })
})
