import React from "react"

/** Where playback stands; ticks every 500 ms, so only the parts that show it read it (not the whole player screen) */
export type PlayerTime = { position: number, buffered: number }

export type PlayerTimeStore = {
    get: () => PlayerTime
    /** `silent`: while rendering (a new episode resets it); `notify` follows after the commit */
    set: (next: Partial<PlayerTime>, silent?: boolean) => void
    notify: () => void
    subscribe: (listener: () => void) => () => void
}

export function createPlayerTimeStore(): PlayerTimeStore {
    let value: PlayerTime = { position: 0, buffered: 0 }
    const listeners = new Set<() => void>()
    const notify = () => {
        for (const listener of [...listeners]) listener()
    }
    return {
        get: () => value,
        set(next, silent = false) {
            const position = next.position ?? value.position
            const buffered = next.buffered ?? value.buffered
            if (position === value.position && buffered === value.buffered) return
            value = { position, buffered }
            if (!silent) notify()
        },
        notify,
        subscribe(listener) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
    }
}

/** The selected part of the time; the component draws again only when it changes (return a primitive or a kept object) */
export function usePlayerTime<T>(store: PlayerTimeStore, select: (time: PlayerTime) => T): T {
    const snapshot = () => select(store.get())
    return React.useSyncExternalStore(store.subscribe, snapshot, snapshot)
}
