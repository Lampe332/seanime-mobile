import { WebSocketContext } from "@/main/_atoms/websocket.atoms"
import { websocketConnectedAtom } from "@/main/websocket-provider"
import { logger } from "@/lib/helpers/debug"
import { SeaWebsocketEvent } from "@/lib/server/queries.types"
import { listenForPluginEvent, listenForServerEvent } from "@/lib/server/server-events"
import { WSEvents } from "@/lib/server/ws-events"
import { useAtom } from "jotai"
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react"

export function useWebsocketSender() {
    const socket = useContext(WebSocketContext)
    const [isConnected] = useAtom(websocketConnectedAtom)

    const messageQueue = useRef<SeaWebsocketEvent<any>[]>([])
    const processingQueueRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Plugin event batching
    const pluginEventBatchRef = useRef<Array<{ type: string, payload: any, extensionId?: string }>>([])
    const pluginBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const MAX_PLUGIN_BATCH_SIZE = 20
    const PLUGIN_BATCH_FLUSH_INTERVAL = 10 // ms

    const latestSocketRef = useRef<WebSocket | null>(socket)

    useEffect(() => {
        latestSocketRef.current = socket
        if (socket && socket.readyState === WebSocket.OPEN && messageQueue.current.length > 0) {
            setTimeout(() => processQueue(), 100)
        }
    }, [socket])

    // Clean up event batch timer on unmount
    useEffect(() => {
        return () => {
            if (pluginBatchTimerRef.current) {
                clearTimeout(pluginBatchTimerRef.current)
                pluginBatchTimerRef.current = null
            }
        }
    }, [])

    function flushPluginEventBatch() {
        if (pluginBatchTimerRef.current) {
            clearTimeout(pluginBatchTimerRef.current)
            pluginBatchTimerRef.current = null
        }

        if (pluginEventBatchRef.current.length === 0) return

        const events = [...pluginEventBatchRef.current]
        pluginEventBatchRef.current = []

        const deduplicatedEvents = events.filter((event, index, self) => {
            return index === self.findIndex((t) => (t.type === event.type && t.extensionId === event.extensionId && JSON.stringify(t.payload) === JSON.stringify(
                event.payload)))
        })

        if (deduplicatedEvents.length === 1) {
            const event = deduplicatedEvents[0]
            sendMessage({
                type: "plugin",
                payload: {
                    type: event.type,
                    extensionId: event.extensionId,
                    payload: event.payload,
                },
            })
            return
        }

        sendMessage({
            type: "plugin",
            payload: {
                type: "client:batch-events",
                extensionId: "", // Do not use extension ID for batch events
                payload: {
                    events: deduplicatedEvents,
                },
            },
        })
    }

    function getReadyStateString(state?: number): string {
        if (state === undefined) return "UNDEFINED"
        switch (state) {
            case WebSocket.CONNECTING:
                return "CONNECTING"
            case WebSocket.OPEN:
                return "OPEN"
            case WebSocket.CLOSING:
                return "CLOSING"
            case WebSocket.CLOSED:
                return "CLOSED"
            default:
                return `UNKNOWN (${state})`
        }
    }

    function sendMessage<TData>(data: SeaWebsocketEvent<TData>) {
        const currentSocket = latestSocketRef.current
        // No socket at all: since stage 8a-2 there is none (websocket-provider.tsx), so nothing is queued, logged or
        // retried. Before, every page change and turn of the device queued the plugins' events for good, a 1 s timer ran
        // forever and "Queued message…" filled the diagnostic report's log. A socket that is still opening keeps the queue.
        if (!currentSocket) return false

        if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
            try {
                currentSocket.send(JSON.stringify(data))
                return true
            }
            catch {
                messageQueue.current.push(data)
                return false
            }
        } else {
            if (messageQueue.current.length < 500) {
                messageQueue.current.push(data)
                logger("WebsocketSender")
                    .info(`Queued message of type ${data.type}, queue size: ${messageQueue.current.length}, socket state: ${currentSocket
                        ? getReadyStateString(currentSocket.readyState)
                        : "null"}`)
            } else {
                logger("WebsocketSender").warning(`Message queue full (500), dropping message of type ${data.type}`)
            }

            ensureQueueProcessorIsRunning()
            return false
        }
    }

    function addPluginEventToBatch(type: string, payload: any, extensionId?: string) {
        if (!latestSocketRef.current) return
        pluginEventBatchRef.current.push({
            type,
            payload,
            extensionId,
        })

        if (pluginEventBatchRef.current.length === 1) {
            pluginBatchTimerRef.current = setTimeout(() => {
                flushPluginEventBatch()
            }, PLUGIN_BATCH_FLUSH_INTERVAL)
        }

        if (pluginEventBatchRef.current.length >= MAX_PLUGIN_BATCH_SIZE) {
            flushPluginEventBatch()
        }
    }

    function ensureQueueProcessorIsRunning() {
        if (!processingQueueRef.current) {
            processQueue()
        }
    }

    function processQueue() {
        if (processingQueueRef.current) {
            clearTimeout(processingQueueRef.current)
            processingQueueRef.current = null
        }

        const currentSocket = latestSocketRef.current

        if (currentSocket && currentSocket.readyState === WebSocket.OPEN && messageQueue.current.length > 0) {
            const queueCopy = [...messageQueue.current]
            const successfulMessages: number[] = []

            queueCopy.forEach((message, index) => {
                try {
                    currentSocket.send(JSON.stringify(message))
                    successfulMessages.push(index)
                }
                catch {
                }
            })

            if (successfulMessages.length > 0) {
                messageQueue.current = queueCopy.filter((_, index) => !successfulMessages.includes(index))
            }
        }

        // Keep retrying every second while messages wait or the socket is down
        const shouldReschedule = messageQueue.current.length > 0 || !currentSocket || currentSocket.readyState !== WebSocket.OPEN

        if (shouldReschedule) {
            processingQueueRef.current = setTimeout(() => {
                processQueue()
            }, 1000)
        } else {
            processingQueueRef.current = null
        }
    }

    useEffect(() => {
        if (isConnected && latestSocketRef.current?.readyState === WebSocket.OPEN) {
            setTimeout(() => processQueue(), 100)
        }

        return () => {
            // Flush first: while disconnected the flush queues the batch and restarts the processor, which is cleared right after
            if (pluginEventBatchRef.current.length > 0) {
                flushPluginEventBatch()
            }
            if (processingQueueRef.current) {
                clearTimeout(processingQueueRef.current)
                processingQueueRef.current = null
            }
        }
    }, [isConnected])

    // The functions above are new on every render (the React Compiler skips this hook), and callers list sendMessage in
    // effect and callback dependencies: the player's 1 s status interval restarted with every progress render (500 ms)
    // and never fired, Nakama and the playlist asked the server again on every render, and each answer rendered again.
    // So callers get functions that never change and call the latest ones.
    const latest = useRef({ sendMessage, addPluginEventToBatch })
    useLayoutEffect(() => {
        latest.current = { sendMessage, addPluginEventToBatch }
    })
    return useMemo(() => ({
        sendMessage: <TData>(data: SeaWebsocketEvent<TData>) => latest.current.sendMessage(data),
        sendPluginMessage: (type: string, payload: any, extensionId?: string) => {
            latest.current.addPluginEventToBatch(type, payload, extensionId)
            return true
        },
    }), [])
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export type WebSocketMessageListener<TData> = {
    type: WSEvents | string
    onMessage: (data: TData) => void
}

export function useWebsocketMessageListener<TData = unknown>({ type, onMessage, deps }: WebSocketMessageListener<TData> & { deps?: any[] }) {
    const socket = useContext(WebSocketContext)

    // the server's socket and the app's own core, heard the same way (src/lib/server/server-events.ts)
    useEffect(() => listenForServerEvent<TData>(socket, type, onMessage), [socket, onMessage, ...(deps ?? [])])

    return null
}

export type WebSocketPluginMessageListener<TData> = {
    type: string
    extensionId: string // If empty, get message from all plugins
    onMessage: (data: TData, extensionId: string) => void
}

export function useWebsocketPluginMessageListener<TData = unknown>({ type, extensionId, onMessage }: WebSocketPluginMessageListener<TData>) {
    const socket = useContext(WebSocketContext)

    useEffect(() => listenForPluginEvent<TData>(socket, type, extensionId, onMessage), [socket, onMessage, type, extensionId])

    return null
}
