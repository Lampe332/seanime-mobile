import type { MobileOffline_Snapshot } from "@/api/generated/types"
import { useGetMobileOfflineSnapshot } from "@/api/hooks/mobile_offline.hooks"
import { offlineFailureText } from "@/api/hooks/mobile_offline.helpers"
import { tr } from "@/lib/app-language"
import { shortcutLink } from "@/lib/app-links"
import * as Notifications from "expo-notifications"
import { AndroidImportance } from "expo-notifications"
import React from "react"
import { Platform } from "react-native"
import { DOWNLOAD_NOTICE_KIND } from "./notice-behavior"
import { noticeName, type OfflineNotice, offlineNotices } from "./offline-library"

/*
 * Download notices (EpisodeDownloads.kt notifyResult / updateWaitingNotice): "Download finished", "Download failed" with
 * the reason, and "Waiting for Wi-Fi" while queued episodes wait on mobile data (removed once they run). They follow the
 * server's "mobile-offline-updated" snapshots while the app runs. Tapping one opens Downloads (app-links-handler).
 * Quiet channel like the old one (IMPORTANCE_LOW, named in the app language); posted only with the permission, which
 * the app asks for when episodes are queued (episode-download-sheet.tsx).
 */

const CHANNEL = "episode-downloads"
const KIND = DOWNLOAD_NOTICE_KIND
const WAITING_ID = "episode-download-waiting"

async function ensureChannel() {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: tr("Episode downloads", "Folgen-Downloads"),
        importance: AndroidImportance.LOW,
    })
}

async function canPost() {
    if (Platform.OS !== "android") return false
    return (await Notifications.getPermissionsAsync()).granted
}

/** Asks for the notification permission once it is still open (Android 13+), when downloads are queued. */
export async function askForDownloadNotices() {
    if (Platform.OS !== "android") return
    const current = await Notifications.getPermissionsAsync()
    if (!current.granted && current.canAskAgain) await Notifications.requestPermissionsAsync()
}

function content(title: string, body: string): Notifications.NotificationContentInput {
    return { title, body, data: { kind: KIND, url: shortcutLink("/android-downloads") }, autoDismiss: true }
}

async function post(notice: OfflineNotice) {
    switch (notice.kind) {
        case "finished":
            await Notifications.scheduleNotificationAsync({
                identifier: `episode-download-${notice.item.id}`,
                content: content(tr("Download finished", "Download fertig"), noticeName(notice.item, tr)),
                trigger: { channelId: CHANNEL },
            })
            break
        case "failed":
            await Notifications.scheduleNotificationAsync({
                identifier: `episode-download-${notice.item.id}`,
                content: content(tr("Download failed", "Download fehlgeschlagen"), `${noticeName(notice.item, tr)}\n${offlineFailureText(notice.item.failure, tr)}`),
                trigger: { channelId: CHANNEL },
            })
            break
        case "waiting-wifi":
            await Notifications.scheduleNotificationAsync({
                identifier: WAITING_ID,
                content: content(tr("Waiting for Wi-Fi", "Wartet auf WLAN"), tr("Episode downloads continue on Wi-Fi.", "Die Folgen werden im WLAN weiter heruntergeladen.")),
                trigger: { channelId: CHANNEL },
            })
            break
        case "waiting-wifi-over":
            await Notifications.dismissNotificationAsync(WAITING_ID)
            break
    }
}

/** At the app root while the server runs: compares each snapshot with the one before and posts what changed. */
export function useDownloadNotifications() {
    const { data } = useGetMobileOfflineSnapshot()
    const previous = React.useRef<MobileOffline_Snapshot | undefined>(undefined)
    React.useEffect(() => {
        if (!data) return
        const notices = offlineNotices(previous.current, data)
        previous.current = data
        if (!notices.length || Platform.OS !== "android") return
        void (async () => {
            if (!(await canPost())) return
            // while the app is open they go to the list without a banner (index.ts, notice-behavior.ts)
            await ensureChannel()
            for (const notice of notices) await post(notice)
        })().catch(() => undefined)
    }, [data])
}
