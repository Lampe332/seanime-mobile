/*
 * The player's frame (r21/r22, Nick 11.11.): where the one player shows, how it is left, how fullscreen turns, where the
 * box and the mini player sit. Pure rules, tested in player-chrome.test.ts; player-screen.tsx, player-box.tsx and
 * player-system.ts apply them.
 */

/**
 * r22 (Nick 11.11.): one player in three places, whatever plays (online, library file, torrent, debrid, saved episode).
 * - "full": over the whole window (a phone turns to landscape; a tablet keeps its own orientation, Android 16 ignores
 *   an app's lock there).
 * - "box": in the 16:9 box at the top of the episodes of its own anime page (2.0.x inline player of the online stream page).
 * - "mini": anywhere else, the bar above the navigation (phone) or the card (tablet).
 * `small` is the user's choice (the bottom-right button, Back); `boxShown` whether the page with the box is on screen.
 */
export type PlayerView = "full" | "box" | "mini"

export function playerView(small: boolean, boxShown: boolean): PlayerView {
    if (!small) return "full"
    return boxShown ? "box" : "mini"
}

/** Which box holds a playback: the online stream page's own stream, or any other stream of an anime on its page. */
export function boxOwner(online: boolean, mediaId: number | undefined): string | null {
    if (online) return "online"
    return mediaId ? `media:${mediaId}` : null
}

/** What the orientation lock becomes for a fullscreen target: a phone leaves upright and is held there until it is upright in the hand (MainActivity.holdUprightAfterFullscreen), a tablet stays upright while the player is open. */
export type OrientationTarget = "landscape" | "portrait-hold" | "portrait"

export function orientationTarget(fullscreen: boolean, isTablet: boolean): OrientationTarget {
    if (fullscreen) return "landscape"
    return isTablet ? "portrait" : "portrait-hold"
}

/**
 * The turn that goes with a view: a phone turns to landscape for "full" and upright for the box or the mini player.
 * A tablet is never turned (Android 16 ignores the lock on screens from 600dp, r21; the player fills the window as it is).
 */
export function viewTurn(view: PlayerView, isTablet: boolean): "landscape" | "upright" | "none" {
    if (isTablet) return "none"
    return view === "full" ? "landscape" : "upright"
}

/** What Android Back does in the player. */
export type BackStep = "pass" | "shrink"

/**
 * r22: Back in the full player makes it small (box on its page, else mini) and it plays on, like the bottom-right button;
 * an open menu or sheet answers Back itself; in the box or the mini player Back belongs to the page (leaving the anime
 * page turns the box into the mini player). The player is closed only by the mini player's × (or its error's Close).
 */
export function backStep(s: { overlayOpen: boolean, view: PlayerView }): BackStep {
    if (s.overlayOpen || s.view !== "full") return "pass"
    return "shrink"
}

/** The box's place: the page's scroll area in window coordinates, the box in the scroll content. */
export type BoxGeometry = {
    viewport: { x: number, y: number, width: number, height: number }
    content: { x: number, y: number, width: number, height: number }
    /** the status bar's height: the box is never drawn under it (it scrolls away like the page under a clip) */
    topInset: number
}

/**
 * Where the box is for a scroll offset: `clip` is the visible part of the page's scroll area (the box never paints over the
 * status bar, the rail or past the page), `box` the player's frame inside the clip. Runs on the UI thread per frame.
 */
export function boxFrame(g: BoxGeometry, scrollY: number) {
    "worklet"
    const clipTop = Math.max(g.viewport.y, g.topInset)
    const clipBottom = g.viewport.y + g.viewport.height
    return {
        clip: { left: g.viewport.x, top: clipTop, width: g.viewport.width, height: Math.max(0, clipBottom - clipTop) },
        box: { left: g.content.x, top: g.viewport.y + g.content.y - scrollY - clipTop, width: g.content.width, height: g.content.height },
    }
}

/** Whether any of the box is visible at this scroll offset (fully scrolled away: the bars need not be drawn). */
export function boxVisible(g: BoxGeometry, scrollY: number) {
    const { clip, box } = boxFrame(g, scrollY)
    return box.top + box.height > 0 && box.top < clip.height
}

/**
 * A vertical drag on the box scrolls the page (the box floats above it, so the page cannot see the finger): the drag
 * counts once it went 10dp more up/down than sideways. Then `scrollTarget` is where the page goes.
 */
export function isScrollDrag(dx: number, dy: number) {
    return Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)
}

export function scrollTarget(startScroll: number, dragged: number, maxScroll: number) {
    return Math.max(0, Math.min(maxScroll, startScroll - dragged))
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
