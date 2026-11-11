import { useRefreshAnimeCollection } from "@/api/hooks/anilist.hooks"
import { NavBar, NavMenu, type NavMenuAction, NavRail, useNavItems } from "@/components/navigation/app-navigation"
import { CoverFlightHost } from "@/components/shared/cover-flight"
import { renderPage } from "@/components/ui/core/page-transition"
import { useRouter } from "@/lib/navigation"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { isLoginModalOpenAtom } from "@/main/_atoms/server-status.atoms"
import { LibraryStatus } from "@/main/_features/anime-library/_containers/library-status"
import { LibraryExplorerPhone } from "@/main/_features/library-explorer/library-explorer-phone"
import { ContentGate } from "@/main/_features/content-gate/content-gate"
import { MediaPreviewModal } from "@/main/_features/media/_containers/media-preview-phone"
import { MobileAnilistLogin } from "@/main/_features/navigation/anilist-login-mobile"
import { MobileTutorialListener } from "@/main/_features/tour/mobile-tutorial"
import { __plugin_sidebarItemsAtom, PluginManager } from "@/main/_features/plugin/plugin-manager"
import { NativePlayer } from "@/main/_features/player/native-player"
import { MangaReader } from "@/main/manga/_containers/chapter-reader/manga-reader"
import { MangaPreferencesSync, MangaSourceRefreshSync } from "@/main/manga/_lib/manga-preferences-sync"
import { useAnimeCollectionLoader } from "@/main/_hooks/anilist-collection-loader"
import { useAnimeLibraryCollectionLoader, useMangaCollectionLoader } from "@/main/_hooks/collection-loaders"
import { useCurrentUser, useServerStatus } from "@/main/_hooks/use-server-status"
import { nakamaModalOpenAtom, NakamaManager, useNakamaStatus } from "@/main/_features/nakama/nakama-manager"
import { nakamaBadge } from "@/main/_features/nakama/nakama-status"
import { useMiscEventListeners } from "@/main/_listeners/misc-events.listeners"
import { useAnimeCollectionListener } from "@/main/_listeners/anilist-collection.listeners"
import { useAuthEventListeners } from "@/main/_listeners/auth.listeners"
import { useExtensionListener } from "@/main/_listeners/extensions.listeners"
import { useInvalidateQueriesListener } from "@/main/_listeners/invalidate-queries.listeners"
import { useMangaListener } from "@/main/_listeners/manga.listeners"
import { MobileUpdateModal, MobileUpdatePanel } from "@/main/_features/update/mobile-update"
import { GlobalPlaylistManager } from "@/main/_features/playlists/_containers/global-playlist-manager"
import { MobilePlaylists } from "@/main/_features/playlists/_components/mobile-playlists"
import { ServerDataWrapper } from "@/main/server-data-wrapper"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { usePathname } from "expo-router"
import { TabList, Tabs, TabSlot, TabTrigger } from "expo-router/ui"
import React from "react"
import { View } from "react-native"

/*
 * The app's frame (web app/(main)/layout + the native bar of UIBottomNav.kt): every main screen is a tab of one headless
 * tab navigator, so the bar or rail stays while moving between them, as in the old app. The bar shows the user's entries
 * (useNavItems), the Menu the rest; the hidden TabList registers every screen of the group.
 * Phone: the bar over the bottom edge. Tablet (smaller screen side ≥ 600dp, window ≥ 600dp wide): the rail on the left,
 * on the shared ground with its brand tint easing out from the top (tablet.css).
 */
const TABLET_GROUND = "linear-gradient(180deg, rgba(97,82,223,0.16) 0px, rgba(97,82,223,0.13) 74px, rgba(97,82,223,0.102) 147px, rgba(97,82,223,0.078) 221px, rgba(97,82,223,0.058) 294px, rgba(97,82,223,0.04) 368px, rgba(97,82,223,0.026) 442px, rgba(97,82,223,0.014) 515px, rgba(97,82,223,0.0064) 589px, rgba(97,82,223,0.0016) 662px, rgba(97,82,223,0) 736px)"

export default function MainLayout() {
    return (
        <ServerDataWrapper>
            <MainFrame />
        </ServerDataWrapper>
    )
}

