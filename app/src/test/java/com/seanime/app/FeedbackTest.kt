package com.seanime.app

import android.media.AudioManager
import android.view.HapticFeedbackConstants
import org.junit.Assert.*
import org.junit.Test

class FeedbackTest {
    @Test fun confirmAndRejectUseTheirOwnConstantsFromAndroid11() {
        assertEquals(HapticFeedbackConstants.CONFIRM, Feedback.hapticConstant("confirm", 30))
        assertEquals(HapticFeedbackConstants.REJECT, Feedback.hapticConstant("reject", 34))
    }
    @Test fun olderAndroidFallsBackToConstantsOfApi21() {
        assertEquals(HapticFeedbackConstants.VIRTUAL_KEY, Feedback.hapticConstant("confirm", 21))
        assertEquals(HapticFeedbackConstants.LONG_PRESS, Feedback.hapticConstant("reject", 29))
        assertEquals(HapticFeedbackConstants.CLOCK_TICK, Feedback.hapticConstant("tick", 21))
        assertEquals(HapticFeedbackConstants.LONG_PRESS, Feedback.hapticConstant("long", 21))
    }
    @Test fun unknownKindsDoNothing() {
        assertNull(Feedback.hapticConstant("buzz", 34))
        assertNull(Feedback.hapticConstant("", 34))
    }
    @Test fun soundOnlyWithRingerOnAndNothingPlaying() {
        assertTrue(Feedback.soundAllowed(true, AudioManager.RINGER_MODE_NORMAL, false))
        assertFalse(Feedback.soundAllowed(false, AudioManager.RINGER_MODE_NORMAL, false))
        assertFalse(Feedback.soundAllowed(true, AudioManager.RINGER_MODE_VIBRATE, false))
        assertFalse(Feedback.soundAllowed(true, AudioManager.RINGER_MODE_SILENT, false))
        assertFalse(Feedback.soundAllowed(true, AudioManager.RINGER_MODE_NORMAL, true))
    }
}
