import { getServerBaseUrl } from "@/api/client/server-url"
import { serverAuthTokenAtom, serverStatusAtom } from "@/main/_atoms/server-status.atoms"
import { websocketAtom, WebSocketContext } from "@/main/_atoms/websocket.atoms"
import { logger } from "@/lib/helpers/debug"
import { getClientId, getClientIdentity, getClientIdProof, setClientIdentity, subscribeToClientIdentity } from "@/lib/server/client-id"
import type { SeaWebsocketEvent } from "@/lib/server/queries.types"
import { decodeWebsocketMessage } from "@/lib/server/websocket-message"
import { WSEvents } from "@/lib/server/ws-events"
import { __clientPlatform__ } from "@/types/constants"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import React, { useRef } from "react"

/*
 * Port of seanime-web app/websocket-provider.tsx: one WebSocket to the app's own server (/events) with the client id,
 * its proof and the server password, a ping every 15 s, reconnect after three missed pongs, backoff 1 s, 2 s, then 3 s.
 * Left out: the browser-tab election (useMainTab: the app is a single instance, so it is always the main tab), the
 * body scroll-lock of open drawers (react-remove-scroll-bar; native sheets do not scroll the page) and the plugin
 * prompt (ExtensionPrompt comes with the plugin UI, docs/NATIVE-UMBAU.md 6 "Plugins").
 */

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
    const [socket] = useAtom(websocketAtom)
    return (
        <>
            <WebsocketManagement />
            <WebSocketContext.Provider value={socket}>
                {children}
            </WebSocketContext.Provider>
        </>
    )
}

