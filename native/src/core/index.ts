// geschrieben nach: Plan „Eigener Kern" §5.2/§5.3 (eine Naht in buildSeaQuery, Kern ohne Oberfläche)

/*
 * The app's own core: what the Go server does today, written anew in TypeScript, moved over area by area
 * (docs/EIGENER-KERN.md). Two rules hold for everything in this folder:
 *
 * - The core knows no screen: no React, no component, nothing of the app outside this folder. It runs in the logic tests
 *   without a device (core-boundary.test.ts keeps that true).
 * - The screens know only what this file exports, never what lies behind it.
 */

import { type CoreEnvironment, type CoreRequest, type CoreRoute, matchCoreRoute } from "./registry"

export { type LineWait, openCoreDatabase } from "./database/database"
export type { CoreDatabase } from "./database/database"
export type { SqlDriver } from "./database/migrations"
export { LONGEST_PIECE_MS, afterCallersTurn, createBlockingWatch, type PieceWhere } from "./blocking"
export type { BlockingWatch } from "./blocking"
export type { LocalFolderEntry, LocalFolders } from "./library/scan"
export { ANILIST_URL } from "./anilist/client"
export { anilistSyncState, sendWaitingChanges } from "./anilist/changes"
export { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, backupFileName, backupSummary, makeBackup, readBackup, restoreBackup } from "./backup/backup"
export type { BackupFile, BackupSummary, RestoreMode } from "./backup/backup"
export { watchAnilistState } from "./anilist/cache-only"
export { CoreError } from "./errors"
export { deviceSandboxEngine } from "./extensions/sandbox/device-engine"
export type { SandboxHostCall, SandboxNativeBox, SandboxNativeModule } from "./extensions/sandbox/device-engine"
export { DEFAULT_SANDBOX_LIMITS, SandboxError, openSandbox } from "./extensions/sandbox/sandbox"
export type { HostFunctions, Sandbox, SandboxEngine, SandboxErrorKind, SandboxLimits } from "./extensions/sandbox/sandbox"
export { piecesOverLimit, runSandboxSelfTest } from "./extensions/sandbox/selftest"
export { openExtensionSandbox } from "./extensions/helpers/helpers"
export type { ExtensionSandbox, ExtensionSandboxOptions, HelperFetch, HelperLogLevel } from "./extensions/helpers/helpers"
export type { SelfTestLine, SelfTestPiece, SelfTestReport } from "./extensions/sandbox/selftest"
export type { HiddenBrowser, HiddenPage } from "./extensions/browser/browser"
export { createExtensionBrowser } from "./extensions/browser/cloudflare"
export type { CloudflareEvent, ExtensionBrowser } from "./extensions/browser/cloudflare"
export { CORE_EVENT_TYPES, emitCoreEvent, onCoreEvent } from "./events"
export type { CoreEvent, CoreEventListener, CoreEventType } from "./events"
export { ACCOUNT_TOKEN_SECRET, MOVE_PARTS, moveFromServer, moveFromServerOnce, moveSummary } from "./move/move"
export type { MoveEnvironment, MoveOutcome, MovePart, MoveResult, OldData, OldTable, SecretStore } from "./move/move"
export type { CoreEnvironment, CoreMethod, CoreRequest, CoreRoute } from "./registry"
export { CORE_ROUTES } from "./registry"
export { closeExtensionSandboxes, openExtensionSandboxes, setSandboxSettings } from "./extensions/manage/manage"
export { placeWithWaits } from "./extensions/manage/installed"
export type { ExtensionFolder, ExtensionPlace } from "./extensions/manage/installed"
export { LOADER_FAILURE_KINDS, LOADER_STATES, continuedRequest, rangeOutcome, readLoaderEvent, readLoaderStatus, worthAnotherTry } from "./download/loader"
export type { LoaderPart, LoaderDone, LoaderEvent, LoaderFailed, LoaderFailureKind, LoaderProgress, LoaderRequest, LoaderState, LoaderStatus, NativeLoader } from "./download/loader"
export { OFFLINE_EVENT, offlineArtworkAddress, offlineFileAddress, repeatOldEpisodes } from "./offline/offline"
export { folderName as mangaFolderName, repeatOldChapters } from "./manga/downloads"
export { OLD_MANGA_FOLDER, type OldChapterFolder } from "./manga/legacy"
export { OLD_OFFLINE_FOLDER } from "./offline/legacy"
export { hearPlayer, playingOf } from "./playback/playback"
export { hearPlaylist, playlistHearsPlayer, type PlaylistMessage } from "./playback/playlists"
export type { PlayerMessage } from "./playback/playback"
export type { OfflineDevice, OfflineItem, OfflineNetwork, OfflineSnapshot } from "./offline/offline"
export { CORE_AREAS, isCoreArea } from "./switches"
export type { CoreArea } from "./switches"
export { runningTorrentStream, torrentHearsPlayer } from "./torrent/torrent"
export { resumeClientAtStart } from "./torrent/client"
export { chooseTorrent } from "./torrent/autoselect"
export type { AutoSelectProfile, FoundTorrent } from "./torrent/autoselect"
export type { TorrentDevice, TorrentDeviceFile, TorrentDeviceStatus, TorrentSessionSettings } from "./torrent/torrent"
export { castSource, forward as castForward, forwardClose as castForwardClose, kindOf as castKindOf, searchRenderers, soap as castSoap } from "./cast/cast"
export type { CastOutlet, CastSearcher } from "./cast/cast"
export { SSDP_HOST, SSDP_PORT } from "./cast/upnp"
export { askNakamaStatus, nakamaAtStart } from "./nakama/guest"
export type { NakamaSocket, NakamaSocketOpener } from "./nakama/guest"

/**
 * The core's answer to a request, or null when the core has no code for the interface (the request then fails at once,
 * the app runs without its server). The returned function gives what the server put under "data", or throws.
 */
export function coreAnswerFor(
    method: string,
    endpoint: string,
    routes?: CoreRoute[],
): ((request: Pick<CoreRequest, "query" | "body">, environment: CoreEnvironment) => Promise<unknown>) | null {
    const match = matchCoreRoute(method, endpoint, routes)
    if (!match) return null
    // a hook that put its query into the address ("…/marketplace?marketplace=…") passes no query of its own
    const search = endpoint.split("#")[0].split("?")[1]
    const fromAddress = search ? Object.fromEntries(new URLSearchParams(search)) : undefined
    return (request, environment) => match.route.answer({ ...request, query: request.query ?? fromAddress, path: match.path }, environment)
}
