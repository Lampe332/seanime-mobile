import { describe, expect, it } from "vitest"
import { aired, AiringNext, nextCheck, toSchedule } from "./airing-policy"

const now = 1_800_000_000
const next = (id: number, episode: number, inSeconds: number): AiringNext => ({ mediaId: id, title: `Anime ${id}`, episode, airingAt: now + inSeconds })

// AiringPolicyTest.kt, 1:1
describe("AiringPolicy", () => {
    it("announces episodes that aired since the last check", () => {
        const previous = [next(1, 5, -600), next(2, 3, 3600)]
        expect(aired(previous, {}, now).map(it => it.mediaId)).toEqual([1])
    })

    it("announces each episode once", () => {
        // AniList can still list a just-aired episode as the next one
        const previous = [next(1, 5, -600)]
        expect(aired(previous, { 1: 5 }, now)).toEqual([])
        expect(aired([next(1, 6, -60)], { 1: 5 }, now)).toHaveLength(1)
    })

    it("skips episodes that aired long ago", () => {
        expect(aired([next(1, 5, -3 * 86_400)], {}, now)).toEqual([])
    })

    it("checks again shortly after the next episode", () => {
        const upcoming = [next(1, 6, 7_200), next(2, 4, 1_800), next(3, 2, -60)]
        expect(nextCheck(upcoming, now)).toBe(now + 1_800 + 300)
    })

    it("checks at least every six hours", () => {
        expect(nextCheck([next(1, 6, 3 * 86_400)], now)).toBe(now + 6 * 3600)
        expect(nextCheck([], now)).toBe(now + 6 * 3600)
    })
})

describe("planned announcements", () => {
    it("plans upcoming episodes that were not announced", () => {
        expect(toSchedule([next(1, 6, 3600), next(2, 3, 60)], { 1: 5 }, now).map(it => it.mediaId)).toEqual([1, 2])
    })
    it("does not plan an episode AniList still lists after it aired and was announced", () => {
        expect(toSchedule([next(1, 5, -600)], {}, now)).toEqual([])
        expect(toSchedule([next(1, 5, 120)], { 1: 5 }, now)).toEqual([])
    })
    it("still plans an episode that aired a moment ago until its announcement time", () => {
        expect(toSchedule([next(1, 5, -60)], {}, now)).toHaveLength(1)
    })
})
