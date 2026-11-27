import { describe, expect, it } from "vitest"
import { detachedOnline, shownEpisodeList, type OnlinePlayback, type OnlinePlayerEvents } from "./onlinestream-player.atoms"

describe("detachedOnline (the stream of a hidden or left page plays on without that page)", () => {
    const events = { current: {} as OnlinePlayerEvents }
    const playing = { hasNext: true, hasPrevious: true, events, reload: 2 } as OnlinePlayback

    it("takes previous/next and the page's events away from that page's stream", () => {
        const detached = detachedOnline(playing, events)!
        expect(detached.hasNext).toBe(false)
        expect(detached.hasPrevious).toBe(false)
        expect(detached.events).not.toBe(events)
        expect(detached.events.current).toBeNull()
        expect(detached.reload).toBe(2)
    })

    it("leaves another page's stream and no stream alone", () => {
        expect(detachedOnline(playing, { current: null })).toBe(playing)
        expect(detachedOnline(null, events)).toBeNull()
    })
})

describe("shownEpisodeList (the list stays while it is fetched again)", () => {
    it("prefers the fetched list and keeps the last one only for the same anime, provider and audio", () => {
        const kept = { key: "21|a|false", response: ["old"] }
        expect(shownEpisodeList(["new"], kept, "21|a|false")).toEqual(["new"])
        expect(shownEpisodeList(undefined, kept, "21|a|false")).toBe(kept.response)
        expect(shownEpisodeList(undefined, kept, "21|b|false")).toBeUndefined()
        expect(shownEpisodeList(undefined, null, "21|a|false")).toBeUndefined()
    })
})
