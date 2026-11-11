import * as Brightness from "expo-brightness"
import * as ScreenOrientation from "expo-screen-orientation"
import { Accelerometer } from "expo-sensors"
import { Dimensions } from "react-native"
import { heldUpright, orientationDegrees } from "./upright"
import { getVolume, setVolume } from "react-native-volume-manager"

/*
 * The Android bits the old player reached through Kotlin bridges, now through libraries (docs/NATIVE-UMBAU.md §5):
 * SeanimeGestures (brightness/volume) → expo-brightness + react-native-volume-manager,
 * OrientationBridge.setVideoFullscreen → expo-screen-orientation.
 */

/** Brightness of this window (0–1); the system value until a swipe changed it. */
export async function readBrightness() {
    try {
        return await Brightness.getBrightnessAsync()
    }
    catch {
        return 0.5
    }
}

export function writeBrightness(value: number) {
    Brightness.setBrightnessAsync(value).catch(() => {})
}

/** Back to the system brightness when the player closes (SeanimeGestures.resetBrightness). */
export function restoreBrightness() {
    Brightness.restoreSystemBrightnessAsync().catch(() => {})
}

/** Media volume (0–1), the same stream the hardware keys change. */
export async function readVolume() {
    try {
        return (await getVolume()).volume
    }
    catch {
        return 0.5
    }
}

export function writeVolume(value: number) {
    setVolume(value, { type: "music", showUI: false, playSound: false }).catch(() => {})
}

/*
 * Fullscreen on a phone turns it sideways; leaving a fullscreen that turned an upright phone holds it upright even while it
 * is still held sideways (as video apps do), until the accelerometer sees the phone upright again (MainActivity
 * setVideoFullscreenOrientation + holdUprightAfterFullscreen). A phone lying flat decides nothing and so stays upright.
 * The hold outlives the player, as in the old app; a new fullscreen ends it. Tablets keep turning freely.
 */
let fullscreenFromPortrait: boolean | null = null
/** the running upright hold (its number, 0 = none) and its accelerometer listener */
let holdRun = 0
let holding = 0
let uprightWatch: { remove: () => void } | null = null

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
    uprightWatch = { remove: () => subscription.remove() }
}

export function setVideoFullscreenOrientation(fullscreen: boolean, isTablet: boolean) {
    if (isTablet) return
    if (fullscreen) {
        stopHoldingUpright()
        if (fullscreenFromPortrait === null) {
            const { width, height } = Dimensions.get("window")
            fullscreenFromPortrait = height > width
        }
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {})
        return
    }
    const fromPortrait = fullscreenFromPortrait
    fullscreenFromPortrait = null
    if (fromPortrait) void holdUprightAfterFullscreen()
    else if (fromPortrait === false) ScreenOrientation.unlockAsync().catch(() => {})
}

/** The player closes: a fullscreen still on ends as if left (upright hold included); a running hold goes on. */
export function endPlayerOrientation() {
    // only a phone's fullscreen sets fullscreenFromPortrait, so this is the phone path; tablets just unlock
    if (fullscreenFromPortrait !== null) setVideoFullscreenOrientation(false, false)
    else if (!holding) ScreenOrientation.unlockAsync().catch(() => {})
}

/** The manga reader's lock ends with it (unchanged). */
export function releaseOrientation() {
    ScreenOrientation.unlockAsync().catch(() => {})
}
