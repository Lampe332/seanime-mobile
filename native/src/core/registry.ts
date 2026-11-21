// geschrieben nach: App-Code src/api/generated/endpoints.ts (Adressen und Methoden der Schnittstellen) und Plan „Eigener Kern" §5.2

import {
    animeCollection,
    animeDetails,
    collectionTagsOf,
    listAnime,
    listManga,
    listRecentAiring,
    rawCollectionOf,
    studioDetails,
    viewerStats,
} from "./anilist/anilist"
import { cacheOnlyStatus, switchCacheOnly } from "./anilist/cache-only"
import { removeCacheBucket } from "./cache-bucket"
import { deleteListEntry, editListEntry, updateProgressOf, updateRepeat, uploadLocalLists } from "./anilist/changes"
import type { HttpFetch } from "./anilist/client"
import type { CoreDatabase } from "./database/database"
import { CoreError } from "./errors"
import { fetchExtensionManifest } from "./extensions/fetch-manifest"
import { editExtensionCode, installExtension, installRepository, setExtensionDisabled, uninstallExtension } from "./extensions/manage/install"
import type { ExtensionPlace } from "./extensions/manage/installed"
import {
    type ManageEnvironment,
    allExtensions,
    customSources,
    extensionPayload,
    extensionUserConfig,
    lastUpdateData,
    listExtensionData,
    mangaProviders,
    marketplaceExtensions,
    onlinestreamProviders,
    reloadExtension,
    saveExtensionUserConfig,
    torrentProviders,
} from "./extensions/manage/manage"
import { mangaCollection, latestChapterNumbers } from "./manga/library"
import { emptyMangaEntryCache, mangaChapters, mangaEntry, mangaEntryDetails, mangaManualMapping, mangaManualSearch, mangaMappingPreview, mangaMapping, mangaPages, removeMangaMapping } from "./manga/manga"
import { importMangaPreferences, mangaPreferencesOf, patchMangaPreference } from "./manga/preferences"
import { sourceRefreshJob, startSourceRefresh, stopSourceRefresh } from "./manga/source-refresh"
import {
    type MangaDownloadEnvironment,
    clearMangaDownloadQueue,
    deleteMangaDownloads,
    downloadMangaChapters,
    mangaDownloadData,
    mangaDownloadQueue,
    mangaDownloadedChapters,
    mangaDownloadsList,
    mangaPagesOrSaved,
    resetErroredMangaDownloads,
    startMangaDownloadQueue,
    stopMangaDownloadQueue,
} from "./manga/downloads"
import {
    firstStart,
    patchSetting,
    readHomeItems,
    saveMediaPlayerSettings,
    saveSettings,
    updateAppearance,
    updateHomeItems,
} from "./settings/settings"
import { startStatus, statusAfterSave } from "./start/start"
import { animeWithEpisodes, episodeCollection, libraryEntry } from "./library/library"
import { bulkLocalFiles, deleteLocalFiles, entryBulkAction, manualMatch, updateLocalFileData, updateLocalFiles } from "./library/local-files"
import { fileTree, folderSuggestions, refreshFileTree, removeEmptyDirectories, scanAtStart } from "./library/folders"
import { type LocalFolders, addUnknownMedia, playLocalFile, scanLocalFiles, scanSummaryList } from "./library/scan"
import { animeSchedule, ownLibraryCollection, refreshAnimeCollection, upcomingEpisodes } from "./library/home"
import { deleteMetadataParent, metadataParent, saveMetadataParent, silenceStatus, toggleSilence } from "./library/marks"
import { missedSequels } from "./anilist/sequels"
import { login, logout } from "./anilist/auth"
import { patchAppSwitches, readAppSwitches } from "./settings/incognito"
import { clearContinuityHistory, continuityHistory, continuityItem, historyMedia, removeContinuityItem, updateContinuityItem } from "./playback/playback"
import { allPlaylists, createPlaylist, deletePlaylist, playlistEpisodes, updatePlaylist } from "./playback/playlists"
import { type StreamEnvironment, deleteMapping, emptyCache, episodeList, episodeSource, getMapping, manualMapping, manualSearch } from "./streams/onlinestream"
import { type OfflineDevice, type OfflineEnvironment, offlineAction, offlineBatch, offlineDownload, offlineNetwork, offlinePosition, offlinePrefetch, offlineSnapshot, setOfflineSettings } from "./offline/offline"
import type { CoreArea } from "./switches"
import {
    type TorrentDevice,
    deleteTorrentBatchHistory,
    saveTorrentSettings,
    startTorrentStream,
    stopTorrentStream,
    torrentBatchHistory,
    torrentFilePreviews,
    withTorrentSettings,
} from "./torrent/torrent"
import { deleteAutoSelectProfile, getAutoSelectProfile, saveAutoSelectProfile } from "./torrent/autoselect"
import { keepTorrentStream, torrentClientAction, torrentClientDownload, torrentClientList } from "./torrent/client"
import { cancelDebridStream, debridFilePreviews, debridTorrents, saveDebridSettings, startDebridStream, withDebridSettings } from "./debrid/debrid"
import { REMOVED_ROUTES } from "./removed/removed"
import { type NakamaSocketOpener, hostShares, keepNakamaPassword, nakamaSettingsChanged, playHostFile, reconnectToHost, removeStaleConnections, touchesNakama, withHostFiles, withHostLibrary, withNakamaPassword } from "./nakama/guest"
import { searchTorrents } from "./torrent/search"
import { searchOtherSources } from "./tvmaze/tvmaze"
import { type CastOutlet, type CastSearcher, control as castControl, current as castCurrent, discover as castDiscover, forward as castForward, forwardClose as castForwardClose, load as castLoad, start as castStart, status as castStatus, stop as castStop, switchStream as castSwitchStream } from "./cast/cast"

