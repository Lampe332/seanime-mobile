import { useMobileOfflineLiveSnapshot, useReportNetworkToServer } from "@/api/hooks/mobile_offline.hooks"
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
    return null
}
