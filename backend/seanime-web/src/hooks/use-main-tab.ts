import { websocketAtom } from "@/app/(main)/_atoms/websocket.atoms"
import { logger } from "@/lib/helpers/debug"
import { useAtomValue } from "jotai"
import { useEffect, useRef, useState } from "react"

const log = logger("TAB")
const CHANNEL_NAME = "main-tab-election"
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`

export function useMainTab(): boolean {
    const [isMainTab, setIsMainTab] = useState(false)
    const channelRef = useRef<BroadcastChannel | null>(null)
    const socket = useAtomValue(websocketAtom)

    useEffect(() => {
        const channel = new BroadcastChannel(CHANNEL_NAME)
        channelRef.current = channel

        const claimMainTab = () => {
            if (document.visibilityState === "visible") {
                // Claim via BroadcastChannel for other web tabs
                channel.postMessage({ type: "claim", tabId: TAB_ID })
                log.info("Claimed main tab")
                setIsMainTab(true)

                // Also claim via WebSocket so backend broadcasts to all clients (including Electron)
                if (socket?.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({
                        type: "main-tab-claim",
                        payload: { tabId: TAB_ID, isDesktop: false },
                    }))
                }
            }
        }

        // web tabs -> web tabs
        const handleBroadcastMessage = (event: MessageEvent) => {
            if (event.data.type === "claim" && event.data.tabId !== TAB_ID) {
                // Another tab claimed main, we yield
                setIsMainTab(false)
                log.warn("Yielded")
            }
        }

        const handleWebSocketMessage = (event: MessageEvent) => {
            try {
                // web tabs -> desktop tab || desktop tab -> web tabs
                const data = JSON.parse(event.data) as { type: string; payload?: { tabId: string; isDesktop: boolean } }
                if (
                    data.type === "main-tab-claim"
                    && data.payload?.tabId !== TAB_ID
                    && data.payload?.isDesktop // Yield only if the desktop tab claimed main
                ) {
                    setIsMainTab(false)
                    log.warn("Yielded")
                }
            }
            catch (e) {
                // Ignore parsing errors
            }
        }

        channel.addEventListener("message", handleBroadcastMessage)
        document.addEventListener("visibilitychange", claimMainTab)
        window.addEventListener("focus", claimMainTab)

        if (socket) {
            socket.addEventListener("message", handleWebSocketMessage)
        }

        // Claim on mount if visible
        claimMainTab()

        return () => {
            channel.removeEventListener("message", handleBroadcastMessage)
            document.removeEventListener("visibilitychange", claimMainTab)
            window.removeEventListener("focus", claimMainTab)
            if (socket) {
                socket.removeEventListener("message", handleWebSocketMessage)
            }
            channel.close()
        }
    }, [socket])

    return isMainTab
}
