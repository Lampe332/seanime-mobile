// geschrieben nach: core/offline/offline.ts offlinePrefetch (Form der Anfrage) und onlinestream.atoms.ts / onlinestream-provider-choice.ts (Quelle und Ton je Anime, wie die Anime-Seite sie wählt); kein Server-Quelltext

import { buildSeaQuery } from "@/api/client/requests"
import { logger } from "@/lib/helpers/debug"
import {
    __onlinestream_dubbedPreferenceByMediaAtom,
    __onlinestream_providerByMediaAtom,
    __onlinestream_selectedProviderAtom,
} from "@/main/onlinestream/_lib/onlinestream.atoms"
import { getDefaultStore } from "jotai"

/** One ask per anime and episode in this long is enough: pause, 80 % and closing all come from the same playback */
const AGAIN_AFTER_MS = 60_000

const asked = new Map<string, number>()

/**
 * "Download next episodes automatically" (core/offline/prefetch.ts): asks the core to queue the next episodes, with the
 * online provider and audio last picked per anime (the page's choice, else the one picked last anywhere). Without
 * `mediaId` the core looks at the anime played last (the start of the app). Whether anything is queued (setting,
 * Wi-Fi, incognito, storage, "Watching") the core decides; the answer goes to the log only.
 */
export function requestPrefetch(mediaId?: number, episode?: number): void {
    const key = `${mediaId ?? "all"}:${episode ?? ""}`
    const now = Date.now()
    if (now - (asked.get(key) ?? 0) < AGAIN_AFTER_MS) return
    asked.set(key, now)
    const store = getDefaultStore()
    const data = {
        providers: store.get(__onlinestream_providerByMediaAtom),
        fallback: store.get(__onlinestream_selectedProviderAtom) ?? "",
        dubbed: store.get(__onlinestream_dubbedPreferenceByMediaAtom),
        ...(mediaId !== undefined ? { mediaId } : {}),
    }
    void buildSeaQuery<string, typeof data>({ endpoint: "/api/v1/mobile-offline/prefetch", method: "POST", data })
        .then(line => logger("Core").info(`download next episodes${mediaId !== undefined ? ` (${mediaId})` : ""}: ${line ?? ""}`))
        .catch(error => logger("Core").warning(`download next episodes failed: ${error instanceof Error ? error.message : String(error)}`))
}
