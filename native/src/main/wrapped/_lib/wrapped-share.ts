/** Pure helpers of the shareable "Your year" image (wrapped-share-section.tsx): what the image says and where it goes. */
import type { Translate } from "@/lib/app-language"
import type { WrappedView } from "@/main/lists/_lib/wrapped"
import { watchTime } from "@/main/wrapped/_lib/wrapped-phone"

/** The image: 4:5 portrait in 1080 x 1350 px, the SVG's viewBox in the same units */
export const SHARE_WIDTH = 1080
export const SHARE_HEIGHT = 1350
export const SHARE_PAD = 88

/** Characters that fit a line (the SVG does not wrap): measured for Inter at the sizes the image uses */
export const SHARE_LIMITS = { title: 30, genre: 18, studio: 20 } as const

export type ShareFormats = { number: (value: number, digits?: number) => string, score: (score: number) => string }
export type ShareStat = { key: "titles" | "episodes" | "hours", value: string, label: string }
export type ShareRated = { rank: number, title: string, score: string }
export type ShareCard = {
    year: number
    heading: string
    stats: ShareStat[]
    topRated: ShareRated[]
    genres: string[]
    studio: string | null
    footer: string
}

/** Width of a character in Latin letters: CJK, kana, Hangul and emoji take about two */
function charWidth(char: string): number {
    return (char.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1
}

/** A text cut to `max` Latin letters of width, ending in "…" when cut (by code points, so no emoji is split) */
export function clip(text: string, max: number): string {
    const chars = Array.from(text.trim())
    if (chars.reduce((sum, char) => sum + charWidth(char), 0) <= max) return chars.join("")
    let width = 1
    let end = 0
    while (end < chars.length && width + charWidth(chars[end]) <= max) width += charWidth(chars[end++])
    return chars.slice(0, Math.max(1, end)).join("").trimEnd() + "…"
}

/** What the image shows for a year: only the parts with data, numbers and texts in the app language */
export function buildShareCard(view: WrappedView, t: Translate, f: ShareFormats): ShareCard {
    const hours = watchTime(view.minutes).hours
    const stats: ShareStat[] = [
        { key: "titles", value: f.number(view.titles), label: t("Anime finished", "Anime abgeschlossen") },
    ]
    if (view.episodes > 0) {
        stats.push({ key: "episodes", value: f.number(view.episodes), label: view.episodes === 1 ? t("Episode", "Folge") : t("Episodes", "Folgen") })
    }
    if (hours > 0) {
        stats.push({ key: "hours", value: `≈ ${f.number(hours)}`, label: hours === 1 ? t("Hour", "Stunde") : t("Hours", "Stunden") })
    }
    return {
        year: view.year,
        heading: t(`My ${view.year} in anime`, `Mein Anime-Jahr ${view.year}`),
        stats,
        topRated: view.topRated.slice(0, 3).map((item, index) => ({
            rank: index + 1,
            title: clip(item.title, SHARE_LIMITS.title),
            score: f.score(item.score),
        })),
        genres: view.genres.slice(0, 3).map(genre => clip(genre.name, SHARE_LIMITS.genre)),
        studio: view.studios[0]?.name ? clip(view.studios[0].name, SHARE_LIMITS.studio) : null,
        footer: hours > 0
            ? t("Counted from my lists. Hours are estimated.", "Gezählt aus meinen Listen. Stunden geschätzt.")
            : t("Counted from my lists.", "Gezählt aus meinen Listen."),
    }
}

/** Heights of the image's parts in px */
export const SHARE_SIZES = {
    statRow: 128,
    ratedHead: 64,
    ratedRow: 56,
    listHead: 64,
    listRow: 48,
    /** Where the middle part may start and must end (header above, footer below) */
    top: 300,
    bottom: 1196,
    minGap: 32,
    maxGap: 88,
} as const

export type ShareLayout = { stats: number, rated: number | null, lists: number | null }

/** Top of each middle part: the parts stacked with even gaps; with little content the gaps grow and the stack is centred */
export function shareLayout(card: ShareCard): ShareLayout {
    const s = SHARE_SIZES
    const listLines = Math.max(card.genres.length, card.studio ? 1 : 0)
    const parts = [
        card.stats.length * s.statRow,
        card.topRated.length ? s.ratedHead + card.topRated.length * s.ratedRow : 0,
        listLines ? s.listHead + listLines * s.listRow : 0,
    ]
    const shown = parts.filter(height => height > 0)
    const room = s.bottom - s.top
    const content = shown.reduce((sum, height) => sum + height, 0)
    const gap = shown.length > 1 ? Math.min(s.maxGap, Math.max(s.minGap, (room - content) / (shown.length - 1))) : 0
    const used = content + gap * (shown.length - 1)
    let y = s.top + Math.max(0, Math.round((room - used) / 2))
    const tops = parts.map(height => {
        if (!height) return null
        const top = y
        y += height + gap
        return Math.round(top)
    })
    return { stats: tops[0] ?? s.top, rated: tops[1], lists: tops[2] }
}

/** Font size so a one-line text of `length` characters fits `width` px (Inter bold is about 0.58 em per character) */
export function fitFontSize(length: number, width: number, max: number, perChar = 0.58): number {
    if (length <= 0) return max
    return Math.max(24, Math.min(max, Math.floor(width / (length * perChar))))
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const BASE64_INDEX = new Map(Array.from(BASE64, (char, index) => [char, index] as const))

/** Base64 (optionally as a data URI, with or without padding) to bytes; throws on characters outside Base64 */
export function base64ToBytes(input: string): Uint8Array {
    const body = input.replace(/^data:[^,]*,/, "").replace(/\s+/g, "").replace(/=+$/, "")
    if (body.length % 4 === 1) throw new Error("Invalid Base64 length")
    const out = new Uint8Array(Math.floor(body.length * 3 / 4))
    let buffer = 0
    let bits = 0
    let at = 0
    for (const char of body) {
        const value = BASE64_INDEX.get(char)
        if (value === undefined) throw new Error("Invalid Base64 character")
        buffer = ((buffer << 6) | value) & 0xffffff
        bits += 6
        if (bits >= 8) {
            bits -= 8
            out[at++] = (buffer >> bits) & 0xff
        }
    }
    return out
}
