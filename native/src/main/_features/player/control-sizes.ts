/**
 * The player bars' sizes by the player's width (media-core-controls.css `--vc-*`). From 1000dp (a tablet, the player fills
 * the screen) they are 2.0.33's tablet values: 48dp buttons, 24dp icons, an 88dp play button, 68dp seek buttons 64dp apart,
 * 1.5rem sides, .875rem over the top row and .5rem + at least 1.25rem under the time bar, 15dp time text, a 5px track with
 * a 16dp thumb. From 560dp (phone landscape) the CSS's middle tier: .875rem sides, .625rem over the top row, .375rem
 * under the time bar, 14dp time text, a 4px track with a 14dp thumb. Below that the portrait values (3px, 12dp).
 */
export type ControlSizes = {
    button: number
    icon: number
    play: number
    playIcon: number
    seek: number
    centerGap: number
    padX: number
    padTop: number
    /** under the bottom bar, before the system inset rule (`bottomPad`) */
    padBottom: number
    timeText: number
    titleText: number
    /** `--vc-track`: height of the time bar's visible track */
    track: number
    /** `--vc-thumb`: the time bar's thumb (1.35× while scrubbing) */
    thumb: number
}

export const TABLET_CONTROLS_MIN_WIDTH = 1000

export function controlSizes(width: number): ControlSizes {
    if (width >= TABLET_CONTROLS_MIN_WIDTH) {
        return { button: 48, icon: 24, play: 88, playIcon: 38, seek: 68, centerGap: 64, padX: 24, padTop: 14, padBottom: 8, timeText: 15, titleText: 15, track: 5, thumb: 16 }
    }
    const wide = width >= 560
    return {
        button: 44,
        icon: wide ? 22 : 20,
        play: wide ? 76 : 60,
        playIcon: wide ? 34 : 27,
        seek: wide ? 60 : 48,
        centerGap: wide ? 40 : 20,
        padX: wide ? 14 : 6,
        padTop: wide ? 10 : 4,
        padBottom: wide ? 6 : 2,
        timeText: wide ? 14 : 12,
        // the title shows from 560dp only (`.vc-title`), at `--vc-text` + 1
        titleText: 14,
        track: wide ? 4 : 3,
        thumb: wide ? 14 : 12,
    }
}

/**
 * Room under the bottom bar (`.vc-bar--bottom`: `--vc-pad-b + --vc-pad-safe-b`). Where the player fills the screen
 * (`[data-vc-inline="false"]` or fullscreen; a tablet always) the safe part is `max(1.25rem, safe-area-inset-bottom)`:
 * 2 + 20 = 22dp upright, 6 + 20 = 26dp from 560dp, 8 + 20 on a tablet – the old WebView reported no inset, so 1.25rem.
 * Otherwise the system inset.
 */
export function bottomPad(width: number, fillsScreen: boolean, insetBottom: number) {
    const sizes = controlSizes(width)
    if (fillsScreen || width >= TABLET_CONTROLS_MIN_WIDTH) return sizes.padBottom + Math.max(20, insetBottom)
    return insetBottom + sizes.padBottom
}

/**
 * Room over the top bar (`.vc-bar--top`: `--vc-pad-t + --vc-pad-safe-t`). Filling the screen the safe part is
 * `env(safe-area-inset-top)`, which the old WebView reported as 0 (the status bar is hidden, the cutout sits at a side
 * in landscape): just `--vc-pad-t`. Otherwise under the system inset.
 */
export function topPad(width: number, fillsScreen: boolean, insetTop: number) {
    return (fillsScreen ? 0 : insetTop) + controlSizes(width).padTop
}
