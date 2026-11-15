import { describe, expect, it } from "vitest"
import {
    NO_TAPS,
    PETAL_COLORS,
    petalCount,
    SAKURA_MS,
    sakuraPetals,
    secretMessage,
    tapHint,
    type TapResult,
    TAP_RESET_MS,
    versionTap,
} from "./version-taps"

const en = (a: string) => a
const de = (_: string, b: string) => b

/** `count` taps 300ms apart, from a fresh start */
function tapTimes(count: number, start = 1_000): TapResult[] {
    const results: TapResult[] = []
    let state = NO_TAPS
    for (let i = 0; i < count; i++) {
        const result = versionTap(state, start + i * 300)
        results.push(result)
        state = result.state
    }
    return results
}

describe("version taps", () => {
    it("stays quiet for six taps, then counts down 3, 2, 1, and the tenth is the secret", () => {
        const results = tapTimes(10)
        expect(results.slice(0, 6).map(r => r.remaining)).toEqual([null, null, null, null, null, null])
        expect(results.slice(6, 9).map(r => r.remaining)).toEqual([3, 2, 1])
        expect(results.slice(0, 9).every(r => !r.secret)).toBe(true)
        expect(results[9]).toEqual({ state: NO_TAPS, remaining: null, secret: true })
    })

    it("starts over after a pause longer than two seconds", () => {
        const eight = tapTimes(8)
        const last = eight[7]!.state
        expect(last.count).toBe(8)
        expect(versionTap(last, last.lastAt + TAP_RESET_MS).state.count).toBe(9)
        const late = versionTap(last, last.lastAt + TAP_RESET_MS + 1)
        expect(late.state.count).toBe(1)
        expect(late.remaining).toBeNull()
    })

    it("works again after the secret", () => {
        const first = tapTimes(10)
        let state = first[9]!.state
        let secret = false
        for (let i = 0; i < 10; i++) {
            const result = versionTap(state, 10_000 + i * 300)
            state = result.state
            secret = result.secret
        }
        expect(secret).toBe(true)
    })

    it("says how many taps are left, in both languages", () => {
        expect(tapHint(3, en)).toBe("3 more taps…")
        expect(tapHint(2, en)).toBe("2 more taps…")
        expect(tapHint(1, en)).toBe("1 more tap…")
        expect(tapHint(3, de)).toBe("Noch 3 Tipps…")
        expect(tapHint(1, de)).toBe("Noch 1 Tipp…")
        expect(secretMessage(en)).toBe("You found the secret – enjoy your next episode 🌸")
        expect(secretMessage(de)).toBe("Geheimnis gefunden – viel Spaß bei der nächsten Folge 🌸")
    })
})

describe("sakura petals", () => {
    it("lets 25 fall on a phone and at most 40 on a wide tablet", () => {
        expect(petalCount(412)).toBe(25)
        expect(petalCount(1000)).toBe(31)
        expect(petalCount(2560)).toBe(40)
    })

    it("keeps every petal inside the page, its size range and the fall time", () => {
        let seed = 7
        const random = () => {
            seed = (seed * 16807) % 2147483647
            return (seed - 1) / 2147483646
        }
        for (const width of [412, 1280]) {
            const petals = sakuraPetals(width, random)
            expect(petals).toHaveLength(petalCount(width))
            for (const p of petals) {
                expect(p.x).toBeGreaterThanOrEqual(-12)
                expect(p.x).toBeLessThanOrEqual(width)
                expect(p.size).toBeGreaterThanOrEqual(9)
                expect(p.size).toBeLessThanOrEqual(19)
                expect(p.duration).toBeGreaterThanOrEqual(2600)
                expect(p.delay + p.duration).toBeLessThanOrEqual(SAKURA_MS)
                expect(Math.abs(p.spin)).toBeGreaterThanOrEqual(160)
                expect(PETAL_COLORS).toContain(p.color)
            }
            // different sizes and speeds, not one petal copied
            expect(new Set(petals.map(p => p.size)).size).toBeGreaterThan(3)
            expect(new Set(petals.map(p => p.duration)).size).toBeGreaterThan(3)
        }
    })

    it("uses the edges of the random range safely", () => {
        expect(sakuraPetals(412, () => 0).every(p => p.x === -12 && p.duration === 2600 && p.color === PETAL_COLORS[0])).toBe(true)
        const top = sakuraPetals(412, () => 0.999999)
        expect(top.every(p => p.delay + p.duration <= SAKURA_MS && p.color === PETAL_COLORS[3])).toBe(true)
    })
})
