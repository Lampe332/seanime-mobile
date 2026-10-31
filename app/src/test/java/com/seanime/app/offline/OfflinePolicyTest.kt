package com.seanime.app.offline

import com.seanime.app.offline.OfflinePolicy.Failure
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class OfflinePolicyTest {
    @Test fun refusedLocalServerMeansItWasNotRunning() {
        val error = IOException("download failed", ConnectException("Connection refused"))
        assertEquals(Failure.SERVER_OFF, OfflinePolicy.failure(error, localProxy = true))
        assertEquals(Failure.CONNECTION, OfflinePolicy.failure(error, localProxy = false))
    }
    @Test fun networkAndStorageErrorsAreNamed() {
        assertEquals(Failure.CONNECTION, OfflinePolicy.failure(UnknownHostException("cdn.example"), false))
        assertEquals(Failure.CONNECTION, OfflinePolicy.failure(IOException(SocketTimeoutException()), false))
        assertEquals(Failure.STORAGE_FULL, OfflinePolicy.failure(IOException("write failed", IOException("ENOSPC (No space left on device)")), false))
        assertEquals(Failure.UNKNOWN, OfflinePolicy.failure(IllegalStateException("odd"), false))
        assertEquals(Failure.UNKNOWN, OfflinePolicy.failure(null, true))
    }
    @Test fun everyFailureHasAText() {
        Failure.entries.forEach { assertTrue(OfflinePolicy.failureText(it).isNotBlank()) }
    }
    @Test fun subtitleLanguagesFromCodesAndNames() {
        assertEquals("de", OfflinePolicy.subtitleLanguage("de"))
        assertEquals("pt", OfflinePolicy.subtitleLanguage("pt-BR"))
        assertEquals("en", OfflinePolicy.subtitleLanguage("English"))
        assertEquals("de", OfflinePolicy.subtitleLanguage("Deutsch"))
        assertEquals("de", OfflinePolicy.subtitleLanguage("german"))
        assertEquals("pt", OfflinePolicy.subtitleLanguage("Portuguese (Brazil)"))
        assertNull(OfflinePolicy.subtitleLanguage(""))
        assertNull(OfflinePolicy.subtitleLanguage(null))
        assertNull(OfflinePolicy.subtitleLanguage("Full Subs [CR]"))
    }
    @Test fun trackNamesAreReadable() {
        assertEquals("Japanese", OfflinePolicy.trackName(null, "ja", 2, "Track 1"))
        assertEquals("Japanese · 5.1", OfflinePolicy.trackName(null, "ja", 6, "Track 1"))
        assertEquals("Commentary · English", OfflinePolicy.trackName("Commentary", "en", 2, "Track 1"))
        assertEquals("English (SDH)", OfflinePolicy.trackName("English (SDH)", "en", 0, "Subtitles"))
        assertEquals("Track 2", OfflinePolicy.trackName(null, "und", 2, "Track 2"))
    }
}