function WebsocketManagement() {
    const [socket, setSocket] = useAtom(websocketAtom)
    const setIsConnected = useSetAtom(websocketConnectedAtom)

    // A password-protected server rejects the socket without a token, so connecting waits for the login
    const serverAuthToken = useAtomValue(serverAuthTokenAtom)
    const serverStatus = useAtomValue(serverStatusAtom)
    const serverAuthTokenRef = React.useRef(serverAuthToken)
    const shouldPauseForAuth = serverStatus?.serverHasPassword !== false && !serverAuthToken
    const shouldPauseForAuthRef = React.useRef(shouldPauseForAuth)
    React.useEffect(() => {
        serverAuthTokenRef.current = serverAuthToken
    }, [serverAuthToken])
    React.useEffect(() => {
        shouldPauseForAuthRef.current = shouldPauseForAuth
    }, [shouldPauseForAuth])

    const [, setClientId] = useAtom(clientIdAtom)

    const heartbeatRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
    const pingIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
    const reconnectTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const errorCountRef = React.useRef(0)
    // set to Date.now() whenever a socket is created, before the heartbeat first reads it (Date.now() while rendering
    // is impure)
    const lastPongRef = React.useRef<number>(0)
    const socketRef = React.useRef<WebSocket | null>(null)
    const clientIdRef = React.useRef<string>("")
    const clientIdProofRef = React.useRef<string>("")
    const connectWebSocketRef = React.useRef<(() => void) | null>(null)
    const clearAllIntervalsRef = React.useRef<(() => void) | null>(null)

    React.useEffect(() => {
        const updateClientIdentity = ({ clientId, clientIdProof }: { clientId: string, clientIdProof: string }) => {
            logger("WebsocketProvider").info("Seanime-Client-Id", clientId)
            clientIdRef.current = clientId
            clientIdProofRef.current = clientIdProof
            setClientId(clientId || null)
        }

        updateClientIdentity(getClientIdentity())
        return subscribeToClientIdentity(updateClientIdentity)
    }, [setClientId])

    // Runs once (the web version used react-use's useEffectOnce)
    React.useEffect(() => {
        function initClientIdentity() {
            const clientId = clientIdRef.current || getClientId()
            const clientIdProof = clientIdProofRef.current || getClientIdProof()
            clientIdRef.current = clientId
            clientIdProofRef.current = clientIdProof
            setClientId(clientId)
            return { clientId, clientIdProof }
        }

        function clearAllIntervals() {
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current)
                heartbeatRef.current = null
            }
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current)
                pingIntervalRef.current = null
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current)
                reconnectTimeoutRef.current = null
            }
        }

        clearAllIntervalsRef.current = clearAllIntervals

        function connectWebSocket() {
            if (shouldPauseForAuthRef.current) {
                return
            }

            clearAllIntervals()
            socketRef.current?.close()

            // The app's own server speaks plain HTTP on 127.0.0.1, so the socket is ws://
            const wsUrl = `ws://${getServerBaseUrl(true)}/events`
            const { clientId, clientIdProof } = initClientIdentity()
            const queryParams = new URLSearchParams()
            if (clientId) {
                queryParams.set("id", clientId)
            }
            if (clientIdProof) {
                queryParams.set("proof", clientIdProof)
            }
            queryParams.set("platform", __clientPlatform__)
            if (serverAuthTokenRef.current) {
                queryParams.set("token", serverAuthTokenRef.current)
            }

            let ws: WebSocket
            try {
                ws = new WebSocket(`${wsUrl}?${queryParams.toString()}`)
            }
            catch {
                logger("WebsocketProvider").error("Failed to create WebSocket connection")
                handleDisconnection()
                return
            }
            socketRef.current = ws
            lastPongRef.current = Date.now()

            // A replaced socket still fires its events later; they must not tear down its successor
            ws.addEventListener("open", () => {
                if (socketRef.current !== ws) return
                logger("WebsocketProvider").info("WebSocket connection opened")
                setIsConnected(true)
                errorCountRef.current = 0

                // Three missed pongs mean the connection died silently
                heartbeatRef.current = setInterval(() => {
                    const timeSinceLastPong = Date.now() - lastPongRef.current
                    if (timeSinceLastPong > 45000) {
                        logger("WebsocketProvider").error(`No pong response for ${Math.round(timeSinceLastPong / 1000)}s, reconnecting`)
                        reconnectSocket()
                    } else if (ws.readyState !== WebSocket.OPEN) {
                        logger("WebsocketProvider").error("Heartbeat check failed, reconnecting")
                        reconnectSocket()
                    }
                }, 15000)

                pingIntervalRef.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "ping", payload: { timestamp: Date.now() } }))
                    }
                }, 15000)
            })

            ws.addEventListener("message", (event) => {
                let data: SeaWebsocketEvent<any>
                try {
                    data = decodeWebsocketMessage(event)
                }
                catch {
                    return
                }
                if (data.type === WSEvents.CLIENT_IDENTITY) {
                    const nextClientId = typeof data.payload?.clientId === "string" ? data.payload.clientId : ""
                    const nextProof = typeof data.payload?.proof === "string" ? data.payload.proof : ""
                    if (nextClientId) {
                        setClientIdentity(nextClientId, nextProof)
                    }
                } else if (data.type === "pong") {
                    lastPongRef.current = Date.now()
                }
            })

            ws.addEventListener("close", (event) => {
                logger("WebsocketProvider").info(`WebSocket connection closed: ${event.code} ${event.reason}`)
                if (socketRef.current === ws) handleDisconnection()
            })

            ws.addEventListener("error", (event) => {
                logger("WebsocketProvider").error("WebSocket encountered an error:", event)
                if (socketRef.current === ws) reconnectSocket()
            })

            setSocket(ws)
        }

        connectWebSocketRef.current = connectWebSocket

        function handleDisconnection() {
            clearAllIntervals()
            setIsConnected(false)
            scheduleReconnect()
        }

        function reconnectSocket() {
            socketRef.current?.close()
            handleDisconnection()
        }

        function scheduleReconnect() {
            if (shouldPauseForAuthRef.current) {
                return
            }
            errorCountRef.current++
            // 1 s, 2 s, then every 3 s
            const backoffTime = Math.min(2 ** (errorCountRef.current - 1) * 1000, 3000)
            logger("WebsocketProvider").info(`Reconnecting in ${backoffTime}ms (attempt ${errorCountRef.current})`)
            reconnectTimeoutRef.current = setTimeout(connectWebSocket, backoffTime)
        }

        if (!shouldPauseForAuthRef.current && (!socket || socket.readyState === WebSocket.CLOSED)) {
            connectWebSocket()
        }

        return () => {
            connectWebSocketRef.current = null
            clearAllIntervalsRef.current = null
            const ws = socketRef.current
            socketRef.current = null
            ws?.close()
            setIsConnected(false)
            clearAllIntervals()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    React.useEffect(() => {
        if (shouldPauseForAuth) {
            clearAllIntervalsRef.current?.()
            const ws = socketRef.current
            socketRef.current = null
            ws?.close()
            setSocket(null)
            setIsConnected(false)
            return
        }

        if (!socketRef.current || socketRef.current.readyState === WebSocket.CLOSED) {
            connectWebSocketRef.current?.()
        }
    }, [setIsConnected, setSocket, shouldPauseForAuth])

    return null
}
