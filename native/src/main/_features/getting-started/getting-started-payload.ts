import type { GettingStarted_Variables } from "@/api/generated/endpoint.types"
import {
    getDefaultIinaSocket,
    getDefaultMpvSocket,
    getDefaultSettings,
    gettingStartedSchema,
} from "@/lib/server/settings"

/** The two switches of the Android first start (getting-started-mobile.tsx) */
export type GettingStartedFeatures = {
    enableOnlinestream: boolean
    enableManga: boolean
}

// on Android, online streaming is the main way to watch
export const DEFAULT_GETTING_STARTED_FEATURES: GettingStartedFeatures = { enableOnlinestream: true, enableManga: true }

/*
 * The first-start settings, as getting-started-page.tsx built them: the form's default values (desktop players and
 * clients stay at their harmless defaults, nothing is set up on a phone), run through the same schema so its defaults
 * fill every other field, then the Android overrides (no library folder, no torrent client, no debrid).
 * The desktop paths of useDefaultSettingsPaths are left to the schema: the server runs on Android ("linux"/"android"
 * os), where none of them exist.
 */
export function buildGettingStartedPayload(os: string, features: GettingStartedFeatures): GettingStarted_Variables {
    const data = gettingStartedSchema.parse({
        mediaPlayerHost: "127.0.0.1",
        vlcPort: 8080,
        mpcPort: 13579,
        defaultPlayer: "mpv",
        qbittorrentHost: "127.0.0.1",
        qbittorrentPort: 8081,
        transmissionHost: "127.0.0.1",
        transmissionPort: 9091,
        mpcPath: "C:/Program Files/MPC-HC/mpc-hc64.exe",
        torrentProvider: "",
        mpvSocket: getDefaultMpvSocket(os),
        iinaSocket: getDefaultIinaSocket(os),
        enableRichPresence: false,
        autoScan: false,
        enableManga: features.enableManga,
        enableOnlinestream: features.enableOnlinestream,
        enableAdultContent: false,
        enableTorrentStreaming: false,
        enableTranscode: false,
        debridProvider: "none",
        debridApiKey: "",
        nakamaUsername: "",
        enableWatchContinuity: true,
    })
    return getDefaultSettings({
        ...data,
        libraryPath: "",
        torrentProvider: "",
        defaultTorrentClient: "none",
        enableTorrentStreaming: false,
        debridProvider: "none",
        debridApiKey: "",
    })
}
