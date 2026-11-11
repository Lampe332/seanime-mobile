import { detectTrackLanguage } from "@/lib/helpers/language"
import type { Translate } from "@/lib/app-language"
import { mpvIdToMkvNumber, type PlayerTrack } from "./player-logic"

/*
 * "Translate subtitles" (2.0.x video-core-subtitles.ts / video-core-media-captions.ts + videocore/translator.go). The old
 * web player sent each MKV line ("translate-text") or a whole subtitle file ("translate-subtitle-file-track") to the
 * server and showed the answer in its own renderer. mpv draws the subtitles here and cannot hand out their text, so the
 * player translates a whole track as a file: it gets the track's file (embedded MKV tracks from the server, the server's
 * MP4 text tracks from the playback info, subtitle files from their URL), sends its lines to the server in small batches
 * (the server translates with the saved provider and keeps its line cache) and loads the translated file as an extra mpv
 * track, rewritten and reloaded after every batch so the lines around the playing position come first.
 */

export type SubtitleFormat = "ass" | "srt" | "vtt"

/** One line to translate. `line` is where its text sits in the file, `count` how many file lines it spans (SRT/VTT). */
export type SubtitleCue = {
    start: number
    end: number
    text: string
    line: number
    count: number
    /** ASS: the Dialogue fields before the text plus the text's leading override tags ({\an8} keeps its place) */
    prefix: string
}

export type SubtitleDocument = { format: SubtitleFormat, lines: string[], cues: SubtitleCue[] }

/** Lines per request: the first batch shows quickly, a whole episode still needs only a dozen requests. */
export const TRANSLATE_BATCH_SIZE = 25

/* ── Parsing ───────────────────────────────────────────────────────────── */

export function detectSubtitleFormat(content: string): SubtitleFormat | null {
    const head = content.replace(/^﻿/, "").trimStart()
    if (head.startsWith("[Script Info]") || /^\s*Dialogue:/m.test(content)) return "ass"
    if (head.startsWith("WEBVTT")) return "vtt"
    if (/-->/.test(content)) return "srt"
    return null
}

/** ASS h:mm:ss.cc, SRT hh:mm:ss,mmm and VTT (hh:)mm:ss.mmm → ms; NaN when it is none of them */
export function parseSubtitleTime(value: string): number {
    const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/)
    if (!match) return NaN
    const fraction = match[4]
    const ms = fraction.length === 2 ? Number(fraction) * 10 : fraction.length === 1 ? Number(fraction) * 100 : Number(fraction)
    return ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + ms
}

/** The words of an ASS text: override tags out, line breaks as spaces (videocore cleanSubtitleText) */
export function assPlainText(text: string) {
    return text.replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, " ").replace(/\\h/g, " ").replace(/\s+/g, " ").trim()
}

function parseAss(lines: string[]): SubtitleCue[] {
    const cues: SubtitleCue[] = []
    let inEvents = false
    let fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]
    lines.forEach((raw, index) => {
        const line = raw.trim()
        if (line.startsWith("[")) {
            inEvents = line.toLowerCase() === "[events]"
            return
        }
        if (!inEvents) return
        if (/^format:/i.test(line)) {
            fields = line.slice(line.indexOf(":") + 1).split(",").map(f => f.trim().toLowerCase())
            return
        }
        if (!raw.startsWith("Dialogue:")) return
        const textField = Math.max(fields.indexOf("text"), 1)
        const body = raw.slice("Dialogue:".length)
        // the text is everything after the comma that ends the field before it (it may hold commas itself)
        let cut = 0
        for (let i = 0; i < textField; i++) {
            cut = body.indexOf(",", cut) + 1
            if (cut === 0) return
        }
        const values = body.slice(0, cut).split(",").map(v => v.trim())
        const text = body.slice(cut)
        // drawings ({\p1} … {\p0}) are shapes, not words
        if (/\\p[1-9]/.test(text)) return
        const plain = assPlainText(text)
        if (!plain) return
        const leadingTags = text.match(/^(\{[^}]*\})*/)?.[0] ?? ""
        cues.push({
            start: parseSubtitleTime(values[fields.indexOf("start")] ?? ""),
            end: parseSubtitleTime(values[fields.indexOf("end")] ?? ""),
            text: plain,
            line: index,
            count: 1,
            prefix: "Dialogue:" + body.slice(0, cut) + leadingTags,
        })
    })
    return cues
}

function parseTimedText(lines: string[]): SubtitleCue[] {
    const cues: SubtitleCue[] = []
    for (let i = 0; i < lines.length; i++) {
        const timing = lines[i]
        if (!timing.includes("-->")) continue
        const [from, to] = timing.split("-->")
        let count = 0
        while (i + 1 + count < lines.length && lines[i + 1 + count].trim() !== "") count++
        const text = lines.slice(i + 1, i + 1 + count).join(" ")
            .replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim()
        if (text) {
            cues.push({ start: parseSubtitleTime(from), end: parseSubtitleTime(to ?? ""), text, line: i + 1, count, prefix: "" })
        }
        i += count
    }
    return cues
}