/*
 * Which interfaces the core answers itself. An interface is written here once its code in the core is complete; the
 * address and method are the ones the hooks already use (src/api/generated/endpoints.ts), so no call site changes.
 * Whether a registered interface is really answered by the core is decided by its area's switch (switches.ts).
 */

export type CoreMethod = "POST" | "GET" | "PATCH" | "DELETE" | "PUT"

/** What the core needs from outside. Nothing here is React or a screen, so tests can hand in their own. */
export type CoreEnvironment = {
    fetch: HttpFetch
    /** A value of the device's secured storage (the AniList token), or null */
    secret: (name: string) => Promise<string | null>
    /** Writes a value of the device's secured storage, null forgets it (signing in and out, phase 5a-3); left out: not available */
    keepSecret?: (name: string, value: string | null) => Promise<void>
    /** The app's version and build (a new build brings a new server program); left out: "" */
    appBuild?: () => string
    /** The core's own database, opened and brought up to date on first use */
    database: () => Promise<CoreDatabase>
    /** The time, in milliseconds since 1970 */
    now: () => number
    /**
     * Long work calls this between its small steps, so that it does not keep the screens' thread (blocking.ts): it
     * waits only when the work has run long. `part` names the work that follows.
     */
    pause: (part?: string) => Promise<void>
    /** Waits this long (AniList's rate limit, anilist/client.ts); left out: a timer */
    sleep?: (milliseconds: number) => Promise<void>
    /** A named measuring point for the watch of the screens' thread (blocking.ts `mark`); left out where nobody measures */
    mark?: (name: string) => void
    /**
     * The one AniList account the core may change, by AniList's number; null or left out: the account signed in. The
     * throw-away app names its test account here, so that it can never change a real one (anilist/changes.ts).
     */
    onlyAccount?: () => number | null
    /**
     * Runs work of the core that no request started (sending the waiting changes again after a while), so that the host
     * sees it like a request. Left out: the work just runs.
     */
    unasked?: (what: string, work: () => Promise<unknown>) => Promise<unknown>
    /** The server's extensions folder, its file cache (read only) and the sandboxes (phase 3e); left out: not available */
    extensions?: () => Promise<ExtensionPlace>
    /** The device's side of the downloads: loader, folder of the files, network (phase 4b-B); left out: not available */
    offline?: () => Promise<OfflineDevice>
    /** The rows of the server's table `playlists`, read once from its database (phase 5a-4); null: no database; left out: not available */
    serverPlaylists?: () => Promise<Record<string, unknown>[] | null>
    /** The device's library folders, read only (phase 5b-1, library/scan.ts); left out: not available */
    localFolders?: () => Promise<LocalFolders>
    /** The device's torrent session and its outlet for the player (phase 6b-2, torrent/torrent.ts); left out: not available */
    torrent?: () => Promise<TorrentDevice>
    /** The device's search into the home network for TVs, SSDP over multicast (phase 7c-1, cast/cast.ts); left out: not available */
    cast?: () => Promise<CastSearcher>
    /** The outlet into the local network for a TV (phase 7b, cast/cast.ts): files and torrent streams of the device; left out: not available */
    castOutlet?: () => Promise<CastOutlet>
    /** Opens a WebSocket with headers to a Nakama host (phase 7e, nakama/guest.ts); left out: not available */
    nakamaSocket?: NakamaSocketOpener
}

export type CoreRequest = {
    /** The `{name}` parts of the address, e.g. `{ id: "105333" }` */
    path: Record<string, string>
    /** The query (GET) as the hook passed it */
    query: unknown
    /** The body (POST, PATCH, …) as the hook passed it */
    body: unknown
}

export type CoreRoute = {
    area: CoreArea
    method: CoreMethod
    /** As in endpoints.ts, with `{name}` for the changing parts */
    endpoint: string
    /** Returns what the server put under "data" */
    answer: (request: CoreRequest, environment: CoreEnvironment) => Promise<unknown>
}

