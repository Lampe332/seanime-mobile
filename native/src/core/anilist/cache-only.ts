// geschrieben nach: dem Schalter „Cache-only mode“ der App (settings-app.tsx, sein Hinweistext) und der Schnittstelle GET/POST /api/v1/anilist/cache-layer/status (endpoints.ts: GET sagt, ob AniList gefragt wird, POST schaltet um); kein Server-Quelltext

import type { CoreRequest } from "../registry"

/*
 * Cache-only mode: the core does not ask AniList and answers from what it kept (anilist.ts readThrough).
 *
 * - Turned on by the user: no request goes to AniList, not even a change (it waits like one sent while AniList is
 *   down, changes.ts), until the user turns it off.
 * - Turned on by itself: AniList could not be reached or answered 5xx. Requests still go out, and the first one AniList
 *   answers turns it off again. Turning the switch off ends it at once.
 *
 * The state lives as long as the app runs, like the server's: a new start asks AniList again.
 */

export type CacheOnlyState = {
    /** The user turned it on: AniList is not asked */
    byUser: boolean
    /** AniList's last answer was a failure (network, 5xx) and none has come since */
    failed: boolean
}

export function newCacheOnly(): CacheOnlyState {
    return { byUser: false, failed: false }
}

/** One for the app: every answer of the core shares it */
export const sharedCacheOnly = newCacheOnly()

/** What GET answers: true while AniList is asked and answers, false in cache-only mode */
export function anilistWorking(state: CacheOnlyState): boolean {
    return !state.byUser && !state.failed
}

/** The switch (POST): from working to cache-only and back. Answers the new state like GET. */
export function toggleCacheOnly(state: CacheOnlyState): boolean {
    if (anilistWorking(state)) state.byUser = true
    else {
        state.byUser = false
        state.failed = false
    }
    return anilistWorking(state)
}

/** May a request go to AniList now? Not while the user turned cache-only mode on. */
export function mayAskAnilist(state: CacheOnlyState): boolean {
    return !state.byUser
}

/**
 * After AniList's answer (`status` null: data came back): any answer of AniList's own (also one refusing the question)
 * ends the mode it turned on by itself; a failure of the network or 5xx starts it; the rate limit says nothing.
 */
export function afterAnilist(state: CacheOnlyState, status: number | null): void {
    const was = state.failed
    if (status !== null && status >= 500) state.failed = true
    else if (status !== 429) state.failed = false
    if (state === sharedCacheOnly && state.failed !== was) anilistStateChanged(0)
}

/*
 * The app's sync hint (anilist-sync.tsx) hears here when AniList stops or starts answering and when a run of the queue
 * of changes ended (changes.ts, with how many went out). Not a core event: the server never sent one like it.
 */
type StateWatcher = (sent: number) => void
const watchers = new Set<StateWatcher>()

export function watchAnilistState(watcher: StateWatcher): () => void {
    watchers.add(watcher)
    return () => void watchers.delete(watcher)
}

/** Tells the watchers in a turn of their own, never inside the core's work */
export function anilistStateChanged(sent: number): void {
    if (watchers.size === 0) return
    setTimeout(() => {
        for (const watcher of [...watchers]) watcher(sent)
    }, 0)
}

export function cacheOnlyStatus(_request: CoreRequest): boolean {
    return anilistWorking(sharedCacheOnly)
}

export function switchCacheOnly(_request: CoreRequest): boolean {
    return toggleCacheOnly(sharedCacheOnly)
}
