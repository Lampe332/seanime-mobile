// geschrieben nach: Aufzeichnung api-schreibend vom 13.11.2026 (SETTINGS.GettingStarted, THEME.UpdateTheme: Felder und Werte in STATUS.GetStatus vor und nach dem Aufruf)

/*
 * Which fields the settings and the look of the app have, read off the recorded answers. The kind of each value here
 * (text, number, yes/no, list) is the kind the field has; a field that is missing in a request gets the empty value of
 * its kind ("", 0, false, []).
 */

export type FieldValue = string | number | boolean | (string | number)[]
export type Fields = Record<string, FieldValue>

/** The sections of the settings, in the order the recorded answers list them */
export const SETTINGS_SECTIONS = ["library", "mediaPlayer", "torrent", "manga", "anilist", "autoDownloader", "discord", "notifications", "nakama"] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/** The sections a save of the settings carries; the others stay as they are. */
export const SAVED_SECTIONS = ["library", "mediaPlayer", "torrent", "anilist", "discord", "manga", "notifications", "nakama"] as const satisfies readonly SettingsSection[]

/**
 * The settings as recorded right after the first start of a fresh app. Section `autoDownloader` is not part of the
 * first-start request; these values are what the first start stores for it.
 */
export const SETTINGS_SHAPE: Record<SettingsSection, Fields> = {
    library: {
        libraryPath: "",
        autoUpdateProgress: true,
        disableUpdateCheck: false,
        torrentProvider: "",
        autoSelectTorrentProvider: "",
        autoScan: false,
        enableOnlinestream: true,
        includeOnlineStreamingInLibrary: true,
        disableAnimeCardTrailers: false,
        enableManga: true,
        dohProvider: "",
        openTorrentClientOnStart: false,
        openWebURLOnStart: false,
        refreshLibraryOnStart: false,
        autoPlayNextEpisode: false,
        enableWatchContinuity: true,
        libraryPaths: [],
        autoSyncOfflineLocalData: false,
        scannerMatchingThreshold: 0,
        scannerMatchingAlgorithm: "",
        autoSyncToLocalAccount: false,
        autoSaveCurrentMediaOffline: false,
        useFallbackMetadataProvider: false,
        scannerUseLegacyMatching: false,
        scannerConfig: "",
        updateChannel: "github",
        enableExtensionSecureMode: false,
        defaultPlaybackSource: "",
        showTorrentAvailability: false,
    },
    mediaPlayer: {
        defaultPlayer: "mpv",
        host: "127.0.0.1",
        vlcUsername: "",
        vlcPassword: "",
        vlcPort: 8080,
        vlcPath: "",
        mpcPort: 13579,
        mpcPath: "C:/Program Files/MPC-HC/mpc-hc64.exe",
        mpvSocket: "/tmp/mpv_socket",
        mpvPath: "",
        mpvArgs: "",
        iinaSocket: "/tmp/iina_socket",
        iinaPath: "",
        iinaArgs: "",
        vcTranslate: false,
        vcTranslateTargetLanguage: "",
        vcTranslateProvider: "",
        vcTranslateApiKey: "",
        vcTranslateBaseUrl: "",
        vcTranslateModel: "",
        mpvPrismLogging: false,
        mpvPrismEnabled: false,
        screenshotDir: "",
    },
    torrent: {
        defaultTorrentClient: "seanime",
        qbittorrentPath: "",
        qbittorrentHost: "127.0.0.1",
        qbittorrentPort: 8081,
        qbittorrentUsername: "",
        qbittorrentPassword: "",
        qbittorrentTags: "",
        qbittorrentCategory: "",
        transmissionPath: "",
        transmissionHost: "127.0.0.1",
        transmissionPort: 9091,
        transmissionUsername: "",
        transmissionPassword: "",
        seanimePort: 50007,
        seanimeMaxConnections: 50,
        seanimeDownloadLimit: 0,
        seanimeUploadLimit: 0,
        seanimeMaxActiveDownloads: 3,
        showActiveTorrentCount: false,
        hideTorrentList: false,
    },
    manga: {
        defaultMangaProvider: "",
        mangaAutoUpdateProgress: false,
        mangaLocalSourceDirectory: "",
    },
    anilist: {
        hideAudienceScore: false,
        enableAdultContent: false,
        blurAdultContent: false,
        disableCacheLayer: false,
    },
    autoDownloader: {
        provider: "",
        interval: 20,
        enabled: false,
        downloadAutomatically: true,
        enableEnhancedQueries: true,
        enableSeasonCheck: false,
        useDebrid: false,
    },
    discord: {
        enableRichPresence: false,
        enableAnimeRichPresence: true,
        enableMangaRichPresence: true,
        richPresenceHideSeanimeRepositoryButton: false,
        richPresenceShowAniListMediaButton: false,
        richPresenceShowAniListProfileButton: false,
        richPresenceUseMediaTitleStatus: false,
    },
    notifications: {
        disableNotifications: false,
        disableAutoDownloaderNotifications: false,
        disableAutoScannerNotifications: false,
    },
    nakama: {
        enabled: false,
        username: "",
        isHost: false,
        hostPassword: "",
        remoteServerURL: "",
        remoteServerPassword: "",
        includeNakamaAnimeLibrary: false,
        hostShareLocalAnimeLibrary: false,
        hostUnsharedAnimeIds: [],
        hostEnablePortForwarding: false,
    },
}

