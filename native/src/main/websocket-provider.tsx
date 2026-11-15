import { websocketAtom, WebSocketContext } from "@/main/_atoms/websocket.atoms"
import { getClientIdentity, subscribeToClientIdentity } from "@/lib/server/client-id"
import { atom, useAtomValue, useSetAtom } from "jotai"
import React, { useRef } from "react"

/*
 * Port of seanime-web app/websocket-provider.tsx. Until stage 8a-1 it held one WebSocket to the app's own server
 * (/events); the server is no longer in the app (docs/EIGENER-KERN.md §4s), so stage 8a-2 removed the socket. The core's
 * events reach the same listeners through its distributor (src/lib/server/server-events.ts). What stays: the client
 * id the screens send along, and the context the senders read (no socket, so they hand their message to the core).
 */

/** Whether the socket to the server is open: never, there is no server */
export const websocketConnectedAtom = atom(false)

export const clientIdAtom = atom<string | null>(null)

/** The web app could run in several browser tabs and let only the visible one act on events; the app is always that one. */
export function useIsMainTab() {
    return true
}

export function useIsMainTabRef() {
    return useRef(true)
}

export function WebsocketProvider({ children }: { children: React.ReactNode }) {
    const socket = useAtomValue(websocketAtom)
    const setClientId = useSetAtom(clientIdAtom)

    React.useEffect(() => {
        const update = ({ clientId }: { clientId: string }) => setClientId(clientId || null)
        update(getClientIdentity())
        return subscribeToClientIdentity(update)
    }, [setClientId])

    return (
        <WebSocketContext.Provider value={socket}>
            {children}
        </WebSocketContext.Provider>
    )
}
