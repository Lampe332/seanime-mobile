import type { Models_HomeItem, Nullish } from "@/api/generated/types"
import { DEFAULT_HOME_ITEMS, HOME_ITEM_IDS, HOME_ITEMS } from "./home-items.utils"

/*
 * Home's layout as data, from home-screen.tsx and home-settings-modal.tsx of the web app (kept out of the screens so it
 * can be tested without React Native).
 */

/** Continue watching and its banner are one kind of section: Android draws the banner as the row (resolveHomeItems). */
export function sectionKind(type: string): string {
    return type === "anime-continue-watching-header" ? "anime-continue-watching" : type
}

/**
 * Home's rules for its sections, kept on every load and save (so they also put right lists saved before 4.3.1):
 * - every kind of section once; of two, the upper one stays;
 * - a banner (kind "header") only shows as the first section, so it is moved there. Only one can be first: the Discover
 *   banner. With it on Home, the Continue watching banner becomes the Continue watching row where it stands.
 */
export function arrangeHomeItems(items: Models_HomeItem[]): Models_HomeItem[] {
    const kinds = new Set<string>()
    let arranged = items.filter(item => !kinds.has(sectionKind(item.type)) && !!kinds.add(sectionKind(item.type)))
    const discover = arranged.find(item => item.type === "discover-header")
    if (discover) arranged = arranged.map(item => item.type === "anime-continue-watching-header" ? { ...item, type: "anime-continue-watching" } : item)
    const banner = discover ?? arranged.find(item => item.type === "anime-continue-watching-header")
    if (banner && arranged[0] !== banner) arranged = [banner, ...arranged.filter(item => item !== banner)]
    return arranged
}

/**
 * The sections Home shows: the saved list (an emptied Home stays empty), or the default one while nothing was ever saved.
 * Android Home has no header banner: the leading "anime-continue-watching-header" shows as "anime-continue-watching".
 */
export function resolveHomeItems(saved: Nullish<Models_HomeItem[]>): Models_HomeItem[] {
    const items = arrangeHomeItems(saved ?? DEFAULT_HOME_ITEMS)
    if (items[0]?.type !== "anime-continue-watching-header") return items
    return items.map(item => item.type === "anime-continue-watching-header" ? { ...item, type: "anime-continue-watching" } : item)
}

/** A section whose schema changed since it was saved loses its options (they may not fit any more). */
export function withCurrentSchema(item: Models_HomeItem): Models_HomeItem | undefined {
    const schema = HOME_ITEMS[item.type]
    if (!schema) return undefined
    if (item.schemaVersion !== schema.schemaVersion) return { ...item, schemaVersion: schema.schemaVersion, options: undefined }
    return item
}

/** What is saved: only known sections, arranged by Home's rules, each stamped with its current schema version. */
export function normalizeHomeItems(items: Models_HomeItem[]): Models_HomeItem[] {
    return arrangeHomeItems(items.filter(item => !!HOME_ITEMS[item.type])).map(item => ({ ...item, schemaVersion: HOME_ITEMS[item.type].schemaVersion }))
}

/** A carousel's status narrows it only when it leaves out what it shows without one (releasing and finished titles). */
function statusNarrows(status: unknown): boolean {
    return Array.isArray(status) && status.length > 0 && !(status.includes("RELEASING") && status.includes("FINISHED"))
}

/**
 * Why an anime / manga carousel came back empty. AniList's genre_in wants every picked genre on one title, so two or
 * more rarely-paired genres (or all of them) empty the row: they are named when nothing else narrows it. Otherwise it
 * names every option that narrows the row, without blaming one of them.
 */
export function carouselEmptyCause(options: Nullish<Record<string, unknown>>, type: "anime" | "manga"):
    { genres: number } | { options: string[] } {
    const names = ["status", "format", "genres", ...(type === "anime" ? ["season"] : []), "year", "countryOfOrigin"]
    const set = names.filter(name => name === "status" ? statusNarrows(options?.status)
        : Array.isArray(options?.[name]) ? (options[name] as unknown[]).length > 0 : !!options?.[name])
    const genres = Array.isArray(options?.genres) ? options.genres.length : 0
    if (genres > 1 && set.every(name => name === "genres")) return { genres }
    const schema = HOME_ITEMS[`${type}-carousel`]?.options ?? []
    return { options: set.map(name => (schema.find(option => option.name === name)?.label ?? name).split(" (")[0]) }
}

/** A carousel back to its defaults (top rated, released or releasing); only its name stays. */
export function resetCarouselOptions(items: Models_HomeItem[], id: string): Models_HomeItem[] {
    return normalizeHomeItems(items.map(item => item.id !== id ? item
        : { ...item, options: item.options?.name ? { name: item.options.name } : undefined }))
}

/**
 * Every kind of section is on Home once, so only kinds not on it are offered. The Continue watching banner is not
 * offered while the Discover banner is on Home (it would be the Continue watching row, arrangeHomeItems).
 */
export function availableHomeItemTypes(current: Models_HomeItem[]): string[] {
    const kinds = new Set(current.map(item => sectionKind(item.type)))
    const discover = current.some(item => item.type === "discover-header")
    return HOME_ITEM_IDS.filter(type => !kinds.has(sectionKind(type)) && !(discover && type === "anime-continue-watching-header"))
}

/** A new section at the end of Home (a banner at the top); a kind already on Home, or an unknown one, is not added. */
export function addHomeItem(current: Models_HomeItem[], type: string, id: string): Models_HomeItem[] {
    if (!availableHomeItemTypes(current).includes(type)) return current
    return normalizeHomeItems([...current, { id, type, schemaVersion: HOME_ITEMS[type].schemaVersion }])
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
