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
    @Test fun requestCodesAreDistinctAndNamesRoundTrip() {
        assertEquals(Action.entries.size, Action.entries.map { it.requestCode }.toSet().size)
        Action.entries.forEach { assertEquals(it, PiPControls.fromName(it.name)) }
        assertNull(PiPControls.fromName("SEEK"))
        assertNull(PiPControls.fromName(null))
    }
}
