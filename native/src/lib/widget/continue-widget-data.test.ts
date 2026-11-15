import type { Anime_Episode } from "@/api/generated/types"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { continueEntries, continueLayout, continueTexts, createContinueStore } from "./continue-widget-data"

const episode = (id: number | undefined, number: number, extra: Partial<Anime_Episode> = {}): Anime_Episode => ({
    episodeNumber: number,
    baseAnime: id === undefined ? undefined : {
        id,
        title: { userPreferred: `Anime ${id}` },
        coverImage: { large: `https://img.example/${id}.jpg` },
    },
    ...extra,
} as Anime_Episode)

describe("continue widget entries", () => {
    it("keeps Home's order, one row per anime", () => {
        const list = continueEntries([episode(3, 5), episode(1, 2), episode(3, 6), episode(2, 1)])
        expect(list.map(it => [it.mediaId, it.episode])).toEqual([[3, 5], [1, 2], [2, 1]])
        expect(list[0]).toEqual({ mediaId: 3, title: "Anime 3", episode: 5, coverUrl: "https://img.example/3.jpg" })
    })

    it("leaves out invalid episodes and those without an anime", () => {
        const list = continueEntries([episode(undefined, 1), episode(4, 1, { isInvalid: true }), episode(5, 0), episode(6, 3)])
        expect(list.map(it => it.mediaId)).toEqual([6])
    })

    it("stops at the limit and drops covers that are not on the web", () => {
        const many = [1, 2, 3, 4, 5, 6].map(id => episode(id, 1))
        expect(continueEntries(many)).toHaveLength(4)
        expect(continueEntries(many, 2)).toHaveLength(2)
        const local = episode(7, 1)
        local.baseAnime!.coverImage = { large: "file:///data/cover.jpg" }
        expect(continueEntries([local])[0].coverUrl).toBe("")
    })
})

describe("continue widget layout", () => {
    it("shows one row without the head when it is one cell high", () => {
        expect(continueLayout(90)).toEqual({ header: false, rows: 1 })
    })

    it("grows to at most four rows", () => {
        expect(continueLayout(180)).toEqual({ header: true, rows: 2 })
        expect(continueLayout(270)).toEqual({ header: true, rows: 3 })
        expect(continueLayout(800)).toEqual({ header: true, rows: 4 })
    })
})

describe("continue widget texts", () => {
    it("names the app Seanime Mobile in English and German", () => {
        expect(continueTexts(false).empty).toBe("Nothing to continue – open Seanime Mobile")
        expect(continueTexts(true).empty).toBe("Nichts zum Weiterschauen – Seanime Mobile öffnen")
        expect(continueTexts(false).episode(7)).toBe("Episode 7")
        expect(continueTexts(true).episode(7)).toBe("Folge 7")
    })
})

describe("continue widget store", () => {
    it("saves only changes and reads back what it saved", () => {
        const map = new Map<string, string>()
        const store = createContinueStore({ getString: key => map.get(key), set: (key, value) => void map.set(key, String(value)) })
        expect(store.entries()).toEqual([])
        const list = continueEntries([episode(1, 2)])
        expect(store.save(list)).toBe(true)
        expect(store.save(list)).toBe(false)
        expect(store.entries()).toEqual(list)
        map.set("widget.continue_data", "{broken")
        expect(store.entries()).toEqual([])
    })
})

describe("continue widget view", () => {
    it("opts out of the React Compiler", () => {
        const source = readFileSync(join(__dirname, "continue-widget.tsx"), "utf8")
        const code = source.replace(/^(\s*\/\/[^\n]*\n)*/, "")
        expect(code.startsWith("\"use no memo\"")).toBe(true)
    })
})
