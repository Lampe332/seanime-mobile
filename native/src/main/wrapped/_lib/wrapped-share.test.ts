import { describe, expect, it } from "vitest"
import type { WrappedTitle, WrappedView } from "@/main/lists/_lib/wrapped"
import { base64ToBytes, buildShareCard, clip, fitFontSize, SHARE_LIMITS, SHARE_SIZES, shareLayout } from "./wrapped-share"

const en = (text: string) => text
const de = (_en: string, text: string) => text
const f = { number: (value: number) => value.toLocaleString("en-US"), score: (score: number) => String(score / 10) }

function title(id: number, name: string, score: number): WrappedTitle {
    return { id, title: name, score, episodes: 12 }
}

const RATED = [title(1, "Frieren", 100), title(2, "A very long title that is surely too long for one line", 95),
    title(3, "Mob Psycho 100", 90), title(4, "Fourth", 85)]

function view(over: Partial<WrappedView> = {}): WrappedView {
    return {
        year: 2026, years: [2026], empty: false,
        titles: 42, episodes: 512, minutes: 512 * 24, meanScore: 78,
        genres: [{ name: "Action", count: 20, share: 0.5 }, { name: "Drama", count: 12, share: 0.3 },
            { name: "Romance", count: 8, share: 0.2 }, { name: "Comedy", count: 4, share: 0.1 }],
        studios: [{ name: "Kyoto Animation", count: 3, share: 0.1 }],
        formats: [],
        topRated: RATED, shareable: RATED.slice(0, 3), undated: 0,
        months: Array(12).fill(0) as number[], busiestMonth: null, manga: null,
        ...over,
    }
}

describe("clip", () => {
    it("keeps short texts", () => {
        expect(clip("  Frieren ", 10)).toBe("Frieren")
    })
    it("cuts long texts to the limit with an ellipsis", () => {
        const out = clip("A very long title that goes on", 12)
        expect(Array.from(out)).toHaveLength(12)
        expect(out).toBe("A very long…")
    })
    it("counts wide characters double and never splits one", () => {
        expect(clip("ab😀cd", 5)).toBe("ab😀…")
        expect(clip("ab😀cd", 4)).toBe("ab…")
        expect(clip("葬送のフリーレン", 8)).toBe("葬送の…")
        expect(clip("葬送の", 6)).toBe("葬送の")
    })
})

describe("buildShareCard", () => {
    it("builds the full card in English", () => {
        const card = buildShareCard(view(), en, f)
        expect(card.heading).toBe("My 2026 in anime")
        expect(card.stats.map(stat => [stat.key, stat.value, stat.label])).toEqual([
            ["titles", "42", "Anime finished"], ["episodes", "512", "Episodes"], ["hours", "≈ 205", "Hours"],
        ])
        expect(card.topRated.map(item => item.rank)).toEqual([1, 2, 3])
        expect(card.topRated[0].score).toBe("10")
        expect(Array.from(card.topRated[1].title).length).toBe(SHARE_LIMITS.title)
        expect(card.topRated[1].title.endsWith("…")).toBe(true)
        expect(card.genres).toEqual(["Action", "Drama", "Romance"])
        expect(card.studio).toBe("Kyoto Animation")
        expect(card.footer).toContain("estimated")
    })
    it("names only the shareable titles, never a private entry or an adult title", () => {
        const hidden = [{ ...title(8, "Private one", 100), private: true }, { ...title(9, "Adult one", 99), adult: true }]
        const card = buildShareCard(view({ topRated: [...hidden, ...RATED], shareable: RATED.slice(0, 3) }), en, f)
        expect(card.topRated.map(item => item.title)).toEqual(["Frieren", RATED[1].title.slice(0, 29) + "…", "Mob Psycho 100"])
    })
    it("speaks German", () => {
        const card = buildShareCard(view({ titles: 1, episodes: 1, minutes: 60 }), de, f)
        expect(card.heading).toBe("Mein Anime-Jahr 2026")
        expect(card.stats.map(stat => stat.label)).toEqual(["Anime abgeschlossen", "Folge", "Stunde"])
    })
    it("drops the parts without data", () => {
        const card = buildShareCard(view({ titles: 1, episodes: 0, minutes: 0, genres: [], studios: [], topRated: [], shareable: [] }), en, f)
        expect(card.stats.map(stat => stat.key)).toEqual(["titles"])
        expect(card.topRated).toEqual([])
        expect(card.genres).toEqual([])
        expect(card.studio).toBeNull()
        expect(card.footer).not.toContain("estimated")
    })
})

describe("shareLayout", () => {
    it("stacks the parts in order inside the middle", () => {
        const layout = shareLayout(buildShareCard(view(), en, f))
        expect(layout.stats).toBeGreaterThanOrEqual(SHARE_SIZES.top)
        expect(layout.rated).toBeGreaterThan(layout.stats + 3 * SHARE_SIZES.statRow)
        expect(layout.lists).toBeGreaterThan(layout.rated ?? 0)
        expect((layout.lists ?? 0) + SHARE_SIZES.listHead + 3 * SHARE_SIZES.listRow).toBeLessThanOrEqual(SHARE_SIZES.bottom)
    })
    it("centres a lone part and leaves the missing ones out", () => {
        const layout = shareLayout(buildShareCard(view({ episodes: 0, minutes: 0, genres: [], studios: [], topRated: [], shareable: [] }), en, f))
        expect(layout.rated).toBeNull()
        expect(layout.lists).toBeNull()
        const middle = (SHARE_SIZES.top + SHARE_SIZES.bottom) / 2
        expect(Math.abs(layout.stats + SHARE_SIZES.statRow / 2 - middle)).toBeLessThanOrEqual(1)
    })
})

describe("fitFontSize", () => {
    it("keeps the largest size while the text fits and shrinks long texts", () => {
        expect(fitFontSize(16, 904, 76)).toBe(76)
        expect(fitFontSize(30, 904, 76)).toBeLessThan(76)
        expect(fitFontSize(0, 904, 76)).toBe(76)
    })
})

describe("base64ToBytes", () => {
    it("matches Buffer for every padding length and a data URI", () => {
        for (const text of ["", "a", "ab", "abc", "abcd", "Seanime ≈ 2026"]) {
            const bytes = new TextEncoder().encode(text)
            const b64 = Buffer.from(bytes).toString("base64")
            expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes))
            expect(Array.from(base64ToBytes(`data:image/png;base64,${b64}`))).toEqual(Array.from(bytes))
        }
    })
    it("decodes all byte values", () => {
        const bytes = Uint8Array.from({ length: 256 }, (_, index) => index)
        expect(Array.from(base64ToBytes(Buffer.from(bytes).toString("base64")))).toEqual(Array.from(bytes))
    })
    it("throws on text that is not Base64", () => {
        expect(() => base64ToBytes("ab$d")).toThrow()
        expect(() => base64ToBytes("abcde")).toThrow()
    })
})
