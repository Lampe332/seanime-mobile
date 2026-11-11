import { describe, expect, it } from "vitest"
import type { PlayerTrack } from "./player-logic"
import {
    applyTranslations,
    assPlainText,
    baseLanguage,
    detectSubtitleFormat,
    hashText,
    isInLanguage,
    parseSubtitleFile,
    parseSubtitleTime,
    translatedTrackTitle,
    TranslatedTracks,
    translationBatches,
    translationFileName,
    translationErrorText,
    translationOrder,
    translationSource,
    translationSourceKey,
} from "./subtitle-translation"

const en = (text: string) => text

const ASS = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize",
    "Style: Default,Arial,48",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,DE Untertitel 0 s",
    "Dialogue: 0,0:00:05.00,0:00:10.00,Default,Senku,0,0,0,,{\\an8}Zehn Milliarden,\\Nein Prozent",
    "Comment: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,not shown",
    "Dialogue: 0,0:00:07.00,0:00:08.00,Sign,,0,0,0,,{\\p1}m 0 0 l 100 0{\\p0}",
    "Dialogue: 0,0:00:09.00,0:00:10.00,Sign,,0,0,0,,{\\pos(10,10)}",
].join("\r\n")

const SRT = "1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hallo</i>\r\nWelt\r\n\r\n2\r\n00:01:00,000 --> 00:01:01,000\r\nZwei\r\n"

const VTT = "WEBVTT\n\nNOTE a note\n\n00:01.000 --> 00:02.000 align:start\nEins\n\n00:00:03.500 --> 00:00:04.000\nZwei\nZeilen\n"

describe("subtitle files", () => {
    it("detects the format", () => {
        expect(detectSubtitleFormat(ASS)).toBe("ass")
        expect(detectSubtitleFormat("﻿" + SRT)).toBe("srt")
        expect(detectSubtitleFormat(VTT)).toBe("vtt")
        expect(detectSubtitleFormat("just text")).toBeNull()
    })

    it("reads the times", () => {
        expect(parseSubtitleTime("1:02:03.45")).toBe(3_723_450)
        expect(parseSubtitleTime("00:01:01,005")).toBe(61_005)
        expect(parseSubtitleTime("01.000")).toBeNaN()
        expect(parseSubtitleTime("00:01.000")).toBe(1_000)
    })

    it("cleans ASS text like the server", () => {
        expect(assPlainText("{\\an8}Zehn Milliarden,\\Nein{\\i1} Prozent{\\i0}")).toBe("Zehn Milliarden, ein Prozent")
    })

    it("reads ASS dialogue lines, skips comments, drawings and tag-only lines", () => {
        const doc = parseSubtitleFile(ASS)!
        expect(doc.format).toBe("ass")
        expect(doc.cues.map(c => c.text)).toEqual(["DE Untertitel 0 s", "Zehn Milliarden, ein Prozent"])
        expect(doc.cues[1]).toMatchObject({ start: 5000, end: 10000, line: 10, prefix: "Dialogue: 0,0:00:05.00,0:00:10.00,Default,Senku,0,0,0,,{\\an8}" })
    })

    it("puts ASS translations in place and keeps everything else", () => {
        const doc = parseSubtitleFile(ASS)!
        const out = applyTranslations(doc, new Map([[1, "Ten billion, {one} percent\nreally"]]))
        const lines = out.split("\n")
        expect(lines[9]).toBe("Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,DE Untertitel 0 s")
        expect(lines[10]).toBe("Dialogue: 0,0:00:05.00,0:00:10.00,Default,Senku,0,0,0,,{\\an8}Ten billion, one percent really")
        expect(lines[11]).toBe("Comment: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,not shown")
        expect(lines.length).toBe(doc.lines.length)
    })

    it("follows the Format line of the events", () => {
        const doc = parseSubtitleFile("[Events]\nFormat: Start, End, Text\nDialogue: 0:00:01.00,0:00:02.00,Hallo, Welt")!
        expect(doc.cues).toEqual([{ start: 1000, end: 2000, text: "Hallo, Welt", line: 2, count: 1, prefix: "Dialogue: 0:00:01.00,0:00:02.00," }])
    })

    it("reads SRT and writes one translated line per cue", () => {
        const doc = parseSubtitleFile(SRT)!
        expect(doc.cues.map(c => [c.text, c.start, c.end, c.line, c.count])).toEqual([["Hallo Welt", 1000, 2500, 2, 2], ["Zwei", 60000, 61000, 7, 1]])
        expect(applyTranslations(doc, new Map([[0, "Hello world"]]))).toBe("1\n00:00:01,000 --> 00:00:02,500\nHello world\n\n2\n00:01:00,000 --> 00:01:01,000\nZwei\n")
    })

    it("reads WebVTT cues with settings and without hours", () => {
        const doc = parseSubtitleFile(VTT)!
        expect(doc.format).toBe("vtt")
        expect(doc.cues.map(c => [c.text, c.start])).toEqual([["Eins", 1000], ["Zwei Zeilen", 3500]])
        expect(applyTranslations(doc, new Map([[1, "Two lines"]]))).toBe("WEBVTT\n\nNOTE a note\n\n00:01.000 --> 00:02.000 align:start\nEins\n\n00:00:03.500 --> 00:00:04.000\nTwo lines\n")
    })

    it("ignores empty translations", () => {
        const doc = parseSubtitleFile(SRT)!
        expect(applyTranslations(doc, new Map([[0, "  "]]))).toBe(doc.lines.join("\n"))
    })
})

