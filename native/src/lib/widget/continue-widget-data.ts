// geschrieben nach: Home "Continue watching" (main/_features/anime-library/_containers/continue-watching.tsx) und
// widget-cache.ts (gleiche Speicherart) – eigener Entwurf, kein Vorbild in der alten App.
import type { Anime_Episode } from "@/api/generated/types"
import type { KeyValue } from "./widget-cache"

/**
 * The "Continue watching" widget's data: the episodes Home shows under "Continue watching" (local library, downloads and
 * the streaming list, already sorted and filtered by useHandleLibraryCollection), cut to what the widget needs and kept
 * in MMKV, because the widget draws while the app may be closed. Pure, so it can be unit tested.
 */
export type ContinueEntry = { mediaId: number, title: string, episode: number, coverUrl: string }

/** One row per anime, in Home's order; episodes without an anime or marked invalid are left out. */
export function continueEntries(episodes: readonly Anime_Episode[], limit = MAX_ROWS): ContinueEntry[] {
    const seen = new Set<number>()
    const result: ContinueEntry[] = []
    for (const episode of episodes) {
        const anime = episode.baseAnime
        const mediaId = anime?.id
        if (!mediaId || episode.isInvalid || seen.has(mediaId) || !(episode.episodeNumber > 0)) continue
        seen.add(mediaId)
        const cover = anime.coverImage?.large || anime.coverImage?.medium || ""
        result.push({
            mediaId,
            title: anime.title?.userPreferred || anime.title?.romaji || anime.title?.english || episode.episodeTitle || "",
            episode: episode.episodeNumber,
            // the widget loads pictures from the web only (local files of a download are not readable by the launcher)
            coverUrl: cover.startsWith("https:") ? cover : "",
        })
        if (result.length >= limit) break
    }
    return result
}

export const MAX_ROWS = 4
const PADDING = 12
const HEADER = 30
export const ROW = 56
const GAP = 8

/** How much fits: a widget one cell high shows a single row without its head, larger ones the head and up to 4 rows. */
export function continueLayout(heightDp: number): { header: boolean, rows: number } {
    const inner = heightDp - 2 * PADDING
    if (inner < HEADER + ROW) return { header: false, rows: 1 }
    const rows = Math.floor((inner - HEADER + GAP) / (ROW + GAP))
    return { header: true, rows: Math.max(1, Math.min(MAX_ROWS, rows)) }
}

export const continueTexts = (german: boolean) => german
    ? { title: "Weiterschauen", empty: "Nichts zum Weiterschauen – Seanime Mobile öffnen", episode: (n: number) => `Folge ${n}` }
    : { title: "Continue watching", empty: "Nothing to continue – open Seanime Mobile", episode: (n: number) => `Episode ${n}` }

const KEY_DATA = "widget.continue_data"

/** The stored list; save tells whether it changed, so the app redraws the widget only then. */
export function createContinueStore(store: Pick<KeyValue, "getString" | "set">) {
    return {
        entries(): ContinueEntry[] {
            try {
                const list = JSON.parse(store.getString(KEY_DATA) ?? "[]") as unknown
                return Array.isArray(list) ? list as ContinueEntry[] : []
            }
            catch {
                return []
            }
        },
        save(entries: ContinueEntry[]): boolean {
            const value = JSON.stringify(entries)
            if (store.getString(KEY_DATA) === value) return false
            store.set(KEY_DATA, value)
            return true
        },
    }
}
