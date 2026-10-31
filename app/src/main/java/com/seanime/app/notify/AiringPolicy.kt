package com.seanime.app.notify

/** Decides which new episodes to announce and when to look again. Pure, so it can be unit tested. */
object AiringPolicy {
    /** An anime's next episode as AniList lists it; [airingAt] in epoch seconds. */
    data class Next(val mediaId: Int, val title: String, val episode: Int, val airingAt: Long)

    /**
     * Episodes from the last check that have aired by [now] and were not announced yet ([announced]: media id → episode).
     * Episodes older than [maxAgeSeconds] (the phone was off for days) are not announced any more.
     */
    fun aired(previous: List<Next>, announced: Map<Int, Int>, now: Long, maxAgeSeconds: Long = 2 * 86_400): List<Next> =
        previous.filter { it.airingAt <= now && it.airingAt > now - maxAgeSeconds && (announced[it.mediaId] ?: 0) < it.episode }

    /** When to check again: a few minutes after the next episode airs, at the latest after [maxWaitSeconds]. */
    fun nextCheck(upcoming: List<Next>, now: Long, delaySeconds: Long = 300, maxWaitSeconds: Long = 6 * 3600): Long {
        val latest = now + maxWaitSeconds
        val soonest = upcoming.filter { it.airingAt > now }.minOfOrNull { it.airingAt + delaySeconds } ?: latest
        return minOf(soonest, latest)
    }
}
