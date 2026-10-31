package com.seanime.app

import com.seanime.app.PiPControls.Action
import org.junit.Assert.*
import org.junit.Test

class PiPControlsTest {
    @Test fun threeActionsInRewindPlayForwardOrder() {
        assertEquals(listOf(Action.REWIND, Action.TOGGLE, Action.FORWARD), PiPControls.actionsFor(3))
        assertEquals(listOf(Action.REWIND, Action.TOGGLE, Action.FORWARD), PiPControls.actionsFor(5))
    }
    @Test fun fewerSlotsKeepPlayPauseOnly() {
        assertEquals(listOf(Action.TOGGLE), PiPControls.actionsFor(2))
        assertEquals(listOf(Action.TOGGLE), PiPControls.actionsFor(1))
        assertTrue(PiPControls.actionsFor(0).isEmpty())
    }
    @Test fun scriptsSeekTenSecondsAndToggle() {
        assertEquals("window.__seanimePiPCommand&&window.__seanimePiPCommand('seek',-10)", PiPControls.script(Action.REWIND))
        assertEquals("window.__seanimePiPCommand&&window.__seanimePiPCommand('toggle',0)", PiPControls.script(Action.TOGGLE))
        assertEquals("window.__seanimePiPCommand&&window.__seanimePiPCommand('seek',10)", PiPControls.script(Action.FORWARD))
    }
    @Test fun aspectRatioFollowsTheVideoWithinAndroidLimits() {
        assertEquals(1920 to 1080, PiPControls.aspectRatio(1920, 1080))
        assertEquals(1440 to 1080, PiPControls.aspectRatio(1440, 1080))
        assertEquals(1080 to 1920, PiPControls.aspectRatio(1080, 1920))
        // 2.4:1 cinema scope and an extreme portrait video are clamped just inside 2.39:1
        assertEquals(238 to 100, PiPControls.aspectRatio(1920, 800))
        assertEquals(100 to 238, PiPControls.aspectRatio(400, 2000))
        assertEquals(16 to 9, PiPControls.aspectRatio(0, 0))
        assertEquals(16 to 9, PiPControls.aspectRatio(1920, -1))
    }
    @Test fun requestCodesAreDistinctAndNamesRoundTrip() {
        assertEquals(Action.entries.size, Action.entries.map { it.requestCode }.toSet().size)
        Action.entries.forEach { assertEquals(it, PiPControls.fromName(it.name)) }
        assertNull(PiPControls.fromName("SEEK"))
        assertNull(PiPControls.fromName(null))
    }
}
