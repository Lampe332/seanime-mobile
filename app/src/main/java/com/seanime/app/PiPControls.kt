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

    /**
     * Picture-in-picture shape (numerator to denominator) of a video. Android rejects ratios beyond 2.39:1 either way,
     * so wider or taller videos get the limit, kept a hair inside it for float rounding; unknown sizes get 16:9.
     */
    fun aspectRatio(width: Int, height: Int): Pair<Int, Int> {
        if (width <= 0 || height <= 0) return 16 to 9
        val ratio = width.toDouble() / height
        return when {
            ratio > MAX_RATIO -> 238 to 100
            ratio < 1 / MAX_RATIO -> 100 to 238
            else -> width to height
        }
    }

    private const val MAX_RATIO = 2.38
}
