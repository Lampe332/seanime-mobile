import React from "react"

/**
 * The order in which the player tells the server that a stream loads, as the web player does it (video-core.tsx sends
 * "video-loaded" when a new stream is handed to the player, video-core-events.ts "video-loaded-metadata" and
 * "video-can-play" once the media has opened):
 *   source  → "video-loaded", once per playback id
 *   opened  → "video-loaded-metadata" + "video-can-play" (expo-mpv onLoad), once, always after "video-loaded"
 * The server hands every client event to its own goroutine (backend events/websocket.go OnClientEvent), so two events
 * sent in the same instant are processed in either order. "video-loaded-metadata" before "video-loaded" is dropped
 * (videocore has no playback yet, or still the previous one); the playlist then never counts the episode as started and
 * closing the player does not end it (playlist/manager.go). The web has the media's load time between the two; the
 * native player sent both from onLoad. docs/NATIVE-UMBAU.md §9 09.11.2026.
 */
export type PlayerLoadEvent = "loaded" | "metadata" | "canPlay"

export type PlayerLoadStep = "source" | "opened"

export type PlayerLoadState = { id: string | undefined, sent: Set<PlayerLoadEvent> }

export function initialPlayerLoadState(): PlayerLoadState {
    return { id: undefined, sent: new Set() }
}

/** The server events a step sends for playback `id` (each once per playback, in order); `state` is updated. */
export function playerLoadEvents(state: PlayerLoadState, id: string | undefined, step: PlayerLoadStep): PlayerLoadEvent[] {
    if (!id) return []
    if (state.id !== id) {
        state.id = id
        state.sent = new Set()
    }
    const wanted: PlayerLoadEvent[] = step === "source" ? ["loaded"] : ["loaded", "metadata", "canPlay"]
    const out = wanted.filter(event => !state.sent.has(event))
    for (const event of out) state.sent.add(event)
    return out
}

/**
 * The player screen's side: "source" when the stream is handed to mpv, `opened()` from expo-mpv onLoad. Calls
 * `send[event]` for each server event.
 */
export function usePlayerLoadEvents(playbackId: string | undefined, hasSource: boolean, send: Record<PlayerLoadEvent, () => void>) {
    const state = React.useRef<PlayerLoadState>(initialPlayerLoadState())
    const sendRef = React.useRef(send)
    React.useLayoutEffect(() => {
        sendRef.current = send
    })
    const step = React.useCallback((id: string | undefined, which: PlayerLoadStep) => {
        for (const event of playerLoadEvents(state.current, id, which)) sendRef.current[event]()
    }, [])
    React.useEffect(() => {
        if (hasSource) step(playbackId, "source")
    }, [hasSource, playbackId, step])
    return React.useMemo(() => ({ opened: () => step(playbackId, "opened") }), [playbackId, step])
}
