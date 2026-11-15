// geschrieben nach: App-Code src/main/_hooks/handle-websockets.ts (die beiden Hörer, vorher dort) und docs/EIGENER-KERN.md §4b; kein Server-Quelltext
import { type CoreEvent, onCoreEvent } from "@/core"
import { logger } from "@/lib/helpers/debug"
import type { SeaWebsocketEvent, SeaWebsocketPluginEvent } from "@/lib/server/queries.types"
import { copyWebsocketPayload, decodeWebsocketMessage } from "@/lib/server/websocket-message"

/*
 * What the app is told unasked has two sources: the server's WebSocket and the app's own core (docs/EIGENER-KERN.md
 * §4b). Both speak in the same form, `{ type, payload }`, and the hooks in handle-websockets.ts listen to both through
 * the two functions here. No React in this file, so the logic tests can run it.
 */

/** The part of the socket the listeners use; null while there is no connection */
export type EventSocket = Pick<WebSocket, "addEventListener" | "removeEventListener"> | null

/** Hears one message of either source; the socket's is still text and is decoded once for all its listeners. */
function listenToBoth(socket: EventSocket, onEvent: (event: SeaWebsocketEvent<unknown>) => void, failed: () => void): () => void {
    const fromSocket = (message: MessageEvent) => {
        try {
            onEvent(decodeWebsocketMessage(message))
        }
        catch {
            failed()
        }
    }
    const fromCore = (event: CoreEvent) => {
        try {
            onEvent(event)
        }
        catch {
            failed()
        }
    }
    socket?.addEventListener("message", fromSocket)
    const endCore = onCoreEvent(fromCore)
    return () => {
        socket?.removeEventListener("message", fromSocket)
        endCore()
    }
}

/** Calls `onMessage` with the payload of every event of this kind, from the server or the core, until the returned function is called. */
export function listenForServerEvent<TData>(socket: EventSocket, type: string, onMessage: (data: TData) => void): () => void {
    return listenToBoth(socket, event => {
        if (!!event.type && event.type === type) onMessage(copyWebsocketPayload(event.payload as TData))
    }, () => logger("Websocket").error(`Error handling message ${type}`))
}

/**
 * The same for what plugins send: these travel inside events of the kind "plugin", one at a time or as a batch.
 * An empty `extensionId` hears all plugins.
 */
export function listenForPluginEvent<TData>(
    socket: EventSocket,
    type: string,
    extensionId: string,
    onMessage: (data: TData, extensionId: string) => void,
): () => void {
    return listenToBoth(socket, event => {
        if (event.type !== "plugin") return
        const message = event.payload as SeaWebsocketPluginEvent<TData>

        if (message.type === "plugin:batch-events" && message.payload && (message.payload as any).events) {
            const events: SeaWebsocketPluginEvent<TData>[] = (message.payload as any).events || []
            for (const batched of events) {
                if (batched.type === type && (!extensionId || extensionId === batched.extensionId)) {
                    onMessage(copyWebsocketPayload(batched.payload), batched.extensionId)
                }
            }
            return
        }

        if (message.type === type && (!extensionId || extensionId === message.extensionId)) {
            onMessage(copyWebsocketPayload(message.payload), message.extensionId)
        }
    }, () => logger("Websocket").error(`Error handling plugin message ${type}`))
}
