/*
 * The player's frame (r21, Nick 11.11.): how it is left, how fullscreen turns, where the mini player sits. Pure rules,
 * tested in player-chrome.test.ts; player-screen.tsx and player-system.ts apply them.
 */

/**
 * Fullscreen is the landscape picture. The window is always free of system bars (lib/system-bars), so turning is the only
 * thing fullscreen changes: a window that is already landscape (a tablet, a phone turned by its own rotation) counts as
 * fullscreen, and the button then turns it upright. 2.0.x locked an already landscape window to landscape, so the button
 * seemed to do nothing there.
 */
export function isFullscreenWindow(width: number, height: number) {
    return width > height
}

/**
 * Whether the app may turn the screen at all. Android 16 (API 36) ignores orientation requests of apps targeting 36 on
 * screens with a smallest width of 600dp or more (r21 tablet: `ignoreOrientationRequest=true`, 2.0.33 targets 36 too, so
 * its button did nothing there either). On such a screen the player always fills it, and the fullscreen button is left out.
 */
export function canTurnScreen(androidApi: number, width: number, height: number) {
    return !(androidApi >= 36 && Math.min(width, height) >= 600)
}

/** What the orientation lock becomes for a fullscreen target: a phone leaves upright and is held there until it is upright in the hand (MainActivity.holdUprightAfterFullscreen), a tablet stays upright while the player is open. */
export type OrientationTarget = "landscape" | "portrait-hold" | "portrait"

export function orientationTarget(fullscreen: boolean, isTablet: boolean): OrientationTarget {
    if (fullscreen) return "landscape"
    return isTablet ? "portrait" : "portrait-hold"
}

/** What Android Back does in the player. */
export type BackStep = "pass" | "exit-fullscreen" | "close"

/**
 * 2.0.x (video-core.tsx onHistoryPop, since 1.9.38): Back closes the player; in fullscreen it first leaves fullscreen
 * (backExit). An open menu or sheet answers Back itself, the mini player leaves Back to the page under it.
 * `turnedByApp`: the app turned the window to landscape (a tablet's own landscape is not left by Back, it closes).
 */
export function backStep(s: { overlayOpen: boolean, mini: boolean, fullscreen: boolean, isTablet: boolean, turnedByApp: boolean }): BackStep {
    if (s.overlayOpen || s.mini) return "pass"
    if (s.fullscreen && (!s.isTablet || s.turnedByApp)) return "exit-fullscreen"
    return "close"
}

/** The mini player's button acts on what it shows (play or pause), never a blind toggle against a state it did not show. */
export function miniPlayCommand(playing: boolean): "play" | "pause" {
    return playing ? "pause" : "play"
}

export const MINI_BAR = { height: 64, pad: 6, margin: 8, maxWidth: 480 } as const
export const MINI_CARD = { width: 320, pad: 6, edge: 20, rowHeight: 52 } as const

export type MiniFrame =
    | { kind: "bar", right: number, bottom: number, width: number, height: number, video: { width: number, height: number } }
    | { kind: "card", right: number, bottom: number, width: number, height: number, video: { width: number, height: number } }

/**
 * Phone: a bar docked above the navigation bar (video, titles, play/pause, close), as wide as the screen up to 480dp at
 * the right edge. Tablet with the rail: 2.0.33's floating card at 20dp from the right and bottom edges
 * (media-core-drawer.tsx), now 320dp with a row of titles and buttons under the video.
 */
export function miniFrame(s: { width: number, rail: boolean, navBar: number, insets: { bottom: number, left: number, right: number } }): MiniFrame {
    if (s.rail) {
        const videoWidth = MINI_CARD.width - MINI_CARD.pad * 2
        const videoHeight = Math.round(videoWidth * 9 / 16)
        return {
            kind: "card", right: s.insets.right + MINI_CARD.edge, bottom: s.insets.bottom + MINI_CARD.edge, width: MINI_CARD.width,
            height: MINI_CARD.pad + videoHeight + MINI_CARD.rowHeight, video: { width: videoWidth, height: videoHeight },
        }
    }
    const room = s.width - s.insets.left - s.insets.right - MINI_BAR.margin * 2
    const videoHeight = MINI_BAR.height - MINI_BAR.pad * 2
    return {
        kind: "bar", right: s.insets.right + MINI_BAR.margin, bottom: s.insets.bottom + s.navBar + MINI_BAR.margin,
        width: Math.max(0, Math.min(MINI_BAR.maxWidth, room)), height: MINI_BAR.height,
        video: { width: Math.round(videoHeight * 16 / 9), height: videoHeight },
    }
}

/**
 * What a loaded file does first. mpv keeps its pause flag across files, so an episode picked while the last one was paused
 * loaded paused (r21 test); with "Auto play" a new episode starts (old `<video autoplay>`) unless a pause came in while it
 * loaded (`playOnLoad` false); without it the file waits paused (2.0.x "Auto play" off).
 */
export function loadStart(autoPlay: boolean, playOnLoad: boolean): "pause" | "play" | "keep" {
    if (!autoPlay) return "pause"
    return playOnLoad ? "play" : "keep"
}

/** 0…1 along the mini player's progress line. */
export function progressFraction(position: number, duration: number) {
    if (!(duration > 0) || !Number.isFinite(position)) return 0
    return Math.max(0, Math.min(1, position / duration))
}
