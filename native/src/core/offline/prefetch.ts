// geschrieben nach: D:\SNB\belege\2026-11-15\P-plan\plan.md Punkt 5 („Vorab laden: nächste Folge(n)“), Vorbild laut Plan (Mihon/Aniyomi-Download-Optionen, Seanime Desktop Auto Downloader) und dem eigenen Kern (offline.ts Warteschlange, auto-delete.ts); kein Server-Quelltext

/*
 * "Download next episodes automatically" (Downloads › settings): while an anime on the "Watching" list is being
 * watched, the core queues the next released episodes, so they are on the device before they are needed.
 *   0       off (the default)
 *   1 to 3  that many episodes after the one being watched
 * Only on Wi-Fi (a known network that is not metered), never in incognito mode, never with less than MIN_FREE_BYTES
 * free, never an episode that is already saved or waiting (in any state: a failed one is not tried again by itself).
 * A queued-ahead episode also loads on Wi-Fi only (OfflineItem.wifiOnly), whatever the "Wi-Fi only" setting says;
 * queued by the user as well, it loads like any other.
 * The window is fixed: with "2" after episode 5 only episodes 6 and 7 count, a saved 6 does not bring 8.
 * The rest (which anime, which source) is offline.ts offlinePrefetch.
 */

export const PREFETCH_COUNTS = [0, 1, 2, 3] as const
export type PrefetchCount = (typeof PREFETCH_COUNTS)[number]

export function prefetchCountOf(value: unknown): PrefetchCount {
    return (PREFETCH_COUNTS as readonly unknown[]).includes(value) ? value as PrefetchCount : 0
}

/** No episode is queued ahead with less free storage than this */
export const MIN_FREE_BYTES = 2 * 1024 ** 3

export type PrefetchBlock = "" | "off" | "incognito" | "wifi" | "storage"

/** Why nothing may be queued ahead now ("" : it may). `freeBytes` null: the device cannot say, nothing is held back for it */
export function prefetchBlock(state: { count: number, incognito: boolean, network: { known: boolean, connected: boolean, metered: boolean }, freeBytes: number | null }): PrefetchBlock {
    if (state.count <= 0) return "off"
    if (state.incognito) return "incognito"
    if (!state.network.known || !state.network.connected || state.network.metered) return "wifi"
    if (state.freeBytes !== null && state.freeBytes < MIN_FREE_BYTES) return "storage"
    return ""
}

/**
 * The episode the user is at: the higher of AniList's progress and the episode last played (the one being watched
 * counts, finished or not, so its next one is wanted).
 */
export function watchingEpisode(progress: number, played: number): number {
    const whole = (value: number) => Number.isInteger(value) && value > 0 ? value : 0
    return Math.max(whole(progress), whole(played))
}

/** The numbers to queue: the `count` episodes after `at`, only those out (`out`), none that is `saved` (episode numbers as text) */
export function episodesToPrefetch(at: number, count: number, out: number, saved: ReadonlySet<string>): number[] {
    const wanted: number[] = []
    for (let number = at + 1; number <= Math.min(at + count, out); number++) {
        if (!saved.has(String(number))) wanted.push(number)
    }
    return wanted
}
