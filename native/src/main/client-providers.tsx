import { connectAppBuild, connectAppFront } from "@/api/client/core-switch"
import { QUERY_RETRY_DELAY_MS, shouldRetryQuery } from "@/api/client/query-retry"
import { buildSeaQuery } from "@/api/client/requests"
import { useGetStatus } from "@/api/hooks/status.hooks"
import * as Application from "expo-application"
import { Toaster } from "@/components/ui/toast/toaster"
import { serverAuthTokenAtom, serverStatusAtom } from "@/main/_atoms/server-status.atoms"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useSetServerStatus } from "@/main/_hooks/use-server-status"
import { TourOverlay } from "@/main/_features/tour/tour-overlay"
import { WebsocketProvider } from "@/main/websocket-provider"
import { initEntryPreloader } from "@/lib/entry-preloader"
import { pingUsageIfDue } from "@/lib/account/usage-ping-app"
import { logger } from "@/lib/helpers/debug"
import { WSEvents } from "@/lib/server/ws-events"
import { PortalHost } from "@rn-primitives/portal"
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDefaultStore } from "jotai"
import React from "react"
import { AppState } from "react-native"

/*
 * Port of seanime-web app/client-providers.tsx and the data part of app/(main)/server-data-wrapper.tsx: the query
 * client with the web app's defaults, the WebSocket, the server status the whole app reads, the toasts and the portal
 * the sheets and menus render into. The native app started its own Go server here until stage 8a-1; since then it
 * always runs without it (docs/EIGENER-KERN.md §4s).
 * The jotai store is the default store (no Provider), so code outside React (api/client/requests.ts) reaches the same atoms.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            // reads once more after a short pause (api/client/query-retry.ts); mutations stay at 0
            retry: shouldRetryQuery,
            retryDelay: QUERY_RETRY_DELAY_MS,
        },
        mutations: {
            retry: 0,
        },
    },
})

export const store = getDefaultStore()

initEntryPreloader(
    queryClient,
    () => store.get(serverAuthTokenAtom),
    () => !store.get(serverStatusAtom)?.user?.isSimulated,
)

// a new build of the app brings a new server program: the core asks its part of the status once (phase 5a-1)
connectAppBuild(`${Application.nativeApplicationVersion ?? ""}+${Application.nativeBuildVersion ?? ""}`)
// the core's long work does not wait for a timer while the app is not in front: its timers stand still there (4b-C1K)
connectAppFront(() => AppState.currentState === "active")

const USAGE_PING_DELAY_MS = 15_000

/** Loads /api/v1/status (the core's own status) into serverStatusAtom and keeps it fresh (server-data-wrapper.tsx) */
function ServerStatusLoader() {
    const setServerStatus = useSetServerStatus()
    const { data: queryServerStatus, refetch } = useGetStatus()

    React.useEffect(() => {
        if (queryServerStatus) {
            logger("SERVER").info("Status", queryServerStatus.version)
            setServerStatus(queryServerStatus)
        }
    }, [queryServerStatus, setServerStatus])

    useWebsocketMessageListener({
        type: WSEvents.ANILIST_DATA_LOADED,
        onMessage: () => {
            logger("Data Wrapper").info("Anilist data loaded, refetching server status")
            void refetch()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.SETTINGS_CHANGED,
        onMessage: () => {
            logger("Data Wrapper").info("Settings changed, refetching server status")
            void refetch()
        },
    })

    return null
}

export function ClientProviders({ children }: { children: React.ReactNode }) {
    // The browser tells react-query when its tab is in front; React Native does not, so the app counted as "in front"
    // for ever: interval queries (torrent list, download queues, cache-only state) kept asking the server while the
    // app was in the background (the server's foreground service keeps the process alive), and the update check's
    // refetchOnWindowFocus never ran. The app state is that signal.
    React.useEffect(() => {
        const sub = AppState.addEventListener("change", state => {
            focusManager.setFocused(state === "active")
            if (state === "active") {
                void pingUsageIfDue()
                // "Refresh the library automatically": the core looks at the folders at most every 10 minutes and scans
                // only when their files changed (core/library/folders.ts scanWhenBack)
                if (store.get(serverStatusAtom)?.settings?.library?.autoScan) {
                    void buildSeaQuery({ endpoint: "/api/v1/library/auto-scan", method: "POST" }).catch(() => undefined)
                }
            }
        })
        // the anonymous daily count waits until the start is done (usage-ping.ts)
        const firstPing = setTimeout(() => void pingUsageIfDue(), USAGE_PING_DELAY_MS)
        return () => {
            sub.remove()
            clearTimeout(firstPing)
        }
    }, [])
    return (
        <QueryClientProvider client={queryClient}>
            <WebsocketProvider>
                <ServerStatusLoader />
                {children}
                <PortalHost />
                {/* toasts above sheets and dialogs (sonner's z-index): a tablet side sheet covered the top-right toasts,
                    e.g. "Allow all files access" after "Choose folder" */}
                <Toaster />
                {/* the setup tour's layer lies over everything, sheets included */}
                <TourOverlay />
            </WebsocketProvider>
        </QueryClientProvider>
    )
}
