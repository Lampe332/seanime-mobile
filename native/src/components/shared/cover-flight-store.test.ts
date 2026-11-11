import { afterEach, describe, expect, it } from "vitest"
import {
    arriveAtPage, clearOrigin, coverFlightState, endFlight, isHiddenSource, landFlight, leaveOriginPage, missFlight, registerPageCover, startFlightIn,
    startFlightOut,
} from "./cover-flight-store"

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const card = { id: 7, token: "card-a", uri: "small.jpg", look: { opacity: 0.5 }, measure: async () => box(0, 0, 100, 50) }
const page = { id: 7, uri: "big.jpg", measure: async () => box(16, 80, 88, 124) }

afterEach(() => {
    endFlight()
    clearOrigin()
    registerPageCover(null)
})

describe("cover flight state", () => {
    it("in: starts at the card with its picture and look, lands with the header's picture", () => {
        startFlightIn(card, box(0, 0, 100, 50))
        const flight = coverFlightState().flight!
        expect(flight.direction).toBe("in")
        expect(flight.uri).toBe("small.jpg")
        expect(flight.fromLook).toEqual({ opacity: 0.5 })
        expect(flight.to).toBeNull()
        landFlight("in", 7, box(16, 80, 88, 124), "big.jpg")
        expect(coverFlightState().flight!.to).toEqual(box(16, 80, 88, 124))
        expect(coverFlightState().flight!.toUri).toBe("big.jpg")
        expect(coverFlightState().flight!.toLook).toEqual({})
    })
    it("lands once, only the right direction and title, never after a miss", () => {
        startFlightIn(card, box(0, 0, 100, 50))
        landFlight("out", 7, box(1, 1, 1, 1), "x.jpg")
        landFlight("in", 8, box(1, 1, 1, 1), "x.jpg")
        expect(coverFlightState().flight!.to).toBeNull()
        missFlight()
        landFlight("in", 7, box(1, 1, 1, 1), "x.jpg")
        expect(coverFlightState().flight!.to).toBeNull()
    })
    it("out: lands in the card with the card's picture and look", () => {
        startFlightIn(card, box(0, 0, 100, 50))
        endFlight()
        startFlightOut(page, box(16, 80, 88, 124))
        const origin = coverFlightState().origin!
        landFlight("out", 7, box(0, 0, 100, 50), origin.uri, origin.look)
        const flight = coverFlightState().flight!
        expect(flight.uri).toBe("big.jpg")
        expect(flight.toUri).toBe("small.jpg")
        expect(flight.toLook).toEqual({ opacity: 0.5 })
        endFlight()
        // after the way back the card is no longer an origin
        expect(coverFlightState().origin).toBeNull()
    })
    it("Back through anime opened on the page (relations) brings back the card the first page came from", () => {
        const home = { ...card, id: 1, token: "home" }
        startFlightIn(home, box(0, 0, 100, 50))
        endFlight()
        arriveAtPage(1)
        // a relation on the page opens anime 2, from there anime 3
        startFlightIn({ ...card, id: 2, token: "rel-2" }, box(0, 0, 100, 50))
        endFlight()
        arriveAtPage(2)
        startFlightIn({ ...card, id: 3, token: "rel-3" }, box(0, 0, 100, 50))
        endFlight()
        arriveAtPage(3)
        expect(coverFlightState().earlier.map(o => o.id)).toEqual([1, 2])
        // Back through the page's own steps: 3 → 2 → 1
        leaveOriginPage(true, 2)
        expect(coverFlightState().origin!.token).toBe("rel-2")
        leaveOriginPage(true, 1)
        expect(coverFlightState().origin!.token).toBe("home")
        expect(coverFlightState().origin!.arrived).toBe(true)
        expect(coverFlightState().earlier).toEqual([])
        // the last Back flies into the home card
        startFlightOut({ ...page, id: 1 }, box(16, 80, 88, 124))
        expect(isHiddenSource(coverFlightState(), "home", 1)).toBe(true)
        endFlight()
        expect(coverFlightState().origin).toBeNull()
    })
    it("an anime opened on the page without a flight keeps the card; another page ends the way back", () => {
        startFlightIn({ ...card, id: 1, token: "home" }, box(0, 0, 100, 50))
        endFlight()
        arriveAtPage(1)
        // relation 2 opened without a flight (its picture not loaded yet): still an entry page, the card stays
        leaveOriginPage(true, 2)
        expect(coverFlightState().origin!.token).toBe("home")
        // the bar to another tab
        leaveOriginPage(false, null)
        expect(coverFlightState().origin).toBeNull()
    })
    it("a flight back into a relation card (a manga opened from it) returns to the card the anime page came from", () => {
        startFlightIn({ ...card, id: 1, token: "home" }, box(0, 0, 100, 50))
        endFlight()
        arriveAtPage(1)
        startFlightIn({ ...card, id: 50, token: "manga-rel" }, box(0, 0, 100, 50))
        endFlight()
        arriveAtPage(50)
        startFlightOut({ ...page, id: 50 }, box(16, 80, 88, 124))
        endFlight()
        expect(coverFlightState().origin!.token).toBe("home")
        expect(coverFlightState().earlier).toEqual([])
    })
    it("a card tapped before its page was reached replaces the origin, nothing waits", () => {
        startFlightIn({ ...card, id: 1, token: "home" }, box(0, 0, 100, 50))
        startFlightIn({ ...card, id: 2, token: "other" }, box(0, 0, 100, 50))
        expect(coverFlightState().earlier).toEqual([])
    })
    it("hides only the card that still shows the tapped title (a recycled list cell is not hidden)", () => {
        startFlightIn(card, box(0, 0, 100, 50))
        expect(isHiddenSource(coverFlightState(), "card-a", 7)).toBe(false)
        endFlight()
        startFlightOut(page, box(16, 80, 88, 124))
        const s = coverFlightState()
        expect(isHiddenSource(s, "card-a", 7)).toBe(true)
        // the same cell now showing another title
        expect(isHiddenSource(s, "card-a", 9)).toBe(false)
        // another card of the same title
        expect(isHiddenSource(s, "card-b", 7)).toBe(false)
        missFlight()
        expect(isHiddenSource(coverFlightState(), "card-a", 7)).toBe(false)
    })
})