/** GET /api/v1/status (`saved` false) and the answer to a saved setting: with the core's torrent and debrid settings */
async function statusAnswer(environment: CoreEnvironment, saved = false): Promise<unknown> {
    const status = saved ? await statusAfterSave(environment) : await startStatus(environment)
    return withNakamaPassword(await withDebridSettings(await withTorrentSettings(status, environment), environment), environment)
}

function textField(body: unknown, name: string): string {
    const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined
    if (value === undefined || value === null) return ""
    if (typeof value !== "string") throw new CoreError(`${name} must be a text`)
    return value
}

async function manage(environment: CoreEnvironment): Promise<ManageEnvironment> {
    if (!environment.extensions) throw new CoreError("extensions are not available here")
    return {
        place: await environment.extensions(),
        database: environment.database,
        fetch: environment.fetch,
        now: environment.now,
    }
}

async function streams(environment: CoreEnvironment): Promise<StreamEnvironment> {
    return { manage: await manage(environment), core: environment }
}

async function offline(environment: CoreEnvironment): Promise<OfflineEnvironment> {
    if (!environment.offline) throw new CoreError("downloads are not available here")
    return {
        core: environment,
        device: await environment.offline(),
        // the extensions are opened when a download asks for its source, not before
        sources: async request => episodeSource(await streams(environment), request),
        episodes: mediaId => animeWithEpisodes(environment, mediaId),
    }
}

/** The manga downloads: the manga area's extensions and the device's loader (phase 4b-C2) */
async function mangaDownloadsOf(environment: CoreEnvironment): Promise<MangaDownloadEnvironment> {
    if (!environment.offline) throw new CoreError("downloads are not available here")
    return { manga: await streams(environment), device: await environment.offline(), unasked: environment.unasked }
}

