// geschrieben nach: eigenem Entwurf – Vorschau des Erststarts für die test- und scratch-App (Link `…://dev/intro`)
import React from "react"

/*
 * Shows the first start again over the running app, without touching account or settings: the start button and the
 * AniList sheet only walk through their steps. Only app-links.ts opens it, and only in the test and scratch builds.
 */
let shown = false
const listeners = new Set<() => void>()

export function showIntroPreview(next: boolean) {
    shown = next
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function useIntroPreview(): boolean {
    return React.useSyncExternalStore(subscribe, () => shown)
}
