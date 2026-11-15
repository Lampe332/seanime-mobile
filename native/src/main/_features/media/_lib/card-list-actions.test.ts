import { describe, expect, it } from "vitest"
import { cardListActions, reachableProgress } from "./card-list-actions"

const anime = { episodes: 12, nextAiringEpisode: null }
const ids = (actions: ReturnType<typeof cardListActions>) => actions.map(action => action.id)

describe("card list actions (long press)", () => {
    it("offers nothing without an AniList user", () => {
        expect(cardListActions({ type: "anime", signedIn: false, listData: undefined, media: anime })).toEqual([])
        expect(cardListActions({ type: "anime", signedIn: false, listData: { status: "CURRENT", progress: 2 }, media: anime })).toEqual([])
    })

    it("offers Add to list for a title that is not on the list", () => {
        expect(ids(cardListActions({ type: "anime", signedIn: true, listData: undefined, media: anime }))).toEqual(["add-to-list"])
        expect(ids(cardListActions({ type: "manga", signedIn: true, listData: { status: null }, media: { chapters: 40 } }))).toEqual(["add-to-list"])
    })

    it("shows On your list and +1 with the next number and the total for a listed title", () => {
        expect(cardListActions({ type: "anime", signedIn: true, listData: { status: "CURRENT", progress: 3 }, media: anime }))
            .toEqual([{ id: "on-list" }, { id: "increment", progress: 4, total: 12 }])
        expect(cardListActions({ type: "manga", signedIn: true, listData: { status: "PLANNING" }, media: { chapters: null } }))
            .toEqual([{ id: "on-list" }, { id: "increment", progress: 1, total: 0 }])
    })

    it("has no +1 when completed, at the total or at the last aired episode", () => {
        expect(ids(cardListActions({ type: "anime", signedIn: true, listData: { status: "COMPLETED", progress: 12 }, media: anime }))).toEqual(["on-list"])
        expect(ids(cardListActions({ type: "anime", signedIn: true, listData: { status: "PAUSED", progress: 12 }, media: anime }))).toEqual(["on-list"])
        const airing = { episodes: 24, nextAiringEpisode: { episode: 6 } }
        expect(ids(cardListActions({ type: "anime", signedIn: true, listData: { status: "CURRENT", progress: 5 }, media: airing }))).toEqual(["on-list"])
        expect(cardListActions({ type: "anime", signedIn: true, listData: { status: "CURRENT", progress: 4 }, media: airing })[1])
            .toEqual({ id: "increment", progress: 5, total: 24 })
    })

    it("on My lists leaves out On your list and gives manga Continue reading", () => {
        expect(ids(cardListActions({ type: "manga", signedIn: true, listData: { status: "CURRENT", progress: 7 }, media: { chapters: 50 }, onListScreen: true })))
            .toEqual(["increment", "continue-reading"])
        expect(ids(cardListActions({ type: "anime", signedIn: true, listData: { status: "CURRENT", progress: 7 }, media: anime, onListScreen: true })))
            .toEqual(["increment"])
        expect(ids(cardListActions({ type: "manga", signedIn: true, listData: { status: "COMPLETED", progress: 50 }, media: { chapters: 50 }, onListScreen: true })))
            .toEqual([])
    })

    it("reaches anime up to the last aired episode, manga up to the known chapters", () => {
        expect(reachableProgress("anime", { episodes: 24, nextAiringEpisode: { episode: 9 } })).toBe(8)
        expect(reachableProgress("anime", { episodes: 12 })).toBe(12)
        expect(reachableProgress("anime", { episodes: null })).toBe(0)
        expect(reachableProgress("manga", { chapters: 120, nextAiringEpisode: { episode: 3 } })).toBe(120)
    })
})
