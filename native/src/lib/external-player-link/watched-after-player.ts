/*
 * "Mark episode N as watched?" after another player app (VLC, MX Player …): the app cannot follow the progress there,
 * so it asks when the user comes back. The trip is noted before the player opens (an intent's promise only resolves
 * once the other app returns), the app going to the background starts it, coming to the front ends it. The question
 * is only asked when it makes sense (shouldAskWatched); the answer goes the way "Mark as watched" goes. No React here,
 * so the decision is tested in Node (watched-after-player.test.ts); the sheet is ExternalPlayerWatchedPrompt.
 */

/** The episode sent to the other app */
export type WatchedAsk = { mediaId: number, episodeNumber: number }

/** A trip that ended: the episode and how long the user was in the other app */
export type FinishedTrip = WatchedAsk & { awayMs: number }

/** Back sooner than this, the episode was not watched (player closed, wrong app, nothing to play) */
export const SHORTEST_WATCH_MS = 60_000

/**
 * Ask only for a main episode that is not yet watched, after a real stay in the other app, and only when the user lets
 * the app set the progress: "Update progress automatically" on (the in-app player's 80 % rule cannot be measured in
 * another app, the question takes its place) and incognito mode off (it stops the app's own progress, as in the manga reader).
 */
export function shouldAskWatched({ episodeNumber, progress, awayMs, autoProgress, incognito }: {
    episodeNumber: number
    /** The list's progress now (0: not in the list) */
    progress: number
    awayMs: number
    autoProgress: boolean
    incognito: boolean
}): boolean {
    if (!autoProgress || incognito) return false
    if (!Number.isInteger(episodeNumber) || episodeNumber <= 0) return false
    if (episodeNumber <= progress) return false
    return awayMs >= SHORTEST_WATCH_MS
}

let trip: (WatchedAsk & { leftAt: number | null }) | null = null

function askable(ask: WatchedAsk | null | undefined): ask is WatchedAsk {
    return !!ask && Number.isInteger(ask.mediaId) && ask.mediaId > 0 && Number.isInteger(ask.episodeNumber) && ask.episodeNumber > 0
}

/**
 * Opens the other player and notes the trip; `ask` null (a special, no episode number): only opens. A player that
 * did not open (toast shown by `open`) leaves nothing to ask. Resolves to what `open` resolved to.
 */
export async function openWithWatchedAsk(ask: WatchedAsk | null | undefined, open: () => Promise<boolean>): Promise<boolean> {
    const noted = askable(ask) ? { ...ask, leftAt: null } : null
    trip = noted
    const opened = await open()
    if (!opened && trip === noted) trip = null
    return opened
}

/** Follows AppState: the trip starts in the background and ends at the front, then it is handed back once */
export function tripOnAppState(state: string, now: number): FinishedTrip | null {
    if (!trip) return null
    if (state === "background") {
        if (trip.leftAt === null) trip.leftAt = now
        return null
    }
    if (state !== "active" || trip.leftAt === null) return null
    const { mediaId, episodeNumber, leftAt } = trip
    trip = null
    return { mediaId, episodeNumber, awayMs: now - leftAt }
}

/** For tests: as after a new start of the app */
export function forgetTrip() {
    trip = null
}
