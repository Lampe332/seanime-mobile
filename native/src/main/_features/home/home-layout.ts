import type { Models_HomeItem, Nullish } from "@/api/generated/types"
import { DEFAULT_HOME_ITEMS, HOME_ITEM_IDS, HOME_ITEMS } from "./home-items.utils"

/*
 * Home's layout as data, from home-screen.tsx and home-settings-modal.tsx of the web app (kept out of the screens so it
 * can be tested without React Native).
 */

/**
 * The sections Home shows: the saved list, or the default one when nothing is saved. Android Home has no header banner:
 * a leading "anime-continue-watching-header" shows as "anime-continue-watching" (and replaces another one of those).
 */
export function resolveHomeItems(saved: Nullish<Models_HomeItem[]>): Models_HomeItem[] {
    let items = saved?.length ? saved : DEFAULT_HOME_ITEMS
    if (items[0]?.type !== "anime-continue-watching-header") return items
    if (items.some(item => item.type === "anime-continue-watching")) items = items.filter(item => item.type !== "anime-continue-watching")
    return items.map(item => item.type === "anime-continue-watching-header" ? { ...item, type: "anime-continue-watching" } : item)
}

/** A section whose schema changed since it was saved loses its options (they may not fit any more). */
export function withCurrentSchema(item: Models_HomeItem): Models_HomeItem | undefined {
    const schema = HOME_ITEMS[item.type]
    if (!schema) return undefined
    if (item.schemaVersion !== schema.schemaVersion) return { ...item, schemaVersion: schema.schemaVersion, options: undefined }
    return item
}

/** What is saved: only known sections, each stamped with its current schema version. */
export function normalizeHomeItems(items: Models_HomeItem[]): Models_HomeItem[] {
    return items.filter(item => !!HOME_ITEMS[item.type]).map(item => ({ ...item, schemaVersion: HOME_ITEMS[item.type].schemaVersion }))
}

/** Sections that can be added more than once stay offered; the others only while they are not on Home. */
const REPEATABLE = new Set(["anime-carousel", "manga-carousel", "centered-title", "my-lists"])

export function availableHomeItemTypes(current: Models_HomeItem[]): string[] {
    return HOME_ITEM_IDS.filter(type => REPEATABLE.has(type) || !current.some(item => item.type === type))
}

/** A new section at the end of Home. */
export function addHomeItem(current: Models_HomeItem[], type: string, id: string): Models_HomeItem[] {
    return normalizeHomeItems([...current, { id, type, schemaVersion: HOME_ITEMS[type]?.schemaVersion ?? 1 }])
}

/** Move up (-1) or down (+1); out of range leaves the order as it is. */
export function moveHomeItem(items: Models_HomeItem[], index: number, direction: -1 | 1): Models_HomeItem[] {
    const to = index + direction
    if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved)
    return normalizeHomeItems(next)
}

/** Home puts 2rem between sections, except before the library sections, which bring their own heading space. */
export function hasSectionGapBefore(type: string, index: number) {
    return index !== 0 && !["manga-library", "anime-library", "anime-continue-watching", "anime-library-stats"].includes(type)
}

/**
 * Sections drawn by screens that are not native yet. Home leaves them out until their group lands (Umbau-Karte §6, Start).
 * Empty since 2.7: the schedule calendar (the last one) is the native schedule screen.
 */
export const HOME_ITEMS_PENDING: Record<string, string> = {}

/** The Home banner's stored opacity (Settings > Appearance, 0–100; unset or 0 means full) as 0–1. */
export function homeBannerOpacity(stored: Nullish<number>) {
    return Math.min(100, Math.max(0, stored || 100)) / 100
}

/** The banner's stored CSS object-position ("30% 70%") as expo-image's contentPosition; anything else stays centred. */
export function homeBannerPosition(stored: Nullish<string>): { left: `${number}%`, top: `${number}%` } {
    const match = /^\s*(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%\s*$/.exec(stored || "")
    return match ? { left: `${Number(match[1])}%`, top: `${Number(match[2])}%` } : { left: "50%", top: "50%" }
}

/** The "Currently watching" genre filter: genres of the listed series by count (most first, then A–Z). */
export function genreCounts(entries: Nullish<{ media?: { genres?: Nullish<string[]> } | null }[]>): [string, number][] {
    const counts = new Map<string, number>()
    entries?.forEach(entry => entry.media?.genres?.forEach(genre => counts.set(genre, (counts.get(genre) || 0) + 1)))
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** Every picked genre must match. */
export function filterByGenres<T extends { media?: { genres?: Nullish<string[]> } | null }>(entries: Nullish<T[]>, genres: string[]): T[] {
    if (!entries) return []
    if (!genres.length) return entries
    return entries.filter(entry => genres.every(genre => entry.media?.genres?.includes(genre)))
}