export const CORE_ROUTES: CoreRoute[] = [
    // DLNA casting (phase 7c-1): the search answers at once, devices and the session's state follow as "dlna-cast" events
    { area: "cast", method: "POST", endpoint: "/api/v1/dlna-cast/discover", answer: (_request, environment) => castDiscover(environment) },
    { area: "cast", method: "POST", endpoint: "/api/v1/dlna-cast/start", answer: castStart },
    { area: "cast", method: "POST", endpoint: "/api/v1/dlna-cast/control", answer: castControl },
    { area: "cast", method: "POST", endpoint: "/api/v1/dlna-cast/status", answer: (_request, environment) => castStatus(environment) },
    { area: "cast", method: "POST", endpoint: "/api/v1/dlna-cast/stop", answer: castStop },
    { area: "cast", method: "GET", endpoint: "/api/v1/dlna-cast/current", answer: () => castCurrent() },
    { area: "cast", method: "POST", endpoint: "/api/v1/dlna-cast/load", answer: castLoad },
    { area: "cast", method: "POST", endpoint: "/api/v1/dlna-cast/switch-stream", answer: castSwitchStream },
    { area: "cast", method: "POST", endpoint: "/api/v1/dlna-cast/forward", answer: castForward },
    { area: "cast", method: "POST", endpoint: "/api/v1/dlna-cast/forward-close", answer: (_request, environment) => castForwardClose(environment) },
    // offline (phase 4b-B): the episodes saved on the device, queue and state in core.db, files by the device's loader (offline/, §4o)
    { area: "offline", method: "GET", endpoint: "/api/v1/mobile-offline/snapshot", answer: async (_request, environment) => offlineSnapshot(await offline(environment)) },
    { area: "offline", method: "POST", endpoint: "/api/v1/mobile-offline/batch", answer: async (request, environment) => offlineBatch(await offline(environment), request.body) },
    { area: "offline", method: "POST", endpoint: "/api/v1/mobile-offline/download", answer: async (request, environment) => offlineDownload(await offline(environment), request.body) },
    { area: "offline", method: "POST", endpoint: "/api/v1/mobile-offline/action", answer: async (request, environment) => offlineAction(await offline(environment), request.body) },
    { area: "offline", method: "POST", endpoint: "/api/v1/mobile-offline/settings", answer: async (request, environment) => setOfflineSettings(await offline(environment), request.body) },
    { area: "offline", method: "POST", endpoint: "/api/v1/mobile-offline/position", answer: async (request, environment) => offlinePosition(await offline(environment), request.body) },
    { area: "offline", method: "POST", endpoint: "/api/v1/mobile-offline/network", answer: async (request, environment) => offlineNetwork(await offline(environment), request.body) },
    { area: "offline", method: "POST", endpoint: "/api/v1/mobile-offline/prefetch", answer: async (request, environment) => offlinePrefetch(await offline(environment), request.body) },
    {
        area: "extensions",
        method: "POST",
        endpoint: "/api/v1/extensions/external/fetch",
        answer: (request, environment) => fetchExtensionManifest(textField(request.body, "manifestUri"), environment.fetch),
    },
    // extensions (phases 3e-1 and 3e-2): the management, installing, updating, editing, uninstalling and switching off;
    // plugins, the development mode and the playground stay with the server (docs/EIGENER-KERN.md §4l)
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/all", answer: async (request, environment) => allExtensions(await manage(environment), request.body) },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/list", answer: async (_request, environment) => listExtensionData(await manage(environment)) },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/list/anime-torrent-provider", answer: async (_request, environment) => torrentProviders(await manage(environment)) },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/list/manga-provider", answer: async (_request, environment) => mangaProviders(await manage(environment)) },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/list/onlinestream-provider", answer: async (_request, environment) => onlinestreamProviders(await manage(environment)) },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/list/custom-source", answer: async (_request, environment) => customSources(await manage(environment)) },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/payload/{id}", answer: async (request, environment) => extensionPayload(await manage(environment), request) },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/user-config/{id}", answer: async (request, environment) => extensionUserConfig(await manage(environment), request) },
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/user-config", answer: async (request, environment) => saveExtensionUserConfig(await manage(environment), request.body) },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/marketplace", answer: async (request, environment) => marketplaceExtensions(await manage(environment), request.query) },
    { area: "extensions", method: "GET", endpoint: "/api/v1/extensions/updates", answer: async (_request, environment) => lastUpdateData(await manage(environment)) },
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/external/install", answer: async (request, environment) => installExtension(await manage(environment), textField(request.body, "manifestUri")) },
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/external/install-repository", answer: async (request, environment) => installRepository(await manage(environment), request.body) },
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/external/uninstall", answer: async (request, environment) => uninstallExtension(await manage(environment), textField(request.body, "id")) },
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/external/edit-payload", answer: async (request, environment) => editExtensionCode(await manage(environment), request.body) },
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/external/disabled", answer: async (request, environment) => setExtensionDisabled(await manage(environment), request.body) },
    { area: "extensions", method: "POST", endpoint: "/api/v1/extensions/external/reload", answer: async (request, environment) => reloadExtension(await manage(environment), request.body) },
    // online streams (phase 3f-1): the extension's work in its sandbox, the user's mappings in core.db (streams/, §4m)
    { area: "streams", method: "POST", endpoint: "/api/v1/onlinestream/episode-list", answer: async (request, environment) => episodeList(await streams(environment), request.body) },
    { area: "streams", method: "POST", endpoint: "/api/v1/onlinestream/episode-source", answer: async (request, environment) => episodeSource(await streams(environment), request.body) },
    { area: "streams", method: "POST", endpoint: "/api/v1/onlinestream/get-mapping", answer: async (request, environment) => getMapping(await streams(environment), request.body) },
    { area: "streams", method: "POST", endpoint: "/api/v1/onlinestream/search", answer: async (request, environment) => manualSearch(await streams(environment), request.body) },
    { area: "streams", method: "POST", endpoint: "/api/v1/onlinestream/manual-mapping", answer: async (request, environment) => manualMapping(await streams(environment), request.body) },
    { area: "streams", method: "POST", endpoint: "/api/v1/onlinestream/remove-mapping", answer: async (request, environment) => deleteMapping(await streams(environment), request.body) },
    { area: "streams", method: "DELETE", endpoint: "/api/v1/onlinestream/cache", answer: async (request, environment) => emptyCache(await streams(environment), request.body) },
    // Settings → Logs & cache: one bucket of what the core keeps of the sources, for every entry (cache-bucket.ts)
    { area: "streams", method: "DELETE", endpoint: "/api/v1/filecache/bucket", answer: async request => removeCacheBucket(request.body) },
    // manga, reading (phase 4a-1): the extension's work in its sandbox, the manga page from AniList (manga/, §4n)
    { area: "manga", method: "GET", endpoint: "/api/v1/manga/entry/{id}", answer: async (request, environment) => mangaEntry(await streams(environment), request) },
    { area: "manga", method: "GET", endpoint: "/api/v1/manga/entry/{id}/details", answer: async (request, environment) => mangaEntryDetails(await streams(environment), request) },
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/chapters", answer: async (request, environment) => mangaChapters(await streams(environment), request.body) },
    // a chapter the core saved comes from its files (downloads.ts); without the device's downloads as before
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/pages", answer: async (request, environment) => environment.offline ? mangaPagesOrSaved(await mangaDownloadsOf(environment), request.body) : mangaPages(await streams(environment), request.body) },
    // manga downloads (phase 4b-C2): queue and list in core.db, the pages of a chapter as one request of the loader (manga/downloads.ts, §4o)
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/download-chapters", answer: async (request, environment) => downloadMangaChapters(await mangaDownloadsOf(environment), request.body) },
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/download-data", answer: async (request, environment) => mangaDownloadData(await mangaDownloadsOf(environment), request.body) },
    { area: "manga", method: "GET", endpoint: "/api/v1/manga/download-queue", answer: async (_request, environment) => mangaDownloadQueue(await mangaDownloadsOf(environment)) },
    { area: "manga", method: "GET", endpoint: "/api/v1/manga/downloads", answer: async (_request, environment) => mangaDownloadsList(await mangaDownloadsOf(environment)) },
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/download-queue/start", answer: async (_request, environment) => startMangaDownloadQueue(await mangaDownloadsOf(environment)) },
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/download-queue/stop", answer: async (_request, environment) => stopMangaDownloadQueue(await mangaDownloadsOf(environment)) },
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/download-queue/reset-errored", answer: async (_request, environment) => resetErroredMangaDownloads(await mangaDownloadsOf(environment)) },
    { area: "manga", method: "DELETE", endpoint: "/api/v1/manga/download-queue", answer: async (_request, environment) => clearMangaDownloadQueue(await mangaDownloadsOf(environment)) },
    { area: "manga", method: "DELETE", endpoint: "/api/v1/manga/download-chapter", answer: async (request, environment) => deleteMangaDownloads(await mangaDownloadsOf(environment), request.body) },
    { area: "manga", method: "GET", endpoint: "/api/v1/manga/downloaded-chapters/{id}", answer: async (request, environment) => mangaDownloadedChapters(await mangaDownloadsOf(environment), request) },
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/get-mapping", answer: async (request, environment) => mangaMapping(await streams(environment), request.body) },
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/search", answer: async (request, environment) => mangaManualSearch(await streams(environment), request.body) },
    // manga, the rest without downloads (phase 4a-2): mappings, cache, the user's sources and filters, the library (§4n)
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/manual-mapping", answer: async (request, environment) => mangaManualMapping(await streams(environment), request.body) },
    // phase 5a-2b: the summary of a chosen entry before it is kept (manga.ts)
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/manual-mapping/preview", answer: async (request, environment) => mangaMappingPreview(await streams(environment), request.body) },
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/remove-mapping", answer: async (request, environment) => removeMangaMapping(await streams(environment), request.body) },
    { area: "manga", method: "DELETE", endpoint: "/api/v1/manga/entry/cache", answer: async (request, environment) => emptyMangaEntryCache(await streams(environment), request.body) },
    { area: "manga", method: "GET", endpoint: "/api/v1/manga/preferences", answer: async (_request, environment) => mangaPreferencesOf(await streams(environment)) },
    // phase 7f: the source refresh without the server, own rule (manga/source-refresh.ts); with the server it is its job
    { area: "manga", method: "GET", endpoint: "/api/v1/manga/source-refresh", answer: async () => sourceRefreshJob() },
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/source-refresh", answer: async (request, environment) => startSourceRefresh(await streams(environment), request.body) },
    { area: "manga", method: "DELETE", endpoint: "/api/v1/manga/source-refresh", answer: async () => stopSourceRefresh() },
    { area: "manga", method: "PATCH", endpoint: "/api/v1/manga/preferences/{mediaId}", answer: async (request, environment) => patchMangaPreference(await streams(environment), request) },
    { area: "manga", method: "POST", endpoint: "/api/v1/manga/preferences/import", answer: async (request, environment) => importMangaPreferences(await streams(environment), request.body) },
    { area: "manga", method: "GET", endpoint: "/api/v1/manga/collection", answer: mangaCollection },
    { area: "manga", method: "GET", endpoint: "/api/v1/manga/latest-chapter-numbers", answer: async (_request, environment) => latestChapterNumbers(await streams(environment)) },
    // settings (stage 1b). The status is the server's except for its settings and look (settings/settings.ts); with the
    // area `anilist` on as well, the core answers it before the server runs (start/start.ts, stage 2c).
    { area: "settings", method: "GET", endpoint: "/api/v1/status", answer: (_request, environment) => statusAnswer(environment) },
    // saved by the server, its answer kept for the core's own status (start/start.ts, phase 5a-1); with the area
    // `torrent` on the core keeps the torrent stream settings itself (torrent/torrent.ts, phase 6b-2)
    {
        area: "settings",
        method: "PATCH",
        endpoint: "/api/v1/torrentstream/settings",
        answer: saveTorrentSettings,
    },
    // torrent (phase 6b-2): streams by the device's own torrent session, the file served by the module's outlet and
    // played by the app's player; since 6c-1 also auto select and the provider's magnet link; debrid stays with the server (6c-2)
    { area: "torrent", method: "POST", endpoint: "/api/v1/torrentstream/start", answer: (request, environment) => startTorrentStream(request, environment, () => streams(environment)) },
    { area: "torrent", method: "POST", endpoint: "/api/v1/torrentstream/stop", answer: stopTorrentStream },
    // 4.2.0, the app's own: "Keep in library" in the player, the stream's torrent into the torrent client
    { area: "torrent", method: "POST", endpoint: "/api/v1/torrentstream/keep", answer: keepTorrentStream },
    { area: "torrent", method: "POST", endpoint: "/api/v1/torrentstream/torrent-file-previews", answer: (request, environment) => torrentFilePreviews(request, environment, () => streams(environment)) },
    // torrent client (phase 6f): downloads in the same session, kept across restarts, into the library's folder
    { area: "torrent", method: "GET", endpoint: "/api/v1/torrent-client/list", answer: torrentClientList },
    { area: "torrent", method: "POST", endpoint: "/api/v1/torrent-client/action", answer: torrentClientAction },
    { area: "torrent", method: "POST", endpoint: "/api/v1/torrent-client/download", answer: (request, environment) => torrentClientDownload(request, environment, () => streams(environment)) },
    // torrent search (phase 6c-1): the provider extensions in their sandboxes, the auto-select profile in core.db
    { area: "torrent", method: "POST", endpoint: "/api/v1/torrent/search", answer: async (request, environment) => searchTorrents(await streams(environment), request.body) },
    { area: "torrent", method: "GET", endpoint: "/api/v1/auto-select/profile", answer: getAutoSelectProfile },
    { area: "torrent", method: "POST", endpoint: "/api/v1/auto-select/profile", answer: saveAutoSelectProfile },
    { area: "torrent", method: "DELETE", endpoint: "/api/v1/auto-select/profile", answer: deleteAutoSelectProfile },
    { area: "torrent", method: "POST", endpoint: "/api/v1/torrentstream/batch-history", answer: torrentBatchHistory },
    { area: "torrent", method: "POST", endpoint: "/api/v1/torrentstream/batch-history/delete", answer: deleteTorrentBatchHistory },
    // with the area `debrid` on the core keeps the debrid settings itself, the key in the secured storage (debrid/debrid.ts, phase 6c-2)
    {
        area: "settings",
        method: "PATCH",
        endpoint: "/api/v1/debrid/settings",
        answer: saveDebridSettings,
    },
    // debrid (phase 6c-2): the service's public API, its direct download address played by the app's player; adding
    // torrents to download them into a folder (POST /debrid/torrents) stays with the server
    { area: "debrid", method: "GET", endpoint: "/api/v1/debrid/torrents", answer: debridTorrents },
    { area: "debrid", method: "POST", endpoint: "/api/v1/debrid/torrents/file-previews", answer: (request, environment) => debridFilePreviews(request, environment, () => streams(environment)) },
    { area: "debrid", method: "POST", endpoint: "/api/v1/debrid/stream/start", answer: (request, environment) => startDebridStream(request, environment, () => streams(environment)) },
    { area: "debrid", method: "POST", endpoint: "/api/v1/debrid/stream/cancel", answer: request => cancelDebridStream(request) },
    { area: "settings", method: "POST", endpoint: "/api/v1/start", answer: (request, environment) => firstStart(request.body, environment) },
    { area: "settings", method: "PATCH", endpoint: "/api/v1/settings", answer: async (request, environment) => {
        await saveSettings(await keepNakamaPassword(request.body, environment), environment)
        if (touchesNakama(request.body)) void nakamaSettingsChanged(environment).catch(() => {})
        return statusAnswer(environment, true)
    } },
    // the app's own switches (incognito mode, "Delete watched episodes"), beside the server's settings
    { area: "settings", method: "GET", endpoint: "/api/v1/app-switches", answer: readAppSwitches },
    { area: "settings", method: "PATCH", endpoint: "/api/v1/app-switches", answer: patchAppSwitches },
    { area: "settings", method: "PATCH", endpoint: "/api/v1/settings/path", answer: async (request, environment) => {
        await patchSetting(await keepNakamaPassword(request.body, environment), environment)
        if (touchesNakama(request.body)) void nakamaSettingsChanged(environment).catch(() => {})
        return statusAnswer(environment, true)
    } },
    {
        area: "settings",
        method: "PATCH",
        endpoint: "/api/v1/settings/media-player",
        answer: (request, environment) => saveMediaPlayerSettings(request.body, environment),
    },
    { area: "settings", method: "PATCH", endpoint: "/api/v1/theme", answer: (request, environment) => updateAppearance(request.body, environment) },
    { area: "settings", method: "GET", endpoint: "/api/v1/status/home-items", answer: (_request, environment) => readHomeItems(environment) },
    { area: "settings", method: "POST", endpoint: "/api/v1/status/home-items", answer: (request, environment) => updateHomeItems(request.body, environment) },
    // anilist (stage 2a): reading
    { area: "anilist", method: "GET", endpoint: "/api/v1/anilist/collection", answer: animeCollection },
    { area: "anilist", method: "GET", endpoint: "/api/v1/anilist/collection/raw", answer: rawCollectionOf("ANIME") },
    { area: "anilist", method: "GET", endpoint: "/api/v1/anilist/collection/raw/tags", answer: collectionTagsOf("ANIME") },
    { area: "anilist", method: "GET", endpoint: "/api/v1/manga/anilist/collection/raw", answer: rawCollectionOf("MANGA") },
    { area: "anilist", method: "GET", endpoint: "/api/v1/manga/anilist/collection/raw/tags", answer: collectionTagsOf("MANGA") },
    { area: "anilist", method: "GET", endpoint: "/api/v1/anilist/media-details/{id}", answer: animeDetails },
    { area: "anilist", method: "GET", endpoint: "/api/v1/anilist/studio-details/{id}", answer: studioDetails },
    { area: "anilist", method: "POST", endpoint: "/api/v1/anilist/list-anime", answer: listAnime },
    // the other sources (TVmaze, tvmaze/tvmaze.ts): titles AniList does not have, in the form of its search
    {
        area: "anilist",
        method: "POST",
        endpoint: "/api/v1/other-sources/search",
        answer: (request, environment) => searchOtherSources(environment, typeof (request.body as { query?: unknown } | null | undefined)?.query === "string" ? (request.body as { query: string }).query : ""),
    },
    { area: "anilist", method: "POST", endpoint: "/api/v1/manga/anilist/list", answer: listManga },
    { area: "anilist", method: "POST", endpoint: "/api/v1/anilist/list-recent-anime", answer: listRecentAiring },
    { area: "anilist", method: "GET", endpoint: "/api/v1/anilist/stats", answer: viewerStats },
    // anilist: cache-only mode, the switch in the settings (anilist/cache-only.ts)
    { area: "anilist", method: "GET", endpoint: "/api/v1/anilist/cache-layer/status", answer: async request => cacheOnlyStatus(request) },
    { area: "anilist", method: "POST", endpoint: "/api/v1/anilist/cache-layer/status", answer: async request => switchCacheOnly(request) },
    // anilist (phase 5a-3): "Refresh AniList" reads the lists again (the GET above always asks AniList), the missed sequels
    { area: "anilist", method: "POST", endpoint: "/api/v1/anilist/collection", answer: refreshAnimeCollection },
    { area: "anilist", method: "GET", endpoint: "/api/v1/anilist/list-missed-sequels", answer: missedSequels },
    // anilist (phase 5a-3): signing in and out, the token in the secured storage (anilist/auth.ts)
    { area: "anilist", method: "POST", endpoint: "/api/v1/auth/login", answer: login },
    { area: "anilist", method: "POST", endpoint: "/api/v1/auth/logout", answer: logout },
    // anilist (stage 2b): changing a list entry, through the queue of anilist/changes.ts
    { area: "anilist", method: "POST", endpoint: "/api/v1/anilist/list-entry", answer: editListEntry },
    { area: "anilist", method: "DELETE", endpoint: "/api/v1/anilist/list-entry", answer: deleteListEntry },
    // the local account's lists, put aside at sign-in, to the signed-in AniList account (Settings → App → Local account)
    { area: "anilist", method: "POST", endpoint: "/api/v1/local/sync-simulated-to-anilist", answer: uploadLocalLists },
    { area: "anilist", method: "POST", endpoint: "/api/v1/library/anime-entry/update-progress", answer: updateProgressOf("ANIME") },
    { area: "anilist", method: "POST", endpoint: "/api/v1/library/anime-entry/update-repeat", answer: updateRepeat },
    { area: "anilist", method: "POST", endpoint: "/api/v1/manga/update-progress", answer: updateProgressOf("MANGA") },
    // start (stage 2c): the server's own answers, shown as it last gave them until it is ready (start/start.ts)
    // the home collection is asked at every start: with `library` on and "refresh when the app starts" set, the scan at start begins after it (5b-2)
    { area: "anilist", method: "GET", endpoint: "/api/v1/library/collection", answer: async (_request, environment) => (scanAtStart(environment), withHostLibrary(await ownLibraryCollection(environment), environment)) },
    { area: "anilist", method: "GET", endpoint: "/api/v1/library/anime-entry/{id}", answer: async (request, environment) => withHostFiles(await libraryEntry(request, environment), environment) },
    // Nakama as a guest (phase 7e): the connection to a host on a PC, its library and its files played from it
    { area: "settings", method: "POST", endpoint: "/api/v1/nakama/reconnect", answer: reconnectToHost },
    { area: "settings", method: "POST", endpoint: "/api/v1/nakama/cleanup", answer: () => removeStaleConnections() },
    { area: "settings", method: "GET", endpoint: "/api/v1/nakama/host/anime/library/shared", answer: hostShares },
    { area: "anilist", method: "POST", endpoint: "/api/v1/nakama/play", answer: playHostFile },
    // library (phase 5a-1): with the area on, the page above is built by the core as well (library/library.ts)
    { area: "library", method: "GET", endpoint: "/api/v1/anime/episode-collection/{id}", answer: episodeCollection },
    // library (phase 5a-3): home and schedule from the core's own lists, the marks of an anime's page in core.db (library/home.ts, marks.ts)
    { area: "library", method: "GET", endpoint: "/api/v1/library/upcoming-episodes", answer: upcomingEpisodes },
    { area: "library", method: "GET", endpoint: "/api/v1/library/schedule", answer: animeSchedule },
    { area: "library", method: "GET", endpoint: "/api/v1/library/anime-entry/silence/{id}", answer: silenceStatus },
    { area: "library", method: "POST", endpoint: "/api/v1/library/anime-entry/silence", answer: toggleSilence },
    { area: "library", method: "GET", endpoint: "/api/v1/metadata/parent/{id}", answer: metadataParent },
    { area: "library", method: "POST", endpoint: "/api/v1/metadata/parent", answer: saveMetadataParent },
    { area: "library", method: "DELETE", endpoint: "/api/v1/metadata/parent", answer: deleteMetadataParent },
    // library (phase 5b-1): the user's own video files, scanned and kept by the core, played by the app's player itself (library/scan.ts, local-files.ts)
    { area: "library", method: "POST", endpoint: "/api/v1/library/scan", answer: scanLocalFiles },
    { area: "library", method: "GET", endpoint: "/api/v1/library/scan-summaries", answer: scanSummaryList },
    // library (phase 5b-2): the explorer's file tree, empty folders, suggestions for a folder (library/folders.ts)
    { area: "library", method: "GET", endpoint: "/api/v1/library/explorer/file-tree", answer: fileTree },
    { area: "library", method: "POST", endpoint: "/api/v1/library/explorer/file-tree/refresh", answer: refreshFileTree },
    { area: "library", method: "DELETE", endpoint: "/api/v1/library/empty-directories", answer: removeEmptyDirectories },
    { area: "library", method: "POST", endpoint: "/api/v1/library/anime-entry/suggestions", answer: folderSuggestions },
    { area: "library", method: "PATCH", endpoint: "/api/v1/library/local-files", answer: updateLocalFiles },
    { area: "library", method: "PATCH", endpoint: "/api/v1/library/local-file", answer: updateLocalFileData },
    { area: "library", method: "DELETE", endpoint: "/api/v1/library/local-files", answer: deleteLocalFiles },
    { area: "library", method: "POST", endpoint: "/api/v1/library/local-files", answer: bulkLocalFiles },
    { area: "library", method: "PATCH", endpoint: "/api/v1/library/anime-entry/bulk-action", answer: entryBulkAction },
    { area: "library", method: "POST", endpoint: "/api/v1/library/anime-entry/manual-match", answer: manualMatch },
    { area: "library", method: "POST", endpoint: "/api/v1/library/unknown-media", answer: addUnknownMedia },
    { area: "library", method: "POST", endpoint: "/api/v1/directstream/play/localfile", answer: playLocalFile },
    { area: "library", method: "POST", endpoint: "/api/v1/playback-manager/play", answer: playLocalFile },
    // playback (phase 5a-2): the watch history in core.db; the player's videocore messages go to playback.ts hearPlayer
    { area: "playback", method: "GET", endpoint: "/api/v1/continuity/history", answer: continuityHistory },
    { area: "playback", method: "GET", endpoint: "/api/v1/continuity/item/{id}", answer: continuityItem },
    { area: "playback", method: "PATCH", endpoint: "/api/v1/continuity/item", answer: updateContinuityItem },
    // the History screen (the app's own): take one anime out, clear all, the titles it shows
    { area: "playback", method: "DELETE", endpoint: "/api/v1/continuity/item", answer: removeContinuityItem },
    { area: "playback", method: "DELETE", endpoint: "/api/v1/continuity/history", answer: clearContinuityHistory },
    { area: "playback", method: "POST", endpoint: "/api/v1/history/media", answer: historyMedia },
    { area: "playback", method: "GET", endpoint: "/api/v1/playlists", answer: allPlaylists },
    { area: "playback", method: "POST", endpoint: "/api/v1/playlist", answer: createPlaylist },
    { area: "playback", method: "PATCH", endpoint: "/api/v1/playlist", answer: updatePlaylist },
    { area: "playback", method: "DELETE", endpoint: "/api/v1/playlist", answer: deletePlaylist },
    { area: "playback", method: "GET", endpoint: "/api/v1/playlist/episodes/{id}", answer: playlistEpisodes },
    // given up without the server (phase 7a): plugins, Discord, issue reports, Nakama cloud rooms; with it unchanged
    ...REMOVED_ROUTES,
]

export type MatchedCoreRoute = { route: CoreRoute, path: Record<string, string> }

function decode(part: string): string {
    try {
        return decodeURIComponent(part)
    }
    catch {
        return part
    }
}

/**
 * The registered interface for a request, or null. `endpoint` is what a hook passes: the address with its `{name}`
 * parts filled in, sometimes with a query attached ("…/marketplace?marketplace=…"), which does not take part.
 */
export function matchCoreRoute(method: string, endpoint: string, routes: CoreRoute[] = CORE_ROUTES): MatchedCoreRoute | null {
    const parts = endpoint.split(/[?#]/)[0].split("/")
    for (const route of routes) {
        if (route.method !== method) continue
        const pattern = route.endpoint.split("/")
        if (pattern.length !== parts.length) continue
        const path: Record<string, string> = {}
        const fits = pattern.every((expected, index) => {
            const name = /^\{(\w+)\}$/.exec(expected)?.[1]
            if (!name) return expected === parts[index]
            if (!parts[index]) return false
            path[name] = decode(parts[index])
            return true
        })
        if (fits) return { route, path }
    }
    return null
}
