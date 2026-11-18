import { useMobileOfflineLiveSnapshot, useReportNetworkToServer } from "@/api/hooks/mobile_offline.hooks"
import { useAccountService } from "@/main/_features/account/account-service"
import { useAnilistSyncService } from "@/main/_features/anilist-sync/anilist-sync"
import { useAiringScheduler } from "@/lib/airing/airing-hooks"
import { appLanguageAtom } from "@/lib/app-language"
import { useAppLinkSources } from "@/lib/app-links-handler"
import { reconcileAppUpdate } from "@/lib/app-updates/app-updater"
import { useCastEventsBridge } from "@/lib/cast/use-cast"
import { refreshUpcomingWidget } from "@/lib/widget/widget-task"
import { useCurrentUser, useServerStatus } from "@/main/_hooks/use-server-status"
import { useDownloadNotifications } from "@/main/android-downloads/_lib/download-notifications"
import { useAtomValue } from "jotai"
import React from "react"
import { Platform } from "react-native"

/**
 * The app's lasting services, mounted once at the root (the old MainActivity's onCreate work): links from outside,
 * new-episode notifications, the widget, the cast bridge, the update transaction, and the downloads' network report,
 * live snapshot and notices. No UI.
 */
export function AppServices() {
    const language = useAtomValue(appLanguageAtom)
    const serverStatus = useServerStatus()
    const user = useCurrentUser()
    const userName = user && !user.isSimulated ? user.viewer?.name : undefined

    useAppLinkSources(language)
    useAiringScheduler()
    useCastEventsBridge()
    useMobileOfflineLiveSnapshot()
    // changes made without AniList go out at the start, when the network is back and when the app comes to the front
    useAnilistSyncService()
    // the account's sync (only with an account): start, every 5 minutes in front, on leaving
    useAccountService()

    React.useEffect(() => {
        reconcileAppUpdate()
    }, [])

    // the widget learns the user and the language from the app; it fetches only when its list is outdated
    React.useEffect(() => {
        if (Platform.OS !== "android") return
        void refreshUpcomingWidget().catch(() => undefined)
    }, [userName, language])

    // the server must be up to take the report; a server restart starts with an unknown network again
    return serverStatus ? <NetworkReporter /> : null
}

function NetworkReporter() {
    useReportNetworkToServer()
    // download notices follow the server's snapshots (finished, failed, waiting for Wi-Fi)
    useDownloadNotifications()
    // "Download next episodes automatically" looks once after the start, when the network report is in and the first screen is up
    React.useEffect(() => {
        const timer = setTimeout(() => void import("@/api/client/core-prefetch").then(module => module.requestPrefetch()).catch(() => undefined), START_PREFETCH_MS)
        return () => clearTimeout(timer)
    }, [])
    return null
}

const START_PREFETCH_MS = 15_000
