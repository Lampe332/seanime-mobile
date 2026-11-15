import { useCurrentUser } from "@/main/_hooks/use-server-status"
import { useMutation } from "@tanstack/react-query"
import { useAtom } from "jotai"
import React from "react"
import { rememberUser } from "./anilist-public"
import { airingNotificationsAtom, checkAiring, postTestAiring, setAiringEnabled, syncAiringTask } from "./airing-notifier"
import * as Notifications from "expo-notifications"
import { chapterNotificationsAtom, checkChaptersInBackground, writeChapterNotifyEnabled } from "@/lib/updates/chapter-check"

/** Settings → App → New episodes (E2 2.12): the switch; turning it on asks for the notification permission. */
export function useAiringNotificationsSetting() {
    const [enabled, setEnabledAtom] = useAtom(airingNotificationsAtom)
    const setEnabled = React.useCallback((value: boolean) => {
        setEnabledAtom(value)
        void setAiringEnabled(value)
    }, [setEnabledAtom])
    return [enabled, setEnabled] as const
}

/** Settings → App → New chapters: the switch; turning it on asks for the notification permission (same job as the episodes) */
export function useChapterNotificationsSetting() {
    const [enabled, setEnabledAtom] = useAtom(chapterNotificationsAtom)
    const setEnabled = React.useCallback((value: boolean) => {
        setEnabledAtom(value)
        writeChapterNotifyEnabled(value)
        void syncAiringTask().catch(() => undefined)
        if (value) void Notifications.requestPermissionsAsync().catch(() => undefined)
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
        // new chapters: at most every few hours, also at start (lib/updates/chapter-check.ts)
        void checkChaptersInBackground().catch(() => undefined)
    }, [name])
}
