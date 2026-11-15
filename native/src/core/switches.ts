// geschrieben nach: Plan „Eigener Kern" §5.2/§9 (Bereiche des Kerns) und docs/EIGENER-KERN.md §4s (Stufe 8b-3: immer Kern, nie ein Server)

/**
 * The areas of the core, as names for the routes (registry.ts) and the log. Since stage 8b-3 (docs/EIGENER-KERN.md §4s)
 * there are no switches any more: the app runs without its server and every area is the core's.
 */
export const CORE_AREAS = ["extensions", "streams", "settings", "anilist", "manga", "offline", "library", "playback", "torrent", "debrid", "cast"] as const

export type CoreArea = (typeof CORE_AREAS)[number]

export function isCoreArea(value: unknown): value is CoreArea {
    return typeof value === "string" && (CORE_AREAS as readonly string[]).includes(value)
}
