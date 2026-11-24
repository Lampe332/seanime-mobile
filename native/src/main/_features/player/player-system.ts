import * as ScreenOrientation from "expo-screen-orientation"
import { Accelerometer } from "expo-sensors"
import { Dimensions } from "react-native"
import { heldUpright, orientationDegrees } from "./upright"
import { orientationTarget } from "./player-chrome"

/*
 * The Android bits the old player reached through Kotlin bridges, now through libraries (docs/NATIVE-UMBAU.md §5):
 * OrientationBridge.setVideoFullscreen → expo-screen-orientation.
 */

/*
 * Fullscreen turns the screen sideways (MainActivity.setVideoFullscreenOrientation: SENSOR_LANDSCAPE, phones and tablets).
 * Leaving it turns it upright (r21, player-chrome.ts orientationTarget): a phone is held upright even while it is still
 * held sideways (as video apps do), until the accelerometer sees it upright again (holdUprightAfterFullscreen); a phone
 * lying flat decides nothing and so stays upright. The hold outlives the player, as in the old app; a new fullscreen ends
 * it. A tablet stays upright until the player closes.
 */
/** the app's own lock: landscape (fullscreen) on either device, portrait on a tablet that left fullscreen */
let appLock: "landscape" | "portrait" | null = null
/** the running upright hold (its number, 0 = none) and its accelerometer listener */
let holdRun = 0
let holding = 0
let uprightWatch: { remove: () => void } | null = null
/** The hold listens this long at most (5 reads a second, endless on a phone lying flat), then the screen turns freely. */
export const UPRIGHT_HOLD_MAX_MS = 10_000

function stopHoldingUpright() {
    holding = 0
    uprightWatch?.remove()
    uprightWatch = null
}

async function holdUprightAfterFullscreen() {
    stopHoldingUpright()
    const run = ++holdRun
    holding = run
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {})
    const available = await Accelerometer.isAvailableAsync().catch(() => false)
    if (holding !== run) return // a new fullscreen took over meanwhile
    if (!available) { // no sensor: the previous (free) orientation at once, as the old app did
        stopHoldingUpright()
        ScreenOrientation.unlockAsync().catch(() => {})
        return
    }
    Accelerometer.setUpdateInterval(200)
    const subscription = Accelerometer.addListener(({ x, y, z }) => {
        if (holding !== run || !heldUpright(orientationDegrees(x, y, z))) return
        stopHoldingUpright()
        ScreenOrientation.unlockAsync().catch(() => {})
    })
    const limit = setTimeout(() => {
        if (holding !== run) return
        stopHoldingUpright()
        ScreenOrientation.unlockAsync().catch(() => {})
    }, UPRIGHT_HOLD_MAX_MS)
    uprightWatch = { remove: () => { subscription.remove(); clearTimeout(limit) } }
}

export function setVideoFullscreenOrientation(fullscreen: boolean, isTablet: boolean) {
    switch (orientationTarget(fullscreen, isTablet)) {
        case "landscape":
            stopHoldingUpright()
            appLock = "landscape"
            ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {})
            break
        case "portrait":
            appLock = "portrait"
            ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT).catch(() => {})
            break
        case "portrait-hold":
            appLock = null
            void holdUprightAfterFullscreen()
            break
    }
}

/** Whether the app turned the screen to landscape (Back leaves that fullscreen first, also on a tablet). */
export function turnedToLandscape() {
    return appLock === "landscape"
}

/** The player closes: a phone in the app's landscape leaves it as if the button was pressed (upright hold included), a running hold goes on, a tablet turns freely again. */
export function endPlayerOrientation() {
    const { width, height } = Dimensions.get("window")
    const phone = Math.min(width, height) < 600
    if (phone && appLock === "landscape") {
        setVideoFullscreenOrientation(false, false)
        return
    }
    appLock = null
    if (!holding) ScreenOrientation.unlockAsync().catch(() => {})
}

/** The manga reader's lock ends with it (unchanged). */
export function releaseOrientation() {
    ScreenOrientation.unlockAsync().catch(() => {})
}
