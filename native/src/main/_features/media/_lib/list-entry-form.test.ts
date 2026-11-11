import { describe, expect, it } from "vitest"
import { utf8ToBase64 } from "@/lib/helpers/base64"
import {
    changedRepeat,
    chooseListStatus,
    clampStep,
    formatFieldDate,
    listEntryDefaults,
    listEntryPayload,
    listStatusOptions,
    parseStepInput,
    progressMaxFor,
} from "./list-entry-form"

const en = (english: string) => english

describe("list entry editor", () => {
    it("starts from the list data, score on a 10 scale", () => {
        const form = listEntryDefaults({ status: "REPEATING", score: 85, progress: 7, startedAt: "2026-10-05", completedAt: undefined })
        expect(form.status).toBe("REPEATING")
        expect(form.score).toBe(8.5)
        expect(form.progress).toBe(7)
        expect(formatFieldDate(form.startedAt)).toBe("2026-10-05")
        expect(form.completedAt).toBeNull()
        expect(listEntryDefaults({ score: 0 }).score).toBeNull()
    })

    it("limits progress to the aired episodes of a running anime", () => {
        expect(progressMaxFor({ episodes: 12, nextAiringEpisode: { episode: 8 } } as never, "anime")).toBe(7)
        expect(progressMaxFor({ episodes: 12 } as never, "anime")).toBe(12)
        expect(progressMaxFor({ episodes: 0 } as never, "anime")).toBeUndefined()
        expect(progressMaxFor({ chapters: 140 } as never, "manga")).toBe(140)
    })

    it("offers only Planning before release and fills the progress when an anime is completed", () => {
        expect(listStatusOptions(en, "anime", false).map(o => o.value)).toEqual(["PLANNING"])
        expect(listStatusOptions(en, "manga", true).map(o => o.label)).toContain("Reading")
        const form = listEntryDefaults({ status: "CURRENT", progress: 3 })
        expect(chooseListStatus(form, "COMPLETED", { episodes: 12 } as never, "anime").progress).toBe(12)
        expect(chooseListStatus(form, "COMPLETED", { chapters: 12 } as never, "manga").progress).toBe(3)
    })

    it("keeps stepper values in their limits", () => {
        expect(clampStep(7.26, { max: 10, decimals: true })).toBe(7.3)
        expect(clampStep(13, { max: 12 })).toBe(12)
        expect(clampStep(-1, {})).toBe(0)
        expect(parseStepInput("7,5", { max: 10, decimals: true })).toBe(7.5)
        expect(parseStepInput("", { max: 10 })).toBeNull()
        expect(parseStepInput("x", { max: 10 })).toBeUndefined()
    })

    it("builds the mutation body like the web form", () => {
        const form = { status: undefined, score: 7.5, progress: null, startedAt: new Date(2026, 9, 5), completedAt: null }
        expect(listEntryPayload(form, 30276, "anime")).toEqual({
            mediaId: 30276, status: "PLANNING", score: 75, progress: 0, startedAt: { day: 5, month: 10, year: 2026 }, completedAt: undefined, type: "anime",
        })
        expect(changedRepeat(1, 1)).toBeNull()
        expect(changedRepeat(null, 2)).toBe(0)
        expect(changedRepeat(2, undefined)).toBe(2)
    })

    it("encodes file paths like Buffer did", () => {
        expect(utf8ToBase64("D:/Anime/Folge 1 – ü.mkv")).toBe("RDovQW5pbWUvRm9sZ2UgMSDigJMgw7wubWt2")
    })
})
