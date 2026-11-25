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
    entryButton,
    addingDone,
    stepInputText,
    stepShownText,
    submitListEntry,
} from "./list-entry-form"

/*
 * Correction 5a-K (docs/EIGENER-KERN.md §4p): on the tablet the add button stayed away for the rest of the app's run.
 * The page had added the anime once (the mutation's success hides the button until the entry comes), the entry was
 * removed elsewhere later, and the page still counted the old success.
 */
describe("entryButton: add or edit next to the progress", () => {
    const user = { viewer: { name: "someone" }, isSimulated: false }
    const entry = { status: "PLANNING", progress: 0 }

    it("shows nothing without a user, add without an entry, edit with one", () => {
        expect(entryButton(undefined, undefined, false)).toBe("none")
        expect(entryButton(user, undefined, false)).toBe("add")
        expect(entryButton(user, entry, false)).toBe("edit")
    })

    it("hides the add button after adding until the entry arrives", () => {
        expect(entryButton(user, undefined, true)).toBe("none")
        expect(addingDone(true, undefined)).toBe(false)
    })

    it("shows the add button again when the added entry is removed elsewhere later", () => {
        // added on this page, the entry arrived: the add is done and forgotten
        let added = true
        if (addingDone(added, entry)) added = false
        expect(entryButton(user, entry, added)).toBe("edit")
        // removed elsewhere (AniList's site, another device), the same page still open
        expect(entryButton(user, undefined, added)).toBe("add")
    })

    it("never forgets an add that did not succeed", () => {
        expect(addingDone(false, entry)).toBe(false)
    })
})

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
            mediaId: 30276, status: "PLANNING", score: 75, progress: 0, startedAt: { day: 5, month: 10, year: 2026 }, completedAt: {}, type: "anime",
        })
        // both dates emptied in the sheet: sent as empty dates, which the JSON body keeps (undefined would drop the key)
        const cleared = listEntryPayload({ ...form, startedAt: null, completedAt: null }, 30276, "anime")
        expect(JSON.parse(JSON.stringify(cleared))).toMatchObject({ startedAt: {}, completedAt: {} })
        expect(changedRepeat(1, 1)).toBeNull()
        expect(changedRepeat(null, 2)).toBe(0)
        expect(changedRepeat(2, undefined)).toBe(2)
    })

    it("encodes file paths like Buffer did", () => {
        expect(utf8ToBase64("D:/Anime/Folge 1 – ü.mkv")).toBe("RDovQW5pbWUvRm9sZ2UgMSDigJMgw7wubWt2")
    })
})

/* Device test 25.11.2026 (guest): "150" stood in the score field and 10 was saved; Save left the sheet open. */
describe("edit sheet: typed numbers and save", () => {
    const score = { max: 10, decimals: true }
    const progress = { max: 12 }

    it("never shows a typed number above the highest", () => {
        expect(stepInputText("150", "15", score)).toEqual({ text: "10", value: 10 })
        expect(stepInputText("10,5", "10,", score)).toEqual({ text: "10", value: 10 })
        expect(stepInputText("13", "1", progress)).toEqual({ text: "12", value: 12 })
        // no known episode count: no upper limit
        expect(stepInputText("250", "25", {})).toEqual({ text: "250", value: 250 })
    })

    it("takes only digits, one separator and one decimal for scores", () => {
        expect(stepInputText("7,5", "7,", score)).toEqual({ text: "7,5", value: 7.5 })
        expect(stepInputText("7.", "7", score)).toEqual({ text: "7.", value: 7 })
        expect(stepInputText("7,55", "7,5", score)).toEqual({ text: "7,5", value: undefined })
        expect(stepInputText("7a", "7", score)).toEqual({ text: "7", value: undefined })
        expect(stepInputText(",", "", score)).toEqual({ text: "", value: undefined })
        expect(stepInputText("-1", "", progress)).toEqual({ text: "", value: undefined })
        expect(stepInputText("3.5", "3", progress)).toEqual({ text: "3", value: undefined })
        expect(stepInputText("05", "0", progress)).toEqual({ text: "5", value: 5 })
        expect(stepInputText("", "4", progress)).toEqual({ text: "", value: null })
    })

    it("shows the value when the typed text no longer stands for it", () => {
        expect(stepShownText("7,", 7, score)).toBe("7,")
        expect(stepShownText("5", 12, progress)).toBe("12") // "Completed" filled the progress meanwhile
        expect(stepShownText(null, null, progress)).toBe("")
    })

    it("sends whole scores", () => {
        const form = { status: "CURRENT" as const, score: 0.7, progress: 3, startedAt: null, completedAt: null }
        expect(listEntryPayload(form, 1, "anime").score).toBe(7)
    })

    it("closes the sheet only once the entry is saved", () => {
        const form = { status: "CURRENT" as const, score: 8, progress: 3, startedAt: null, completedAt: null }
        const run = (outcome: "saved" | "failed", repeat: number | null) => {
            const calls: string[] = []
            submitListEntry(form, repeat, 1, 5114, "anime", {
                saveEntry: (body, options) => {
                    calls.push(`entry ${body.score} ${body.progress}`)
                    if (outcome === "saved") options.onSuccess()
                },
                saveRepeat: body => calls.push(`repeat ${body.repeat}`),
                close: () => calls.push("close"),
            })
            return calls
        }
        expect(run("saved", 1)).toEqual(["entry 80 3", "close"])
        expect(run("failed", 1)).toEqual(["entry 80 3"])
        expect(run("saved", 2)).toEqual(["repeat 2", "entry 80 3", "close"])
    })
})
