import type { Translate } from "@/lib/app-language"

/* Labels of the phone kit (phone-screen.tsx) that the anime page and the preview share. */

export const MEDIA_STATUS_LABELS: Record<string, [string, string]> = {
    FINISHED: ["Finished", "Abgeschlossen"], RELEASING: ["Releasing", "Läuft"], NOT_YET_RELEASED: ["Upcoming", "Demnächst"],
    HIATUS: ["Hiatus", "Pausiert"], CANCELLED: ["Cancelled", "Abgebrochen"],
}

export const SEASON_LABELS: Record<string, [string, string]> = {
    WINTER: ["Winter", "Winter"], SPRING: ["Spring", "Frühling"], SUMMER: ["Summer", "Sommer"], FALL: ["Fall", "Herbst"],
}

/** "Fall 2026", in the app language; empty when AniList knows neither */
export function seasonYearLabel(t: Translate, media: { season?: string | null, seasonYear?: number | null, startDate?: { year?: number | null } | null }) {
    const season = media.season ? t(...(SEASON_LABELS[media.season] ?? [media.season, media.season])) : ""
    const year = media.seasonYear || media.startDate?.year || ""
    return [season, year].filter(Boolean).join(" ")
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…" }

/** AniList's synopsis is HTML; its text with the line breaks kept (the web used DOMParser) */
export function synopsisText(html?: string | null) {
    if (!html) return ""
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
            if (code[0] === "#") {
                const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
                return Number.isFinite(n) ? String.fromCodePoint(n) : match
            }
            return ENTITIES[code.toLowerCase()] ?? match
        })
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

/**
 * The anime page's About: the description without tags in one paragraph (mobile-anime-header.tsx). The web's <p> folds
 * every run of white space (AniList's "\n" after a <br>, a trailing newline) into one space; a native Text would keep
 * them as empty lines (S22: 22dp more under the description).
 */
export function plainDescription(html?: string | null) {
    return html?.replace(/(<([^>]+)>)/ig, "").replace(/\s+/g, " ").trim() || ""
}
