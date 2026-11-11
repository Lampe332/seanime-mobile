import type { SeaWebsocketEvent } from "@/lib/server/queries.types"

// A MessageEvent is shared by all listeners. Retain its decoded envelope only
// for that event's lifetime instead of parsing large plugin batches per hook.
const decodedMessages = new WeakMap<MessageEvent, { value: unknown } | { error: unknown }>()

export function decodeWebsocketMessage<T>(event: MessageEvent): SeaWebsocketEvent<T> {
    let cached = decodedMessages.get(event)
    if (!cached) {
        try { cached = { value: JSON.parse(event.data) } }
        catch (error) { cached = { error } }
        decodedMessages.set(event, cached)
    }
    if ("error" in cached) throw cached.error
    return cached.value as SeaWebsocketEvent<T>
}

export function copyWebsocketPayload<T>(payload: T): T {
    // Preserve the original per-listener isolation, but copy only payloads
    // actually delivered to a matching listener, not every complete envelope.
    if (typeof structuredClone === "function") return structuredClone(payload)
    return payload === undefined ? payload : JSON.parse(JSON.stringify(payload)) as T
}