describe("translation order", () => {
    const cue = (start: number, end: number) => ({ start, end, text: "x", line: 0, count: 1, prefix: "" })

    it("starts at the playing line, then the earlier ones", () => {
        const cues = [cue(30_000, 32_000), cue(0, 2_000), cue(10_000, 12_000), cue(11_000, 20_000)]
        expect(translationOrder(cues, 11_500)).toEqual([2, 3, 0, 1])
        expect(translationOrder(cues, 0)).toEqual([1, 2, 3, 0])
    })

    it("splits into a small first batch and bigger ones after it", () => {
        expect(translationBatches([1, 2, 3, 4, 5, 6], 1, 2)).toEqual([[1], [2, 3], [4, 5], [6]])
        expect(translationBatches([], 2)).toEqual([])
        const sizes = translationBatches(Array.from({ length: 130 }, (_, i) => i)).map(b => b.length)
        expect(sizes).toEqual([25, 50, 50, 5])
    })
})

describe("memory of a playback", () => {
    const source = { kind: "embedded", trackNumber: 4 } as const

    it("keys by source, provider and language", () => {
        expect(TranslatedTracks.key(source, "google", "en-US")).toBe("embedded:4|google|en-US")
        expect(TranslatedTracks.key(source, "google", "de")).not.toBe(TranslatedTracks.key(source, "google", "en-US"))
    })

    it("remembers translations and their origin, and moves on when a batch replaces the track", () => {
        const memory = new TranslatedTracks()
        const key = TranslatedTracks.key(source, "google", "en-US")
        memory.remember(key, 5, 2)
        expect(memory.shown(key)).toBe(5)
        expect(memory.isTranslation(5)).toBe(true)
        expect(memory.originOf(5)).toBe(2)
        expect([...memory.ids()]).toEqual([5])

        // the next batch's file is track 6, track 5 is gone
        memory.remember(key, 6, 2)
        memory.forget(5)
        expect(memory.shown(key)).toBe(6)
        expect([...memory.ids()]).toEqual([6])

        memory.forget(6)
        expect(memory.shown(key)).toBeUndefined()
        expect(memory.ids().size).toBe(0)
    })

    it("an original in the target language is shown, but is no translation", () => {
        const memory = new TranslatedTracks()
        memory.remember("url:x|google|en", 3)
        expect(memory.shown("url:x|google|en")).toBe(3)
        expect(memory.isTranslation(3)).toBe(false)
    })

    it("remembers failures until the key works", () => {
        const memory = new TranslatedTracks()
        memory.fail("k")
        expect(memory.failed("k")).toBe(true)
        memory.remember("k", 4, 1)
        expect(memory.failed("k")).toBe(false)
    })

    it("names cache files and tracks", () => {
        expect(translationFileName("a", "google", "en")).toBe(translationFileName("a", "google", "en"))
        expect(translationFileName("a", "google", "en")).not.toBe(translationFileName("a", "deepl", "en"))
        expect(translationFileName("a", "google", "en")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/)
        expect(translatedTrackTitle({ id: 2, title: "Deutsch", lang: "ger" })).toBe("Deutsch (translated)")
        expect(translatedTrackTitle({ id: 2, title: "", lang: "ger" })).toBe("GER (translated)")
        expect(translatedTrackTitle({ id: 2, title: "", lang: "" })).toBe("Track 2 (translated)")
    })
})