/** Reads an ASS/SSA, SRT or WebVTT file; null for anything else (image tracks never get here). */
export function parseSubtitleFile(content: string): SubtitleDocument | null {
    const format = detectSubtitleFormat(content)
    if (!format) return null
    const lines = content.replace(/^﻿/, "").split(/\r?\n/)
    const cues = format === "ass" ? parseAss(lines) : parseTimedText(lines)
    return { format, lines, cues }
}

/**
 * The file with the translated lines put in (cue index → text); untranslated lines stay as they are, so a half-done
 * track already shows the lines that are ready. A translation is one line, as on the old server (updateItemText).
 */
export function applyTranslations(doc: SubtitleDocument, translated: ReadonlyMap<number, string>): string {
    const byLine = new Map<number, { cue: SubtitleCue, text: string }>()
    doc.cues.forEach((cue, index) => {
        const text = translated.get(index)
        if (text !== undefined && text.trim()) byLine.set(cue.line, { cue, text: text.replace(/\r?\n/g, " ").trim() })
    })
    const out: string[] = []
    for (let i = 0; i < doc.lines.length; i++) {
        const hit = byLine.get(i)
        if (!hit) {
            out.push(doc.lines[i])
            continue
        }
        if (doc.format === "ass") {
            out.push(hit.cue.prefix + hit.text.replace(/[{}]/g, ""))
        } else {
            out.push(hit.text)
            i += hit.cue.count - 1
        }
    }
    return out.join("\n")
}

/* ── Order and batches ─────────────────────────────────────────────────── */

/**
 * Cue indexes in the order they are translated: from the line on screen onwards, then the ones before it (the old player
 * translated MKV lines as the stream reached them, so the playing part came first too).
 */
export function translationOrder(cues: readonly SubtitleCue[], positionMs: number): number[] {
    const ahead: number[] = []
    const behind: number[] = []
    const sorted = cues.map((cue, index) => ({ cue, index })).sort((a, b) => a.cue.start - b.cue.start)
    for (const { cue, index } of sorted) {
        if (!(cue.end < positionMs)) ahead.push(index)
        else behind.push(index)
    }
    return [...ahead, ...behind]
}

/**
 * Splits the order into request batches: a small first one so the lines on screen change soon, then bigger ones, because
 * mpv reloads the file after each.
 */
export function translationBatches(order: readonly number[], first = TRANSLATE_BATCH_SIZE, rest = TRANSLATE_BATCH_SIZE * 2): number[][] {
    const batches: number[][] = []
    for (let i = 0; i < order.length;) {
        const size = batches.length === 0 ? first : rest
        batches.push(order.slice(i, i + size))
        i += size
    }
    return batches
}

/* ── What this playback translated ─────────────────────────────────────── */

/**
 * The player's memory of translations for one playback (2.0.x `translatedFileTracks` + the event cache): which mpv track
 * shows a source in a language, which tracks are translations and of what, and what failed (not tried again on its own).
 * The translated lines themselves are cached twice more: by the server (per line) and as files in the app's cache.
 */
export class TranslatedTracks {
    private shownBy = new Map<string, number>()
    private origins = new Map<number, number>()
    private failedKeys = new Set<string>()

    static key(source: TranslationSource, provider: string, target: string) {
        return `${translationSourceKey(source)}|${provider}|${target}`
    }

    /** The track that shows this key: its translation, or another track already in the target language */
    shown(key: string) {
        return this.shownBy.get(key)
    }

    isTranslation(id: number) {
        return this.origins.has(id)
    }

    originOf(id: number) {
        return this.origins.get(id)
    }

    ids(): ReadonlySet<number> {
        return new Set(this.origins.keys())
    }

    /** `origin` only for a real translation; without it the track is an original that already is in the language */
    remember(key: string, id: number, origin?: number) {
        this.shownBy.set(key, id)
        if (origin !== undefined) this.origins.set(id, origin)
        this.failedKeys.delete(key)
    }

    /** a track mpv no longer has (replaced by the next batch's file, or removed after a failure) */
    forget(id: number) {
        this.origins.delete(id)
        for (const [key, shown] of this.shownBy) if (shown === id) this.shownBy.delete(key)
    }

    fail(key: string) {
        this.failedKeys.add(key)
    }

    failed(key: string) {
        return this.failedKeys.has(key)
    }
}

/** Name of a translated file in the app's cache: the source text, provider and language decide it. */
export function translationFileName(content: string, provider: string, target: string) {
    return `${hashText(content)}-${hashText(`${provider}|${target}`)}`
}

