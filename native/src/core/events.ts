// geschrieben nach: App-Code src/lib/server/ws-events.ts (die Arten) und src/main/_hooks/handle-websockets.ts (die Form `type` + `payload`, wie die Hörer sie lesen); Plan „Eigener Kern" Stufe 1c

/*
 * What the server tells the app unasked arrives as messages on its WebSocket: `{ type, payload }`. The core tells the app
 * the same things in the same form through this distributor, so a listener cannot tell (and need not know) which of the
 * two spoke. The screens' side joins both sources in src/lib/server/server-events.ts.
 */

/** The kinds the app's listeners know, the same list as WSEvents (events.test.ts keeps the two equal) */
export const CORE_EVENT_TYPES = [
    "client-identity",
    "server-ready",
    "anilist-rate-limit",
    "server-logged-out-anilist",
    "scan-progress",
    "scan-status",
    "refreshed-anilist-anime-collection",
    "refreshed-anilist-manga-collection",
    "refreshed-missed-sequels",
    "library-watcher-file-added",
    "library-watcher-file-removed",
    "auto-scan-started",
    "auto-scan-completed",
    "playback-manager-progress-tracking-started",
    "playback-manager-progress-tracking-stopped",
    "playback-manager-progress-video-completed",
    "playback-manager-progress-playback-state",
    "playback-manager-progress-updated",
    "playback-manager-manual-tracking-playback-state",
    "external-player-open-url",
    "playback-manager-manual-tracking-stopped",
    "error-toast",
    "success-toast",
    "info-toast",
    "warning-toast",
    "refreshed-manga-download-data",
    "chapter-download-queue-updated",
    "manga-preferences-updated",
    "manga-source-refresh-job-updated",
    "extensions-reloaded",
    "extension-updates-found",
    "plugin-unloaded",
    "plugin-loaded",
    "extension-prompt",
    "extension-prompt-sync",
    "extension-prompt-response",
    "active-torrent-count-updated",
    "torrentstream-state",
    "debrid-download-progress",
    "debrid-stream-state",
    "stream-auto-select-status",
    "invalidate-queries",
    "console-log",
    "console-warn",
    "native-player",
    "videocore",
    "nakama-host-started",
    "nakama-host-stopped",
    "nakama-peer-connected",
    "nakama-peer-disconnected",
    "nakama-host-connected",
    "nakama-host-disconnected",
    "nakama-error",
    "nakama-status-requested",
    "nakama-status",
    "nakama-room-created",
    "nakama-room-closed",
    "nakama-room-reconnected",
    "nakama-watch-party-state",
    "nakama-watch-party-created",
    "nakama-watch-party-joined",
    "nakama-watch-party-left",
    "nakama-watch-party-stopped",
    "nakama-watch-party-playback-info",
    "nakama-watch-party-playback-status",
    "nakama-watch-party-enable-relay-mode",
    "nakama-watch-party-relay-mode-toggle-share-library-with-origin",
    "nakama-watch-party-chat-message",
    "show-indefinite-loader",
    "hide-indefinite-loader",
    "nakama-online-stream-event",
    "nakama-online-stream-client-event",
    "playlist",
    "settings-changed",
] as const

export type CoreEventType = (typeof CORE_EVENT_TYPES)[number]

/** One message, as the server's WebSocket carries it */
export type CoreEvent = { type: string, payload: unknown }

export type CoreEventListener = (event: CoreEvent) => void

const listeners = new Set<CoreEventListener>()

/** Hears every event the core sends from now on. The returned function ends that. */
export function onCoreEvent(listener: CoreEventListener): () => void {
    listeners.add(listener)
    return () => void listeners.delete(listener)
}

/**
 * Sends an event to everyone listening. Like a message from the server it arrives later, in a turn of its own (never
 * inside the core's own work), and carries only what a message can: the payload is taken as JSON at this moment, so
 * later changes by the sender do not reach the listeners. Kinds beyond the list are allowed, as on the socket (the
 * "plugin" envelope is one).
 */
export function emitCoreEvent(type: CoreEventType | (string & {}), payload?: unknown): void {
    const message = JSON.stringify({ type, payload })
    setTimeout(() => {
        const event = JSON.parse(message) as CoreEvent
        for (const listener of [...listeners]) {
            // ended while this event was on its way
            if (!listeners.has(listener)) continue
            try {
                listener(event)
            }
            catch (error) {
                // one listener's failure is not the others' (a socket goes on to its next listener too)
                console.error(`[Core] error a listener failed on "${type}"`, error)
            }
        }
    }, 0)
}
