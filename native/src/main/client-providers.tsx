import { useGetStatus } from "@/api/hooks/status.hooks"
import { Toaster } from "@/components/ui/toast/toaster"
import { serverAuthTokenAtom, serverStatusAtom } from "@/main/_atoms/server-status.atoms"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useServerStatus, useSetServerStatus } from "@/main/_hooks/use-server-status"
import { TourOverlay } from "@/main/_features/tour/tour-overlay"
import { WebsocketProvider } from "@/main/websocket-provider"
import { appLanguageAtom } from "@/lib/app-language"
import { initEntryPreloader } from "@/lib/entry-preloader"
import { logger } from "@/lib/helpers/debug"
import { serverNeedsStart } from "@/lib/server/server-restart"
import { WSEvents } from "@/lib/server/ws-events"
import { PortalHost } from "@rn-primitives/portal"
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { atom, getDefaultStore, useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { AppState } from "react-native"
import SeanimeServer, { type ServerStatus } from "../../modules/seanime-server"

/*
 * Port of seanime-web app/client-providers.tsx and the data part of app/(main)/server-data-wrapper.tsx: the query
 * client with the web app's defaults, the WebSocket, the server status the whole app reads, the toasts and the portal
 * the sheets and menus render into. The native app also starts its own Go server here (SeanimeServer module).
 * The jotai store is the default store (no Provider), so code outside React (api/client/requests.ts) reaches the same atoms.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
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

/** State of the app's own Go server process (modules/seanime-server) */
export const nativeServerAtom = atom<ServerStatus>(SeanimeServer.getStatus())

function NativeServer() {
    const setStatus = useSetAtom(nativeServerAtom)
    const language = useAtomValue(appLanguageAtom)
    React.useEffect(() => {
        const sub = SeanimeServer.addListener("onStatusChange", setStatus)
        setStatus(SeanimeServer.getStatus())
        SeanimeServer.start()
        // back in front with the server gone (Exit in the notification, a crash, another tablet user took the port)
        const foreground = AppState.addEventListener("change", state => {
            if (state === "active" && serverNeedsStart(SeanimeServer.getStatus().state)) SeanimeServer.start()
        })
        return () => {
            sub.remove()
            foreground.remove()
        }
    }, [setStatus])
    // The service notification uses the same language as the app (AppLanguage.kt read it from the shared prefs)
    React.useEffect(() => {
        SeanimeServer.setLanguage(language)
    }, [language])
    return null
}

/** Loads /api/v1/status into serverStatusAtom and keeps it fresh (server-data-wrapper.tsx) */
function ServerStatusLoader() {
    const serverStatus = useServerStatus()
    const setServerStatus = useSetServerStatus()
    const { data: queryServerStatus, refetch } = useGetStatus()
    const resolvedServerStatus = serverStatus ?? queryServerStatus

    React.useEffect(() => {
        if (queryServerStatus) {
            logger("SERVER").info("Server status", queryServerStatus.version)
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

    // Polls while the server starts, in case the websocket misses the ready event
    React.useEffect(() => {
        if (resolvedServerStatus?.serverReady) return
        const interval = setInterval(() => {
            void refetch()
        }, 2000)
        return () => clearInterval(interval)
    }, [resolvedServerStatus?.serverReady, refetch])

    return null
}

export function ClientProviders({ children }: { children: React.ReactNode }) {
    // The browser tells react-query when its tab is in front; React Native does not, so the app counted as "in front"
    // for ever: interval queries (torrent list, download queues, cache-only state) kept asking the server while the
    // app was in the background (the server's foreground service keeps the process alive), and the update check's
    // refetchOnWindowFocus never ran. The app state is that signal.
    React.useEffect(() => {
        const sub = AppState.addEventListener("change", state => focusManager.setFocused(state === "active"))
        return () => sub.remove()
    }, [])
    return (
        <QueryClientProvider client={queryClient}>
            <NativeServer />
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
