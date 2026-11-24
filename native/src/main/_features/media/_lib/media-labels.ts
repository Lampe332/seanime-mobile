import type { Translate } from "@/lib/app-language"

/* Labels of the phone kit (phone-screen.tsx) that the anime page and the preview share. */

export const MEDIA_STATUS_LABELS: Record<string, [string, string]> = {
    FINISHED: ["Finished", "Abgeschlossen"], RELEASING: ["Releasing", "Läuft"], NOT_YET_RELEASED: ["Upcoming", "Demnächst"],
    HIATUS: ["Hiatus", "Pausiert"], CANCELLED: ["Cancelled", "Abgebrochen"],
}

/** Every AniList format in the app language */
export const FORMAT_LABELS: Record<string, [string, string]> = {
    TV: ["TV", "TV"], TV_SHORT: ["TV short", "TV-Kurzserie"], MOVIE: ["Movie", "Film"], SPECIAL: ["Special", "Special"], OVA: ["OVA", "OVA"],
    ONA: ["ONA", "ONA"], MUSIC: ["Music", "Musik"], MANGA: ["Manga", "Manga"], NOVEL: ["Novel", "Roman"], ONE_SHOT: ["One shot", "One-Shot"],
}

/** "Music" for MUSIC; a format AniList adds later reads "Some format" instead of "SOME_FORMAT" */
export function formatLabel(t: Translate, format?: string | null) {
    if (!format) return ""
    const known = FORMAT_LABELS[format]
    if (known) return t(...known)
    const words = format.replace(/_/g, " ").toLowerCase()
    return words.charAt(0).toUpperCase() + words.slice(1)
}

export const SEASON_LABELS: Record<string, [string, string]> = {
    WINTER: ["Winter", "Winter"], SPRING: ["Spring", "Frühling"], SUMMER: ["Summer", "Sommer"], FALL: ["Fall", "Herbst"],
}

/** "Fall 2026", in the app language; empty when AniList knows neither */
export function seasonYearLabel(t: Translate, media: { season?: string | null, seasonYear?: number | null, startDate?: { year?: number | null } | null }) {
    const year = media.seasonYear || media.startDate?.year || ""
    if (media.season && year && media.season in SEASON_LABELS) return seasonWithYear(t, media.season, year)
    const season = media.season ? t(...(SEASON_LABELS[media.season] ?? [media.season, media.season])) : ""
    return [season, year].filter(Boolean).join(" ")
}

/** "Fall 2026" as one text, so each language orders season and year itself ("2026年秋"). */
export function seasonWithYear(t: Translate, season: string, year: number | string) {
    switch (season) {
        case "WINTER": return t(`Winter ${year}`, `Winter ${year}`)
        case "SPRING": return t(`Spring ${year}`, `Frühling ${year}`)
        case "SUMMER": return t(`Summer ${year}`, `Sommer ${year}`)
        default: return t(`Fall ${year}`, `Herbst ${year}`)
    }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…" }

/**
 * AniList's synopsis is HTML; its text with the paragraphs kept (the web used DOMParser). A <br> and the newline AniList
 * writes after it are one line break, a list item starts its own line ("- …"), and more than one empty line is one.
 */
export function synopsisText(html?: string | null) {
    if (!html) return ""
    return html
        .replace(/\r\n?/g, "\n")
        .replace(/<br\s*\/?>[ \t]*\n?/gi, "\n")
        .replace(/<\/p>\s*/gi, "\n\n")
        .replace(/<li[^>]*>\s*/gi, "\n- ")
        .replace(/<\/(ul|ol)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
            if (code[0] === "#") {
                const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
                return Number.isFinite(n) ? String.fromCodePoint(n) : match
            }
            return ENTITIES[code.toLowerCase()] ?? match
        })
        .split("\n").map(line => line.replace(/[ \t ]+/g, " ").trim()).join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

/** The description on the anime and manga pages: like the preview, with its line breaks and paragraphs (synopsisText) */
export function plainDescription(html?: string | null) {
    return synopsisText(html)
}