/**
 * What the first start stored differently from what the app sent (one recording, the request the app always sends:
 * `includeOnlineStreamingInLibrary: false`, `defaultTorrentClient: "none"`, `richPresenceUseMediaTitleStatus: true`).
 * The rule behind it is not visible in the recording, so the first start sets exactly these three values.
 */
export const FIRST_START_FIXED: Partial<Record<SettingsSection, Fields>> = {
    library: { includeOnlineStreamingInLibrary: true },
    torrent: { defaultTorrentClient: "seanime" },
    discord: { richPresenceUseMediaTitleStatus: false },
}

/**
 * The look of the app before anything was saved, in the order of the recorded answer. Two fields are not here because
 * they are no plain values: `unpinnedMenuItems` (a list of texts or null) and `homeItems` (always null in the answer;
 * the home items have their own interface and table).
 */
export const APPEARANCE_SHAPE: Fields = {
    enableColorSettings: false,
    backgroundColor: "",
    accentColor: "",
    sidebarBackgroundColor: "",
    animeEntryScreenLayout: "",
    expandSidebarOnHover: false,
    hideTopNavbar: false,
    enableMediaCardBlurredBackground: false,
    libraryScreenCustomBackgroundImage: "",
    libraryScreenCustomBackgroundOpacity: 0,
    smallerEpisodeCarouselSize: false,
    libraryScreenBannerType: "",
    libraryScreenCustomBannerImage: "",
    libraryScreenCustomBannerPosition: "",
    libraryScreenCustomBannerOpacity: 0,
    disableLibraryScreenGenreSelector: false,
    libraryScreenCustomBackgroundBlur: "",
    enableMediaPageBlurredBackground: false,
    disableSidebarTransparency: false,
    useLegacyEpisodeCard: false,
    disableCarouselAutoScroll: false,
    mediaPageBannerType: "",
    mediaPageBannerSize: "",
    mediaPageBannerInfoBoxSize: "",
    showEpisodeCardAnimeInfo: false,
    continueWatchingDefaultSorting: "",
    animeLibraryCollectionDefaultSorting: "",
    mangaLibraryCollectionDefaultSorting: "",
    showAnimeUnwatchedCount: false,
    showMangaUnreadCount: false,
    hideEpisodeCardDescription: false,
    hideDownloadedEpisodeCardFilename: false,
    customCSS: "",
    mobileCustomCSS: "",
    enableBlurringEffects: false,
    hideAnimeSpoilers: false,
    hideAnimeSpoilerThumbnails: false,
    hideAnimeSpoilerTitles: false,
    hideAnimeSpoilerDescriptions: false,
    hideAnimeSpoilerSkipNextEpisode: false,
}

/** The fields of the look that stand before `unpinnedMenuItems` and `homeItems` in the answer */
export const APPEARANCE_FIELDS_BEFORE_LISTS = Object.keys(APPEARANCE_SHAPE).indexOf("mobileCustomCSS") + 1

/** The time the server gives for "never" (a look that was not saved yet, and always the settings' creation time) */
export const NO_TIME = "0001-01-01T00:00:00Z"
