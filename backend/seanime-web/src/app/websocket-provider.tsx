import { getServerBaseUrl } from "@/api/client/server-url"
import { serverAuthTokenAtom, serverStatusAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { websocketAtom, WebSocketContext } from "@/app/(main)/_atoms/websocket.atoms"
import { ElectronRestartServerPrompt } from "@/app/(main)/_electron/electron-restart-server-prompt"
import { ExtensionPrompt } from "@/app/(main)/_features/plugin/extension-prompt"
import { __openDrawersAtom } from "@/components/ui/drawer"
import { useMainTab } from "@/hooks/use-main-tab"
import { logger } from "@/lib/helpers/debug"
import { getClientId, getClientIdentity, getClientIdProof, setClientIdentity, subscribeToClientIdentity } from "@/lib/server/client-id"
import { WSEvents } from "@/lib/server/ws-events"
import { __clientPlatform__, __isElectronDesktop__ } from "@/types/constants"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import React, { useRef } from "react"
import { RemoveScrollBar } from "react-remove-scroll-bar"
import { useEffectOnce } from "react-use"


export function uuidv4(): string {
    // @ts-ignore
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
    )
}

export const websocketConnectedAtom = atom(false)
export const websocketConnectionErrorCountAtom = atom(0)

export const clientIdAtom = atom<string | null>(null)

const isMainTabAtom = atom(false)

export function useIsMainTab() {
    return useAtomValue(isMainTabAtom)
}

export function useIsMainTabRef() {
    const isMainTab = useIsMainTab()
    const isMainTabRef = useRef(isMainTab)

    React.useLayoutEffect(() => {
        isMainTabRef.current = isMainTab
    }, [isMainTab])

    return isMainTabRef
}

export function WebsocketProvider({ children }: { children: React.ReactNode }) {
    const [socket] = useAtom(websocketAtom)
    return (
        <>
            <WebsocketManagement />
            <ManageOpenDrawers />
            {__isElectronDesktop__ && <ElectronRestartServerPrompt />}
            <WebSocketContext.Provider value={socket}>
                <ExtensionPrompt />
                {children}
            </WebSocketContext.Provider>
        </>
    )
}

function ManageOpenDrawers() {
    const openDrawers = useAtomValue(__openDrawersAtom)
    if (openDrawers.length > 0) return <RemoveScrollBar />
    return null
}

