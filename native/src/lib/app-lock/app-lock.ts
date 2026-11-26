import recents from "../../../modules/app-lock-recents"
import { appLockHidesRecents, appLockReducer, initialAppLockState, type AppLockEvent } from "@/lib/app-lock/app-lock-rule"
import { onDeviceLockPrompt } from "@/lib/device-lock"
import { atomWithStorage } from "@/lib/storage"
import { getDefaultStore } from "jotai"
import { useSyncExternalStore } from "react"
import { AppState } from "react-native"

/*
 * The app lock (settings → App → App lock): the switch, whether the app is locked now and what feeds the rule
 * (app-lock-rule.ts). The switch belongs to this device: it never leaves it, neither in a backup nor in the account's
 * sync (app-backup-keys.ts DEVICE_KEYS). The cover itself is main/_features/app-lock/app-lock-screen.tsx.
 */
const APP_LOCK_KEY = "seanime-mobile-app-lock"
export const appLockEnabledAtom = atomWithStorage<boolean>(APP_LOCK_KEY, false)

const store = getDefaultStore()
const isEnabled = () => store.get(appLockEnabledAtom) === true
const isActive = () => AppState.currentState === "active"

let state = initialAppLockState(isEnabled())
const listeners = new Set<() => void>()

// Android: recents shows no picture of the app while the switch is on (modules/app-lock-recents; missing elsewhere)
let recentsHidden: boolean | null = null
function syncRecents() {
    const hidden = appLockHidesRecents(isEnabled(), state.locked)
    if (!recents || hidden === recentsHidden) return
    recentsHidden = hidden
    recents.setRecentsHidden(hidden).catch(() => { recentsHidden = null })
}

function dispatch(event: AppLockEvent) {
    const next = appLockReducer(state, event)
    const changed = next.locked !== state.locked
    state = next
    if (changed) {
        syncRecents()
        listeners.forEach(listener => listener())
    }
}

syncRecents()
store.sub(appLockEnabledAtom, syncRecents)

// "inactive" (iOS: control centre, the Face ID sheet) is not leaving the app
AppState.addEventListener("change", next => {
    if (next === "background") dispatch({ type: "hidden", now: Date.now() })
    else if (next === "active") dispatch({ type: "shown", now: Date.now(), enabled: isEnabled() })
})
onDeviceLockPrompt(open => dispatch({ type: "prompt", open, now: Date.now(), appActive: isActive() }))

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => void listeners.delete(listener)
}

const lockedSnapshot = () => state.locked

/** Whether the cover is up; the store's snapshot, so React Compiler does not keep an old value */
export function useAppLocked(): boolean {
    return useSyncExternalStore(subscribe, lockedSnapshot)
}

export function unlockApp() {
    dispatch({ type: "unlock" })
}

/** The switch, after the device lock confirmed it; turning it on does not lock at once (the user just unlocked) */
export function setAppLockEnabled(enabled: boolean) {
    store.set(appLockEnabledAtom, enabled)
    if (!enabled) unlockApp()
}

/** The player's picture in picture (player-screen.tsx): while its video plays the app counts as in use */
export function setAppLockPictureInPicture(active: boolean) {
    if (active === state.pictureInPicture) return
    dispatch({ type: "pictureInPicture", active, now: Date.now(), appActive: isActive() })
}
