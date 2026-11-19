// geschrieben nach: Plan „Account + Sync“ (Abschnitt 6.5 Takt) und lib/account/sync-clock.ts; Muster wie anilist-sync.tsx (AppState)

import { onAccountDataChange, refreshAccount, startAccountClock } from "@/lib/account/account-app"
import type { AppStateName, SyncClock } from "@/lib/account/sync-clock"
import { useQueryClient } from "@tanstack/react-query"
import { atom, getDefaultStore } from "jotai"
import React from "react"
import { AppState } from "react-native"

/** The secured storage threw while the account was read; the account screen offers "Try again" instead of "Loading…" */
export const accountLoadFailedAtom = atom(false)

/** Reads the account from the secured storage; a failure is kept in accountLoadFailedAtom, never thrown */
export async function retryAccountLoad(): Promise<void> {
    const store = getDefaultStore()
    try {
        await refreshAccount()
        store.set(accountLoadFailedAtom, false)
    }
    catch {
        store.set(accountLoadFailedAtom, true)
    }
}

/** The account's sync clock for the whole app run (AppServices). Signed out it only reads the secured storage once. */
export function useAccountService() {
    const queryClient = useQueryClient()
    React.useEffect(() => {
        // the account's newer data replaced or merged the local one: every screen reads again
        onAccountDataChange(() => void queryClient.invalidateQueries())
        let clock: SyncClock | null = null
        let alive = true
        const every = (ms: number, run: () => void) => {
            const id = setInterval(run, ms)
            return () => clearInterval(id)
        }
        void retryAccountLoad().finally(() => {
            if (alive) clock = startAccountClock(AppState.currentState as AppStateName, every)
        })
        const sub = AppState.addEventListener("change", state => clock?.appState(state as AppStateName))
        return () => {
            alive = false
            sub.remove()
            clock?.stop()
        }
    }, [queryClient])
}
