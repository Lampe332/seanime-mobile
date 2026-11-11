import { useCurrentUser } from "@/main/_hooks/use-server-status"
import { useMutation } from "@tanstack/react-query"
import { useAtom } from "jotai"
import React from "react"
import { rememberUser } from "./anilist-public"
import { airingNotificationsAtom, checkAiring, postTestAiring, setAiringEnabled, syncAiringTask } from "./airing-notifier"

/** Settings → App → New episodes (E2 2.12): the switch; turning it on asks for the notification permission. */
export function useAiringNotificationsSetting() {
    const [enabled, setEnabledAtom] = useAtom(airingNotificationsAtom)
    const setEnabled = React.useCallback((value: boolean) => {
        setEnabledAtom(value)
        void setAiringEnabled(value)
    }, [setEnabledAtom])
    return [enabled, setEnabled] as const
}

/** "Send a test notification": resolves "ok" or "permission" (Android does not allow notifications). */
export function useTestAiringNotification() {
    return useMutation({ mutationFn: postTestAiring })
}

/**
 * At the app root: once the server reports the AniList user, remember it (the widget and background checks read the
 * public list with it) and plan the announcements; again when the user changes.
 */
export function useAiringScheduler() {
    const user = useCurrentUser()
    const name = user && !user.isSimulated ? user.viewer?.name : undefined
    React.useEffect(() => {
        void syncAiringTask().catch(() => undefined)
    }, [])
    React.useEffect(() => {
        if (!name) return
        rememberUser(name)
        void checkAiring({ force: true }).catch(() => undefined)
    }, [name])
}