describe("languages", () => {
    it("compares base languages", () => {
        expect(baseLanguage("en-US")).toBe("en")
        expect(baseLanguage("zh-hans")).toBe("zh")
        expect(baseLanguage("ger")).toBe("de")
        expect(isInLanguage({ lang: "eng", title: "" }, "en-GB")).toBe(true)
        expect(isInLanguage({ lang: "", title: "Deutsch" }, "de")).toBe(true)
        expect(isInLanguage({ lang: "ger", title: "Deutsch" }, "en-US")).toBe(false)
        expect(isInLanguage({ lang: "", title: "" }, "en")).toBe(false)
    })
})

describe("source of a track", () => {
    const track = (id: number, external = false, title = ""): PlayerTrack => ({ id, type: "sub", lang: "", title, external })
    const base = { mkvSubs: null, embeddedContents: [], externalFiles: [], translatedIds: new Set<number>() }

    it("embedded MKV tracks come from the server by their MKV number", () => {
        const tracks = [track(1), track(2), track(3, true, "Deutsch (translated)")]
        const ctx = { ...base, mkvSubs: [{ number: 5 }, { number: 4 }], translatedIds: new Set([3]) }
        expect(translationSource(tracks[1], tracks, ctx)).toEqual({ kind: "embedded", trackNumber: 5 })
        expect(translationSource(tracks[2], tracks, ctx)).toBeNull()
    })

    it("MP4 text tracks use the server's content in order", () => {
        const tracks = [track(1), track(2)]
        const ctx = { ...base, embeddedContents: ["first", "second"] }
        expect(translationSource(tracks[1], tracks, ctx)).toEqual({ kind: "content", content: "second" })
        expect(translationSource(track(3), [...tracks, track(3)], ctx)).toBeNull()
    })

    it("added files match by title, else by order", () => {
        const tracks = [track(1), track(2, true, "English"), track(3, true, "")]
        const ctx = { ...base, mkvSubs: [{ number: 3 }], externalFiles: [{ label: "English", url: "http://a/en.vtt" }, { label: "Other", url: "http://a/x.srt" }] }
        expect(translationSource(tracks[1], tracks, ctx)).toEqual({ kind: "url", url: "http://a/en.vtt" })
        expect(translationSource(tracks[2], tracks, ctx)).toEqual({ kind: "url", url: "http://a/x.srt" })
    })

    it("keys leave tokens out", () => {
        expect(translationSourceKey({ kind: "embedded", trackNumber: 4 })).toBe("embedded:4")
        expect(translationSourceKey({ kind: "url", url: "http://h/s.vtt?token=abc&x=1" })).toBe("url:http://h/s.vtt?&x=1")
        expect(translationSourceKey({ kind: "content", content: "abc" })).toBe(`content:${hashText("abc")}`)
        expect(hashText("abc")).toMatch(/^[0-9a-f]{8}$/)
        expect(hashText("abc")).not.toBe(hashText("abd"))
    })
})

describe("messages", () => {
    it("names the reason", () => {
        expect(translationErrorText("translation-unreachable", en)).toContain("could not be reached")
        expect(translationErrorText("translation-rate-limited", en)).toContain("busy")
        expect(translationErrorText("unsupported-format", en)).toContain("images")
        expect(translationErrorText("something else", en)).toBe("The subtitle track could not be read.")
        expect(translationErrorText("translation-unreachable", (_en, de) => de)).toContain("Internetverbindung")
    })
})
