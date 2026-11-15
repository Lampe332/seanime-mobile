// geschrieben nach: Aufzeichnung api-schreibend vom 13.11.2026 (SETTINGS.GettingStarted: Felder des Status und ihre Arten, der nachgestellte Nutzer ohne Konto), dem App-Code src/main/server-data-wrapper.tsx (Willkommen, erster Start) und docs/EIGENER-KERN.md §4e/§4p (Phase 5c-1); kein Server-Quelltext

import { eq } from "drizzle-orm"
import { type CoreDatabase, inOrder } from "../database/database"
import { account, serverAnswers } from "../database/schema"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import type { CoreEnvironment } from "../registry"

/*
 * The status while the app runs without its server (phase 5c-1, docs/EIGENER-KERN.md §4p). Settings, look and user are
 * the core's. What only the server program knows is its part as it last gave it; a device that never had a server
 * (or lost its kept part) gets the part a fresh server gives before anything was set up: nothing switched on, no
 * torrent client, no paid service. `serverReady` is true: nothing waits for a server that will not come.
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "database"> & Partial<Pick<CoreEnvironment, "secret">>

const STATUS_ENDPOINT = "/api/v1/status"

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The kinds of the recorded fields, with the values of a server that was never set up (no path, no account) */
export const SERVER_PART_WITHOUT_SERVER: Json = {
    os: "android",
    clientDevice: "",
    clientPlatform: "",
    clientUserAgent: "",
    dataDir: "",
    version: "",
    versionName: "",
    isOffline: false,
    mediastreamSettings: {
        id: 1, transcodeEnabled: false, transcodeHwAccel: "cpu", transcodeThreads: 0, transcodePreset: "fast",
        disableAutoSwitchToDirectPlay: false, directPlayOnly: false, preTranscodeEnabled: false, preTranscodeLibraryDir: "",
        ffmpegPath: "", ffprobePath: "", transcodeHwAccelCustomSettings: "",
    },
    torrentstreamSettings: {
        id: 1, enabled: false, autoSelect: true, preferredResolution: "", disableIPV6: false, downloadDir: "", addToLibrary: false,
        torrentClientHost: "", torrentClientPort: 0, streamingServerHost: "", streamingServerPort: 0, includeInLibrary: false,
        streamUrlAddress: "", slowSeeding: false, preloadNextStream: false, disableAcceleratedStartup: false,
    },
    debridSettings: {
        id: 1, enabled: false, provider: "", apiKey: "", includeDebridStreamInLibrary: false, streamAutoSelect: false, streamPreferredResolution: "",
    },
    anilistClientId: "",
    featureFlags: {},
    disabledFeatures: null,
    serverHasPassword: false,
    contentLocked: false,
}

/** The user without an account, as the status carries it: only its name, never a token (own text for the name) */
export const USER_WITHOUT_ACCOUNT: Json = { viewer: { name: "Guest" }, token: "", isSimulated: true }

/**
 * The user as the status carries it, from the account the move or a login brought, or null: no account, or no token in
 * the secured storage. The token itself is not part of the answer; no screen reads it from the status.
 */
export async function ownUser(database: CoreDatabase, environment: Partial<Pick<CoreEnvironment, "secret">>): Promise<Json | null> {
    const row = (await inOrder(database, () => database.select().from(account)))[0]
    if (!row?.viewer) return null
    let viewer: unknown
    try {
        viewer = JSON.parse(row.viewer)
    }
    catch {
        return null
    }
    if (!isRecord(viewer)) return null
    if (!environment.secret || !(await environment.secret(ACCOUNT_TOKEN_SECRET))) return null
    return { viewer, token: "", isSimulated: false }
}

/** The status without the server: its kept part (or the part of a server never set up), the core's own fields over it */
export async function statusWithoutServer(environment: Environment, own: { settings: Json | null, themeSettings: Json }): Promise<Json> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select({ answer: serverAnswers.answer }).from(serverAnswers).where(eq(serverAnswers.question, STATUS_ENDPOINT)))
    const kept = rows.length > 0 ? rows[0].answer : null
    const part = isRecord(kept) ? kept : SERVER_PART_WITHOUT_SERVER
    const user = await ownUser(database, environment) ?? USER_WITHOUT_ACCOUNT
    return { ...part, ...own, user, updating: false, serverReady: true }
}
