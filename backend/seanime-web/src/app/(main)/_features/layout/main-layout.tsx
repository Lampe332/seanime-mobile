import { ScanProgressBar } from "@/app/(main)/_features/anime-library/_containers/scan-progress-bar"
import { ScannerModal } from "@/app/(main)/_features/anime-library/_containers/scanner-modal"
import { ErrorExplainer } from "@/app/(main)/_features/error-explainer/error-explainer"
import { IssueReport } from "@/app/(main)/_features/issue-report/issue-report"
import { LibraryExplorerDrawer } from "@/app/(main)/_features/library-explorer/library-explorer-drawer"
import { LibraryWatcher } from "@/app/(main)/_features/library-watcher/library-watcher"
import { MediaPreviewModal } from "@/app/(main)/_features/media/_containers/media-preview-modal"
import { MainSidebar } from "@/app/(main)/_features/navigation/main-sidebar"
import { GlobalPlaylistManager } from "@/app/(main)/_features/playlists/_containers/global-playlist-manager"
import { PlaylistListModal } from "@/app/(main)/_features/playlists/playlist-list-modal"
import { PluginManager } from "@/app/(main)/_features/plugin/plugin-manager"
import { PluginWebviewSlot } from "@/app/(main)/_features/plugin/webview/plugin-webviews"
import { ManualProgressTracking } from "@/app/(main)/_features/progress-tracking/manual-progress-tracking"
import { PlaybackManagerProgressTracking } from "@/app/(main)/_features/progress-tracking/playback-manager-progress-tracking"
import { SeaCommand } from "@/app/(main)/_features/sea-command/sea-command"
import { MobileTutorialListener } from "@/app/(main)/_features/tour/mobile-tutorial"

import { useAnimeCollectionLoader } from "@/app/(main)/_hooks/anilist-collection-loader"
import { useAnimeLibraryCollectionLoader } from "@/app/(main)/_hooks/anime-library-collection-loader"
import { useMangaCollectionLoader } from "@/app/(main)/_hooks/manga-collection-loader"
import { useMissingEpisodesLoader } from "@/app/(main)/_hooks/missing-episodes-loader"
import { useAnimeCollectionListener } from "@/app/(main)/_listeners/anilist-collection.listeners"
import { useAuthEventListeners } from "@/app/(main)/_listeners/auth.listeners.ts"
import { useExtensionListener } from "@/app/(main)/_listeners/extensions.listeners"
import { useExternalPlayerLinkListener } from "@/app/(main)/_listeners/external-player-link.listeners"
import { useMangaListener } from "@/app/(main)/_listeners/manga.listeners"
import { useMiscEventListeners } from "@/app/(main)/_listeners/misc-events.listeners"
import { useSyncListener } from "@/app/(main)/_listeners/sync.listeners"
import { useTorrentStreamListener } from "@/app/(main)/entry/_containers/torrent-stream/_lib/handle-torrent-stream"
import { PlaybackPlayPill } from "@/app/(main)/entry/_containers/torrent-stream/playback-play-pill"
import { ChapterDownloadsDrawer } from "@/app/(main)/manga/_containers/chapter-downloads/chapter-downloads-drawer"
import { MangaPreferencesSync, MangaSourceRefreshSync } from "@/app/(main)/manga/_lib/manga-preferences-sync"
import { AppLayout, AppLayoutContent, AppLayoutSidebar, AppSidebarProvider } from "@/components/ui/app-layout"
import React from "react"
import { useInvalidateQueriesListener } from "../../_listeners/invalidate-queries.listeners"
import { Announcements } from "../announcements"
import { NakamaManager } from "../nakama/nakama-manager"
import { NakamaWatchPartyChat, NakamaWatchPartyChatProvider } from "../nakama/nakama-watch-party-chat"
import { RateLimitLoader } from "../rate-limit-loader"
import { TopIndefiniteLoader } from "../top-indefinite-loader"

const NativePlayerLazyWrapper = React.lazy(() => import("@/app/(main)/_features/native-player/native-player-lazy-wrapper"))

export const MainLayout = ({ children }: { children: React.ReactNode }) => {
    return (
        <>
            <Loader />
            <MangaPreferencesSync />
            <MangaSourceRefreshSync />
            <ScanProgressBar />
            <LibraryWatcher />
            <ScannerModal />
            <PlaylistListModal />
            <GlobalPlaylistManager />
            <ChapterDownloadsDrawer />
            <PlaybackPlayPill />
            <MediaPreviewModal />
            <PlaybackManagerProgressTracking />
            <ManualProgressTracking />
            <IssueReport />
            <ErrorExplainer />
            <SeaCommand />
            <MobileTutorialListener />

            <PluginManager />
            {/* the built-in player for downloaded media and streams (directstream) */}
            <React.Suspense fallback={null}>
                <NativePlayerLazyWrapper />
            </React.Suspense>
            <NakamaManager />
            <NakamaWatchPartyChatProvider />
            <NakamaWatchPartyChat />
            <TopIndefiniteLoader />
            <RateLimitLoader />
            <Announcements />
            <LibraryExplorerDrawer />
            <PluginWebviewSlot slot="fixed" />

            <AppSidebarProvider>
                <AppLayout withSidebar sidebarSize="slim">
                    <AppLayoutSidebar>
                        <MainSidebar />
                    </AppLayoutSidebar>
                    <AppLayout>
                        <AppLayoutContent>
                            {children}
                        </AppLayoutContent>
                    </AppLayout>
                </AppLayout>
            </AppSidebarProvider>
        </>
    )
}

function Loader() {
    /**
     * Data loaders
     */
    useAnimeLibraryCollectionLoader()
    useAnimeCollectionLoader()
    useMangaCollectionLoader()
    useMissingEpisodesLoader()

    /**
     * Websocket listeners
     */
    useAnimeCollectionListener()
    useMiscEventListeners()
    useExtensionListener()
    useMangaListener()
    useExternalPlayerLinkListener()
    useSyncListener()
    useInvalidateQueriesListener()
    useTorrentStreamListener()
    useAuthEventListeners()

    return null
}