/** The title of the translated mpv track (videocore: label + " (translated)") */
export function translatedTrackTitle(track: Pick<PlayerTrack, "id" | "title" | "lang">) {
    return `${track.title || track.lang.toUpperCase() || `Track ${track.id}`} (translated)`
}

/* ── Which track, which language ───────────────────────────────────────── */

/** "en-US" → "en", "zh-hans" → "zh", "ger" → "de" */
export function baseLanguage(code: string | null | undefined) {
    const first = (code ?? "").trim().toLowerCase().split(/[-_]/)[0]
    if (!first) return ""
    return detectTrackLanguage({ language: first }) ?? first
}

/** True when the track already is in the target language (then it is not translated, 2.0.x selectTrack). */
export function isInLanguage(track: Pick<PlayerTrack, "lang" | "title">, target: string) {
    const language = detectTrackLanguage({ language: track.lang || undefined, label: track.title || undefined })
    return !!language && language === baseLanguage(target)
}

export type TranslationSource =
    | { kind: "embedded", trackNumber: number }
    | { kind: "content", content: string }
    | { kind: "url", url: string }

export type TranslationSourceContext = {
    /** the MKV's subtitle tracks (mpv numbers embedded tracks in this order) */
    mkvSubs: { number: number }[] | null | undefined
    /** the server's MP4 text tracks (content, no URL), in mpv's order of the embedded tracks */
    embeddedContents: readonly string[]
    /** subtitle files added to mpv, in the order they were added */
    externalFiles: readonly { label: string, url: string }[]
    /** mpv ids of translated tracks (never a source) */
    translatedIds: ReadonlySet<number>
}

/** Where a track's text comes from; null when the player cannot get it. */
export function translationSource(track: PlayerTrack, tracks: readonly PlayerTrack[], ctx: TranslationSourceContext): TranslationSource | null {
    if (ctx.translatedIds.has(track.id)) return null
    const subs = tracks.filter(tr => tr.type === "sub" && !ctx.translatedIds.has(tr.id)).sort((a, b) => a.id - b.id)
    if (!track.external) {
        if (ctx.mkvSubs?.length) {
            const number = mpvIdToMkvNumber(ctx.mkvSubs, track.id)
            return number === -1 ? null : { kind: "embedded", trackNumber: number }
        }
        const index = subs.filter(tr => !tr.external).findIndex(tr => tr.id === track.id)
        const content = ctx.embeddedContents[index]
        return content ? { kind: "content", content } : null
    }
    // an added file: by its title, else by its place among the added files
    const external = subs.filter(tr => tr.external)
    const byTitle = ctx.externalFiles.filter(file => !!track.title && file.label === track.title)
    if (byTitle.length === 1) return { kind: "url", url: byTitle[0].url }
    const file = ctx.externalFiles[external.findIndex(tr => tr.id === track.id)]
    return file ? { kind: "url", url: file.url } : null
}

/** Stable key of a source, for the per-session list of translated tracks and the cache file name. */
export function translationSourceKey(source: TranslationSource) {
    if (source.kind === "embedded") return `embedded:${source.trackNumber}`
    if (source.kind === "url") return `url:${source.url.replace(/([?&])(token|password|key)=[^&]*/gi, "$1")}`
    return `content:${hashText(source.content)}`
}

/** FNV-1a, hex: file names for the cache, no crypto needed */
export function hashText(text: string) {
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
}

/* ── Messages ──────────────────────────────────────────────────────────── */

/** The server's short error codes (videocore/translate_lines.go, directstream/subtitle_track.go) as a sentence. */
export function translationErrorText(code: string | null | undefined, t: Translate) {
    switch (code) {
        case "translation-unreachable":
            return t("The translation service could not be reached. Check the internet connection.",
                "Der Übersetzungsdienst ist nicht erreichbar. Bitte die Internetverbindung prüfen.")
        case "translation-rate-limited":
            return t("The translation service is busy. Try again in a few minutes.",
                "Der Übersetzungsdienst ist ausgelastet. In ein paar Minuten noch einmal versuchen.")
        case "translation-failed":
            return t("The translation service reported an error.", "Der Übersetzungsdienst hat einen Fehler gemeldet.")
        case "translation-off":
            return t("Subtitle translation is turned off.", "Die Untertitel-Übersetzung ist ausgeschaltet.")
        case "unsupported-format":
            return t("This subtitle track is made of images and cannot be translated.",
                "Diese Untertitelspur besteht aus Bildern und lässt sich nicht übersetzen.")
        case "no-subtitle-lines":
            return t("This subtitle track has no text to translate.", "Diese Untertitelspur hat keinen Text zum Übersetzen.")
        case "server-unreachable":
            return t("The app's server did not answer.", "Der Server der App hat nicht geantwortet.")
        default:
            return t("The subtitle track could not be read.", "Die Untertitelspur konnte nicht gelesen werden.")
    }
}
