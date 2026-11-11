/** Decides which new episodes to announce and when to look again (AiringPolicy.kt). Pure, so it can be unit tested. */

/** An anime's next episode as AniList lists it; airingAt in epoch seconds. */
export type AiringNext = { mediaId: number, title: string, episode: number, airingAt: number }

/** media id → last announced episode */
export type Announced = Record<number, number>

/**
 * Episodes from the last check that have aired by now and were not announced yet.
 * Episodes older than maxAgeSeconds (the phone was off for days) are not announced any more.
 */
export function aired(previous: AiringNext[], announced: Announced, now: number, maxAgeSeconds: number = 2 * 86_400): AiringNext[] {
    return previous.filter(it => it.airingAt <= now && it.airingAt > now - maxAgeSeconds && (announced[it.mediaId] ?? 0) < it.episode)
}

/** When to check again: a few minutes after the next episode airs, at the latest after maxWaitSeconds. */
export function nextCheck(upcoming: AiringNext[], now: number, delaySeconds: number = 300, maxWaitSeconds: number = 6 * 3600): number {
    const latest = now + maxWaitSeconds
    const future = upcoming.filter(it => it.airingAt > now).map(it => it.airingAt + delaySeconds)
    const soonest = future.length ? Math.min(...future) : latest
    return Math.min(soonest, latest)
}

/** A few minutes after the episode aired, like the old app's check after the alarm (AiringNotifier.kt). */
export const ANNOUNCE_DELAY_SECONDS = 300

/**
 * The announcements to plan: upcoming episodes (not aired + delay yet) that were not announced. AniList can still list a
 * just-aired episode as the next one; that one is either still ahead (planned once, under the same id) or past, then the
 * previous check had planned it and it counts as announced.
 */
export function toSchedule(fresh: AiringNext[], announced: Announced, now: number, delaySeconds: number = ANNOUNCE_DELAY_SECONDS): AiringNext[] {
    return fresh.filter(it => it.airingAt + delaySeconds > now && (announced[it.mediaId] ?? 0) < it.episode)
}
