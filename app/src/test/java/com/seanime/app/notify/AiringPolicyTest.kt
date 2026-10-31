package com.seanime.app.notify

import com.seanime.app.notify.AiringPolicy.Next
import org.junit.Assert.assertEquals
import org.junit.Test

class AiringPolicyTest {
    private val now = 1_800_000_000L
    private fun next(id: Int, episode: Int, inSeconds: Long) = Next(id, "Anime $id", episode, now + inSeconds)

    @Test fun announcesEpisodesThatAiredSinceTheLastCheck() {
        val previous = listOf(next(1, 5, -600), next(2, 3, 3600))
        assertEquals(listOf(1), AiringPolicy.aired(previous, emptyMap(), now).map { it.mediaId })
    }

    @Test fun announcesEachEpisodeOnce() {
        // AniList can still list a just-aired episode as the next one
        val previous = listOf(next(1, 5, -600))
        assertEquals(emptyList<Next>(), AiringPolicy.aired(previous, mapOf(1 to 5), now))
        assertEquals(1, AiringPolicy.aired(listOf(next(1, 6, -60)), mapOf(1 to 5), now).size)
    }

    @Test fun skipsEpisodesThatAiredLongAgo() {
        assertEquals(emptyList<Next>(), AiringPolicy.aired(listOf(next(1, 5, -3 * 86_400)), emptyMap(), now))
    }

    @Test fun checksAgainShortlyAfterTheNextEpisode() {
        val upcoming = listOf(next(1, 6, 7_200), next(2, 4, 1_800), next(3, 2, -60))
        assertEquals(now + 1_800 + 300, AiringPolicy.nextCheck(upcoming, now))
    }

    @Test fun checksAtLeastEverySixHours() {
        assertEquals(now + 6 * 3600, AiringPolicy.nextCheck(listOf(next(1, 6, 3 * 86_400)), now))
        assertEquals(now + 6 * 3600, AiringPolicy.nextCheck(emptyList(), now))
    }
}
