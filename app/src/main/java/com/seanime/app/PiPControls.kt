package com.seanime.app

/** Platform-free mapping of the picture-in-picture buttons, kept separate for unit tests. */
object PiPControls {
    const val SEEK_SECONDS = 10

    enum class Action(val requestCode: Int) { REWIND(1), TOGGLE(2), FORWARD(3) }

    /** Rewind, play/pause, forward; play/pause alone when the system allows fewer than three. */
    fun actionsFor(maxActions: Int): List<Action> = when {
        maxActions >= 3 -> listOf(Action.REWIND, Action.TOGGLE, Action.FORWARD)
        maxActions >= 1 -> listOf(Action.TOGGLE)
        else -> emptyList()
    }

    fun script(action: Action): String = when (action) {
        Action.REWIND -> "window.__seanimePiPCommand&&window.__seanimePiPCommand('seek',-$SEEK_SECONDS)"
        Action.TOGGLE -> "window.__seanimePiPCommand&&window.__seanimePiPCommand('toggle',0)"
        Action.FORWARD -> "window.__seanimePiPCommand&&window.__seanimePiPCommand('seek',$SEEK_SECONDS)"
    }

    fun fromName(name: String?): Action? = Action.entries.firstOrNull { it.name == name }
}
