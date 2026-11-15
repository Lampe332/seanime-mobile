// geschrieben nach: Mihon „Delete after reading“ (https://mihon.app/changelogs) und docs/EIGENER-KERN.md §4o (die Downloads des Kerns); eigene Regel, kein Server-Quelltext

/*
 * "Delete watched episodes" (Downloads › settings): once a saved episode counts as watched (the player's 80 %, the same
 * mark that sets AniList's progress, or its end), the core removes app downloads by this rule. Only episodes the app
 * saved (offline.ts, not the files of the library folder), only ready ones, never in incognito mode (offline.ts).
 *   ""          off (the default)
 *   "watched"   the watched episode itself
 *   "keep-one"  the watched episodes before it, so the one just seen stays one episode longer
 */

export const DELETE_WATCHED_MODES = ["", "watched", "keep-one"] as const
export type DeleteWatchedMode = (typeof DELETE_WATCHED_MODES)[number]

export function deleteWatchedModeOf(value: unknown): DeleteWatchedMode {
    return (DELETE_WATCHED_MODES as readonly unknown[]).includes(value) ? value as DeleteWatchedMode : ""
}

export type SavedEpisode = { id: string, mediaId: number, episode: string, ready: boolean, watchedAt?: number }

/** The ids to remove now that `watched` was watched, by `mode` */
export function watchedToDelete(items: SavedEpisode[], watched: SavedEpisode, mode: DeleteWatchedMode): string[] {
    if (!mode) return []
    const number = Number(watched.episode)
    return items.filter(item => {
        if (item.mediaId !== watched.mediaId || !item.ready) return false
        if (mode === "watched") return item.id === watched.id
        const other = Number(item.episode)
        return item.id !== watched.id && item.watchedAt !== undefined && Number.isFinite(other) && Number.isFinite(number) && other < number
    }).map(item => item.id)
}
