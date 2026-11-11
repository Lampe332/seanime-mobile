import { describe, expect, it } from "vitest"
import { initialPlayerLoadState, playerLoadEvents } from "./player-load-events"

describe("playerLoadEvents", () => {
    it("sends video-loaded with the source and metadata + can-play once mpv opened the file (web order)", () => {
        const s = initialPlayerLoadState()
        expect(playerLoadEvents(s, "a", "source")).toEqual(["loaded"])
        expect(playerLoadEvents(s, "a", "opened")).toEqual(["metadata", "canPlay"])
    })

    it("never sends an event twice for one playback", () => {
        const s = initialPlayerLoadState()
        playerLoadEvents(s, "a", "source")
        playerLoadEvents(s, "a", "opened")
        expect(playerLoadEvents(s, "a", "source")).toEqual([])
        expect(playerLoadEvents(s, "a", "opened")).toEqual([])
    })

    it("a file that opens without an announced source still sends video-loaded first", () => {
        expect(playerLoadEvents(initialPlayerLoadState(), "a", "opened")).toEqual(["loaded", "metadata", "canPlay"])
    })

    it("starts over for the next playback id", () => {
        const s = initialPlayerLoadState()
        playerLoadEvents(s, "a", "source")
        playerLoadEvents(s, "a", "opened")
        expect(playerLoadEvents(s, "b", "source")).toEqual(["loaded"])
        expect(playerLoadEvents(s, "b", "opened")).toEqual(["metadata", "canPlay"])
    })

    it("ignores a playback without id (online stream still getting its URL)", () => {
        expect(playerLoadEvents(initialPlayerLoadState(), undefined, "source")).toEqual([])
    })
})
