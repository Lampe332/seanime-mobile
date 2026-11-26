import * as LocalAuthentication from "expo-local-authentication"
import React from "react"
import { AppState } from "react-native"

/*
 * The device's own lock (fingerprint, face, screen PIN/pattern) through expo-local-authentication: the account's approval
 * prompt (account-prompts.tsx) and the app lock (lib/app-lock) ask it here. While a prompt is open Android may send the
 * app to "background" (the screen PIN is an activity of its own); the app lock listens to `onDeviceLockPrompt` so that
 * this trip does not count as leaving the app.
 */

type PromptListener = (open: boolean) => void
const promptListeners = new Set<PromptListener>()

export function onDeviceLockPrompt(listener: PromptListener): () => void {
    promptListeners.add(listener)
    return () => void promptListeners.delete(listener)
}

type LockListener = (has: boolean) => void
const lockListeners = new Set<LockListener>()

/** Every fresh answer of hasDeviceLock (a prompt asks too), so a screen showing it does not keep an old one */
export function onDeviceLockChecked(listener: LockListener): () => void {
    lockListeners.add(listener)
    return () => void lockListeners.delete(listener)
}

/** Whether the device has a screen lock or biometrics set up */
export async function hasDeviceLock(): Promise<boolean> {
    const level = await LocalAuthentication.getEnrolledLevelAsync()
    const has = level !== LocalAuthentication.SecurityLevel.NONE
    lockListeners.forEach(listener => listener(has))
    return has
}

/** Screen lock or fingerprint, when the device has one set up; true without one (nobody is locked out by a removed lock) */
export async function confirmWithDeviceLock(prompt: string): Promise<boolean> {
    if (!(await hasDeviceLock())) return true
    promptListeners.forEach(listener => listener(true))
    try {
        const result = await LocalAuthentication.authenticateAsync({ promptMessage: prompt })
        return result.success
    }
    catch {
        return false
    }
    finally {
        promptListeners.forEach(listener => listener(false))
    }
}

/**
 * hasDeviceLock for a screen, asked again whenever the app comes back (the lock may have been set up or removed in the
 * meantime) or a prompt asks it (pressing the switch)
 */
export function useHasDeviceLock(): boolean | undefined {
    const [has, setHas] = React.useState<boolean | undefined>(undefined)
    React.useEffect(() => {
        let live = true
        const check = () => void hasDeviceLock().catch(() => { if (live) setHas(false) })
        const off = onDeviceLockChecked(value => { if (live) setHas(value) })
        check()
        const sub = AppState.addEventListener("change", state => { if (state === "active") check() })
        return () => {
            live = false
            off()
            sub.remove()
        }
    }, [])
    return has
}
