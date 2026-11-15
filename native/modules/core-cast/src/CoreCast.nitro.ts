// geschrieben nach: Plan „Eigener Kern" Phase 7c-1, dem Vertrag src/core/cast/cast.ts (CastSearcher) und der öffentlichen Doku von Nitro Modules (HybridObject, Promise); keine Vorlage
import type { HybridObject } from "react-native-nitro-modules"

/** The search into the home network (SSDP): shared C++, plain POSIX sockets, the same for iOS */
export interface CoreCast extends HybridObject<{ ios: "c++", android: "c++" }> {
    /**
     * Sends `message` over UDP to the multicast group `host`:`port` (twice, UDP may lose one) and collects every answer
     * that comes back to the sending socket within `waitMs`, each as its text. Rejects with `ERR_CAST: …` when no
     * socket can be opened or nothing can be sent (no network).
     */
    search(message: string, host: string, port: number, waitMs: number): Promise<string[]>
}

/**
 * Android filters multicast for apps unless one holds a WifiManager.MulticastLock (Kotlin, thin): held only while a
 * search listens.
 */
export interface CoreCastLock extends HybridObject<{ android: "kotlin" }> {
    /** Takes the lock; false when there is no Wi-Fi service to take it from */
    hold(): boolean
    release(): void
}