function WebsocketManagement() {
    const [socket, setSocket] = useAtom(websocketAtom)
    const [isConnected, setIsConnected] = useAtom(websocketConnectedAtom)
    const setConnectionErrorCount = useSetAtom(websocketConnectionErrorCountAtom)

    // Password set, user not yet logged in → ws connection fails (401), reconnect loop retries. Once the user logs in, serverAuthTokenRef updates,
    // next reconnect succeeds.
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
    const setMainTab = useSetAtom(isMainTabAtom)

    const isMainTab = useMainTab()
    React.useLayoutEffect(() => {
        setMainTab(isMainTab)
    }, [isMainTab])

    // Refs to manage connection state
    const heartbeatRef = React.useRef<NodeJS.Timeout | null>(null)
    const pingIntervalRef = React.useRef<NodeJS.Timeout | null>(null)
    const reconnectTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
    const lastPongRef = React.useRef<number>(Date.now())
    const socketRef = React.useRef<WebSocket | null>(null)
    const clientIdRef = React.useRef<string>("")
    const clientIdProofRef = React.useRef<string>("")
    const connectWebSocketRef = React.useRef<(() => void) | null>(null)
    const clearAllIntervalsRef = React.useRef<(() => void) | null>(null)
    const wasDisconnected = React.useRef<boolean>(false)
    const initialConnection = React.useRef<boolean>(true)

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

    // Effect to handle page reload on reconnection
    /* React.useEffect(() => {
     // If we're connected now and were previously disconnected (not the first connection)
     if (isConnected && wasDisconnected.current && !initialConnection.current) {
     logger("WebsocketProvider").info("Connection re-established, reloading page")
     // Add a small delay to allow for other components to process the connection status
     setTimeout(() => {
     window.location.reload()
     }, 100)
     }

     // Update the wasDisconnected ref when connection status changes
     if (!isConnected && !initialConnection.current) {
     wasDisconnected.current = true
     }

     // After first connection, set initialConnection to false
     if (isConnected && initialConnection.current) {
     initialConnection.current = false
     }
     }, [isConnected]) */

    useEffectOnce(() => {
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

            // Clear existing connection attempts
            clearAllIntervals()

            // Close any existing socket
            if (socketRef.current && socketRef.current.readyState !== WebSocket.CLOSED) {
                try {
                    socketRef.current.close()
                }
                catch (e) {
                    // Ignore errors on closing
                }
            }

            const wsUrl = `${document.location.protocol == "https:" ? "wss" : "ws"}://${getServerBaseUrl(true)}/events`
            const { clientId, clientIdProof } = initClientIdentity()

            try {
                const queryParams = new URLSearchParams()
                if (clientId) {
                    queryParams.set("id", clientId)
                }
                if (clientIdProof) {
                    queryParams.set("proof", clientIdProof)
                }
                if (__clientPlatform__) {
                    queryParams.set("platform", __clientPlatform__)
                }
                if (serverAuthTokenRef.current) {
                    queryParams.set("token", serverAuthTokenRef.current)
                }
                const query = queryParams.toString()
                socketRef.current = new WebSocket(query ? `${wsUrl}?${query}` : wsUrl)

                // Reset the last pong timestamp whenever we connect
                lastPongRef.current = Date.now()

                socketRef.current.addEventListener("open", () => {
                    logger("WebsocketProvider").info("WebSocket connection opened")
                    setIsConnected(true)
                    setConnectionErrorCount(0)

                    // Start heartbeat interval to detect silent disconnections
                    heartbeatRef.current = setInterval(() => {
                        const timeSinceLastPong = Date.now() - lastPongRef.current

                        // If no pong received for 45 seconds (3 missed pings), consider connection dead
                        if (timeSinceLastPong > 45000) {
                            logger("WebsocketProvider").error(`No pong response for ${Math.round(timeSinceLastPong / 1000)}s, reconnecting`)
                            reconnectSocket()
                            return
                        }

                        if (socketRef.current?.readyState !== WebSocket.OPEN) {
                            logger("WebsocketProvider").error("Heartbeat check failed, reconnecting")
                            reconnectSocket()
                        }
                    }, 15000) // check every 15 seconds

                    // Implement a ping mechanism to keep the connection alive
                    // Start the ping interval slightly offset from the heartbeat to avoid race conditions
                    setTimeout(() => {
                        pingIntervalRef.current = setInterval(() => {
                            if (socketRef.current?.readyState === WebSocket.OPEN) {
                                try {
                                    const timestamp = Date.now()
                                    // Send a ping message to keep the connection alive
                                    socketRef.current?.send(JSON.stringify({
                                        type: "ping",
                                        payload: { timestamp },
                                    }))
                                }
                                catch (e) {
                                    logger("WebsocketProvider").error("Failed to send ping", e)
                                    reconnectSocket()
                                }
                            } else {
                                logger("WebsocketProvider").error("Failed to send ping, WebSocket not open", socketRef.current?.readyState)
                                // reconnectSocket()
                            }
                        }, 15000) // ping every 15 seconds
                    }, 5000) // Start ping interval 5 seconds after heartbeat to offset them
                })

                // Add message handler for pong responses
                socketRef.current?.addEventListener("message", (event) => {
                    try {
                        const data = JSON.parse(event.data) as { type: string; payload?: any }
                        if (data.type === WSEvents.CLIENT_IDENTITY) {
                            const nextClientId = typeof data.payload?.clientId === "string" ? data.payload.clientId : ""
                            const nextProof = typeof data.payload?.proof === "string" ? data.payload.proof : ""
                            if (nextClientId) {
                                setClientIdentity(nextClientId, nextProof)
                            }
                            return
                        }

                        if (data.type === "pong") {
                            // Update the last pong timestamp
                            lastPongRef.current = Date.now()
                            // For debugging purposes
                            // logger("WebsocketProvider").info("Pong received, timestamp updated", lastPongRef.current)
                        }
                    }
                    catch (e) {
                    }
                })

                socketRef.current?.addEventListener("close", (event) => {
                    logger("WebsocketProvider").info(`WebSocket connection closed: ${event.code} ${event.reason}`)
                    handleDisconnection()
                })

                socketRef.current?.addEventListener("error", (event) => {
                    logger("WebsocketProvider").error("WebSocket encountered an error:", event)
                    reconnectSocket()
                })

                setSocket(socketRef.current)
            }
            catch (e) {
                logger("WebsocketProvider").error("Failed to create WebSocket connection:", e)
                handleDisconnection()
            }
        }

        connectWebSocketRef.current = connectWebSocket

        function handleDisconnection() {
            clearAllIntervals()
            setIsConnected(false)
            scheduleReconnect()
        }

        function reconnectSocket() {
            if (socketRef.current) {
                try {
                    socketRef.current.close()
                }
                catch (e) {
                    // Ignore errors on closing
                }
            }
            handleDisconnection()
        }

        function scheduleReconnect() {
            if (shouldPauseForAuthRef.current) {
                return
            }

            // Reconnect after a delay with exponential backoff
            setConnectionErrorCount(count => {
                const newCount = count + 1
                // Calculate backoff time (1s, 2s, max 3s)
                const backoffTime = Math.min(Math.pow(2, Math.min(newCount - 1, 10)) * 1000, 3000)

                logger("WebsocketProvider").info(`Reconnecting in ${backoffTime}ms (attempt ${newCount})`)

                reconnectTimeoutRef.current = setTimeout(() => {
                    connectWebSocket()
                }, backoffTime)

                return newCount
            })
        }

        if (!shouldPauseForAuthRef.current && (!socket || socket.readyState === WebSocket.CLOSED)) {
            // If the socket is not set or the connection is closed, initiate a new connection
            connectWebSocket()
        }

        return () => {
            connectWebSocketRef.current = null
            clearAllIntervalsRef.current = null
            if (socketRef.current) {
                try {
                    socketRef.current.close()
                }
                catch (e) {
                    // Ignore errors on closing
                }
            }
            setIsConnected(false)
            // Cleanup all intervals on unmount
            clearAllIntervals()
        }
    })

    React.useEffect(() => {
        if (shouldPauseForAuth) {
            clearAllIntervalsRef.current?.()
            if (socketRef.current) {
                try {
                    socketRef.current.close()
                }
                catch {
                }
            }
            socketRef.current = null
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
