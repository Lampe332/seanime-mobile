import * as Brightness from "expo-brightness"
import * as ScreenOrientation from "expo-screen-orientation"
import { Accelerometer } from "expo-sensors"
import { Dimensions } from "react-native"
import { heldUpright, orientationDegrees } from "./upright"
import { orientationTarget } from "./player-chrome"
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