function MainFrame() {
    const pathname = usePathname()
    const router = useRouter()
    const { rail, shortRail } = useTabletLayout()
    const items = useNavItems()
    const [menuOpen, setMenuOpen] = React.useState(false)
    const user = useCurrentUser()
    const [loginModal, setLoginModal] = useAtom(isLoginModalOpenAtom)
    // Data loaders of the web main layout: library, AniList and manga collections in their atoms
    useAnimeLibraryCollectionLoader()
    useAnimeCollectionLoader()
    useMangaCollectionLoader()
    // Signing out sits in Settings › App › Account; signing in is a Menu action while no account is stored (main-sidebar.tsx)
    const menuActions: NavMenuAction[] = user?.isSimulated
        ? [{ id: "sign-in", label: "Sign in", icon: "fallback", onPress: () => setLoginModal(true) }]
        : []
    // Nakama opens its sheet from the Menu while it is turned on; a host shows its connected devices (main-sidebar.tsx)
    const serverStatus = useServerStatus()
    const nakamaStatus = useNakamaStatus()
    const setNakamaOpen = useSetAtom(nakamaModalOpenAtom)
    const nakamaPeers = nakamaBadge(nakamaStatus)
    if (serverStatus?.settings?.nakama?.enabled) {
        menuActions.push({ id: "nakama", label: nakamaPeers ? `Nakama · ${nakamaPeers}` : "Nakama", icon: "nakama", onPress: () => setNakamaOpen(true) })
    }
    // "Refresh AniList" always closes the sidebar list (main-sidebar.tsx); a second tap while it runs does nothing
    const { mutate: refreshAnimeCollection, isPending: isRefreshingAnimeCollection } = useRefreshAnimeCollection()
    menuActions.push({ id: "refresh-anilist", label: "Refresh AniList", icon: "refresh", onPress: () => { if (!isRefreshingAnimeCollection) refreshAnimeCollection() } })
    // A plugin's own page has its Menu entry (main-sidebar.tsx usePluginSidebarItems)
    const pluginPages = useAtomValue(__plugin_sidebarItemsAtom)
    for (const item of pluginPages) {
        menuActions.push({ id: `plugin-${item.extensionId}`, label: item.label || item.extensionId, icon: "extensions", onPress: () => router.push(`/webview?id=${encodeURIComponent(item.extensionId)}`) })
    }
    // The server's toasts (and the Nakama host's in the app's language)
    useMiscEventListeners()
    // The rest of the web main layout's listeners: queries the server says changed (extensions, AniList, manga downloads,
    // named queries) and a lost AniList login; without them an installed extension stayed missing until a manual refresh
    useAnimeCollectionListener()
    useExtensionListener()
    useMangaListener()
    useInvalidateQueriesListener()
    useAuthEventListeners()

    const go = (href: string) => {
        setMenuOpen(false)
        if (href !== pathname) router.push(href)
    }
    const navProps = {
        items,
        pathname,
        menuOpen,
        onNavigate: (item: { href: string | null }) => item.href && go(item.href),
        onMenu: () => setMenuOpen(open => !open),
    }

    return (
        // Back goes to the page the user came from (the old app's WebView history), not always to Home
        <Tabs style={{ flex: 1 }} options={{ backBehavior: "history" }}>
            <View className="flex-1 flex-row bg-background" style={rail ? { backgroundImage: TABLET_GROUND } : undefined}>
                {rail && <NavRail {...navProps} short={shortRail} />}
                <View className="flex-1">
                    <ContentGate pathname={pathname}>
                        {/* every page rises in once as it comes (page-transition.tsx) */}
                        <TabSlot renderFn={renderPage} detachInactiveScreens={false} />
                    </ContentGate>
                </View>
            </View>
            {/* The one player (E3, r22): full over everything (its own z-order), else the box on its anime page or the mini
                player – both under the bar, menu and sheets that follow */}
            <NativePlayer />
            <LibraryStatus />
            {!rail && <NavBar {...navProps} />}
            {/* a tapped cover flying into its page and back, over the page and the bar */}
            <CoverFlightHost />
            <NavMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                pathname={pathname}
                onOpen={go}
                rail={rail}
                barItems={items}
                actions={menuActions}
                header={<MobileUpdatePanel />}
            />
            <MobileUpdateModal />
            <MediaPreviewModal />
            <LibraryExplorerPhone />
            {/* Manga: source preferences from the server, the source refresh job, the reader over page and bar (2.8) */}
            <MangaPreferencesSync />
            <MangaSourceRefreshSync />
            <MangaReader />
            <NakamaManager />
            <GlobalPlaylistManager />
            <MobilePlaylists />
            <MobileAnilistLogin open={!!(loginModal && user?.isSimulated)} onOpenChange={setLoginModal} />
            {/* the setup tour on the first start (2.16) */}
            <MobileTutorialListener />
            {/* plugins: screen events, tray, action lists, dialogs, the "fixed" windows, the extension prompt (2.17) */}
            <PluginManager />
            <TabList style={{ display: "none" }}>
                <TabTrigger name="index" href="/" />
                <TabTrigger name="lists" href="/lists" />
                <TabTrigger name="discover" href="/discover" />
                <TabTrigger name="search" href="/search" />
                <TabTrigger name="android-downloads" href="/android-downloads" />
                <TabTrigger name="server-status" href="/server-status" />
                <TabTrigger name="building-blocks" href="/building-blocks" />
                <TabTrigger name="entry" href="/entry" />
                <TabTrigger name="schedule" href="/schedule" />
                <TabTrigger name="settings" href="/settings" />
                <TabTrigger name="manga/index" href="/manga" />
                <TabTrigger name="manga/entry" href="/manga/entry" />
                <TabTrigger name="extensions" href="/extensions" />
                <TabTrigger name="scan-summaries" href="/scan-summaries" />
                <TabTrigger name="custom-sources" href="/custom-sources" />
                <TabTrigger name="medialinks" href="/medialinks" />
                <TabTrigger name="webview" href="/webview" />
            </TabList>
        </Tabs>
    )
}
