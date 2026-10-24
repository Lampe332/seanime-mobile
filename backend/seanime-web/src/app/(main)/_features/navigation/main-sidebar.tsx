import { useRefreshAnimeCollection } from "@/api/hooks/anilist.hooks"
import { openAndroidDownloads } from "@/lib/android-offline"
import { useLogout } from "@/api/hooks/auth.hooks"
import { useGetExtensionUpdateData as useGetExtensionUpdateData, usePluginWithIssuesCount } from "@/api/hooks/extensions.hooks"
import { isLoginModalOpenAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { MobileAnilistLogin } from "@/app/(main)/_features/navigation/anilist-login-mobile"
import { SidebarNavbar } from "@/app/(main)/_features/layout/top-navbar"
import { usePluginSidebarItems } from "@/app/(main)/_features/plugin/webview/plugin-sidebar"
import { MobileUpdateModal } from "@/app/(main)/_features/update/mobile-update-modal"
import { useMissingEpisodeCount } from "@/app/(main)/_hooks/missing-episodes-loader"
import { useCurrentUser, useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { AppSidebar, useAppSidebarContext } from "@/components/ui/app-layout"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/components/ui/core/styling"
import { VerticalMenu, VerticalMenuItem } from "@/components/ui/vertical-menu"
import { openTab } from "@/lib/helpers/browser"
import { usePathname } from "@/lib/navigation"
import { ANILIST_OAUTH_URL } from "@/lib/server/config"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useAtom } from "jotai"
import React from "react"
import { BiChevronRight, BiExtension, BiLogOut } from "react-icons/bi"
import { FiLogIn, FiSearch } from "react-icons/fi"
import { IoCloudOfflineOutline, IoHomeOutline } from "react-icons/io5"
import { LuBookOpen, LuCalendar, LuCompass, LuRefreshCw, LuSettings } from "react-icons/lu"
import { MdOutlineConnectWithoutContact } from "react-icons/md"
import { RiListCheck3 } from "react-icons/ri"
import { TbReportSearch } from "react-icons/tb"
import { nakamaModalOpenAtom, useNakamaStatus } from "../nakama/nakama-manager"

// Hidden at every width: UIBottomNav.kt builds the native nav and menu from these links and buttons.
export function MainSidebar() {
    const containerRef = React.useRef<HTMLDivElement>(null)
    const { mutate: logout } = useLogout()

    return (
        <AppSidebar
            ref={containerRef}
            className={cn(
                "h-full flex flex-col justify-between w-full overflow-x-hidden",
                // Enable scrolling but hide the scrollbar
                "overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']",
            )}
        >
            <SidebarNavigation containerRef={containerRef} />

            <div className="flex w-full gap-2 flex-col px-4 shrink-0 pb-2">
                <MobileUpdateModal />
                <SidebarFooter onLogout={logout} />
                <SidebarUser />
            </div>
        </AppSidebar>
    )
}


function SidebarNavigation({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
    const ctx = useAppSidebarContext()
    const ts = useThemeSettings()
    const pathname = usePathname()
    const serverStatus = useServerStatus()


    // Data
    const missingEpisodeCount = useMissingEpisodeCount()

    // Refresh AniList
    const { mutate: refreshAC, isPending: isRefreshingAC } = useRefreshAnimeCollection()

    // Items
    const items = React.useMemo(() => [
        {
            id: "android-downloads",
            iconType: IoCloudOfflineOutline,
            name: "Downloads",
            href: "/android-downloads",
            isCurrent: pathname === "/android-downloads",
            onClick: (event?: React.MouseEvent) => { event?.preventDefault(); openAndroidDownloads() },
        },
        {
            id: "home",
            iconType: IoHomeOutline,
            name: "Home",
            href: "/",
            isCurrent: pathname === "/",
        },
        // ...(import.meta.env.MODE === "development" ? [{
        //     id: "test",
        //     iconType: GrTest,
        //     name: "Test",
        //     href: "/test",
        //     isCurrent: pathname === "/test",
        // }] : []),
        {
            id: "schedule",
            iconType: LuCalendar,
            name: "Schedule",
            href: "/schedule",
            isCurrent: pathname === "/schedule",
            addon: missingEpisodeCount > 0 ? <Badge
                className="absolute right-0 top-0 bg-red-400" size="sm"
                intent="alert-solid"
            >{missingEpisodeCount}</Badge> : undefined,
        },
        ...serverStatus?.settings?.library?.enableManga ? [{
            id: "manga",
            iconType: LuBookOpen,
            name: "Manga",
            href: "/manga",
            isCurrent: pathname.startsWith("/manga"),
        }] : [],
        {
            id: "lists",
            iconType: RiListCheck3,
            name: "My lists",
            href: "/lists",
            isCurrent: pathname === "/lists",
        },
        {
            id: "discover",
            iconType: LuCompass,
            name: "Discover",
            href: "/discover",
            isCurrent: pathname === "/discover",
        },
        {
            id: "search",
            iconType: FiSearch,
            name: "Search",
            href: "/search",
            isCurrent: pathname === "/search",
        },
        ...(!!serverStatus?.settings?.library?.libraryPath) ? [{
            id: "scan-summaries",
            iconType: TbReportSearch,
            name: "Scan summaries",
            href: "/scan-summaries",
            isCurrent: pathname === "/scan-summaries",
        }] : [],
    ], [
        pathname,
        missingEpisodeCount,
        serverStatus?.settings?.library?.enableManga,
        serverStatus?.settings?.library?.libraryPath,
    ])

    // Plugins
    const pluginWebviewItems = usePluginSidebarItems()

    // Overflow logic
    const [autoUnpinnedIds, setAutoUnpinnedIds] = React.useState<string[]>([])
    const overflowCheckTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

    React.useEffect(() => {
        const handleResize = () => setAutoUnpinnedIds([])
        window.addEventListener("resize", handleResize)
        return () => window.removeEventListener("resize", handleResize)
    }, [])

    // The native "Customize navigation" reads these links, so the web "Unpinned menu items" setting is ignored
    const displayedPinnedItems = React.useMemo(() => {
        return items.filter(item => !autoUnpinnedIds.includes(item.id))
    }, [items, autoUnpinnedIds])

    const displayedPluginItems = React.useMemo(() => {
        return pluginWebviewItems.filter((item: any) => !autoUnpinnedIds.includes(item.id))
    }, [pluginWebviewItems, autoUnpinnedIds])

    const checkOverflow = React.useCallback(() => {
        if (!containerRef.current) return

        const { scrollHeight, clientHeight } = containerRef.current
        if (scrollHeight > clientHeight + 2) {
            if (displayedPluginItems.length > 0) {
                const lastPlugin = displayedPluginItems[displayedPluginItems.length - 1] as any
                if (lastPlugin?.id) {
                    setAutoUnpinnedIds(prev => {
                        if (prev.includes(lastPlugin.id)) return prev
                        return [...prev, lastPlugin.id]
                    })
                    return
                }
            }

            if (displayedPinnedItems.length > 1) {
                const lastItem = displayedPinnedItems[displayedPinnedItems.length - 1]
                setAutoUnpinnedIds(prev => {
                    if (prev.includes(lastItem.id)) return prev
                    return [...prev, lastItem.id]
                })
            }
        }
    }, [displayedPinnedItems, displayedPluginItems])

    React.useEffect(() => {
        if (!containerRef.current) return

        const observer = new ResizeObserver(() => {
            if (overflowCheckTimeoutRef.current) {
                clearTimeout(overflowCheckTimeoutRef.current)
            }
            overflowCheckTimeoutRef.current = setTimeout(() => {
                checkOverflow()
            }, 16)
        })

        observer.observe(containerRef.current)
        checkOverflow()

        return () => {
            observer.disconnect()
            if (overflowCheckTimeoutRef.current) {
                clearTimeout(overflowCheckTimeoutRef.current)
            }
        }
    }, [checkOverflow])

    const unpinnedMenuItems = React.useMemo(() => {
        const forcedUnpinned = items.filter(item => autoUnpinnedIds.includes(item.id))
        const forcedUnpinnedPlugins = pluginWebviewItems.filter(item => autoUnpinnedIds.includes(item.id))

        const allHidden = [...forcedUnpinnedPlugins, ...forcedUnpinned]

        if (allHidden.length === 0) return []

        return [
            {
                iconType: BiChevronRight,
                name: "More",
                subContent: <VerticalMenu
                    items={allHidden}
                    isSidebar
                />,
            } as VerticalMenuItem,
        ]
    }, [items, autoUnpinnedIds, pluginWebviewItems])

    return (
        <div>
            <div className="mb-4 p-4 pb-0 flex justify-center w-full">
                <img loading="lazy" decoding="async"
                    src="/seanime-logo.png"
                    alt="logo"
                    className="w-15 h-10 transition-all duration-300"
                />
            </div>
            <VerticalMenu
                className="px-4"
                itemClass="relative"
                itemChevronClass="hidden"
                itemIconClass="transition-transform group-data-[state=open]/verticalMenu_parentItem:rotate-90"
                items={[
                    ...displayedPinnedItems,
                    ...displayedPluginItems,
                    ...unpinnedMenuItems,
                    {
                        iconType: LuRefreshCw,
                        name: "Refresh AniList",
                        onClick: () => {
                            ctx.setOpen(false)
                            if (isRefreshingAC) return
                            refreshAC()
                        },
                    },
                ]}
                subContentClass={cn(ts.hideTopNavbar && "border-transparent !border-b-0")}
                onLinkItemClick={() => ctx.setOpen(false)}
                isSidebar
            />

            <SidebarNavbar />

        </div>
    )
}

function SidebarFooter({ onLogout }: { onLogout: () => void }) {
    const ctx = useAppSidebarContext()
    const pathname = usePathname()
    const serverStatus = useServerStatus()
    const user = useCurrentUser()

    // Extensions
    const { data: updateData } = useGetExtensionUpdateData()
    const pluginWithIssuesCount = usePluginWithIssuesCount()

    // Nakama
    const [nakamaModalOpen, setNakamaModalOpen] = useAtom(nakamaModalOpenAtom)
    const nakamaStatus = useNakamaStatus()

    // Sign out
    const confirmSignOut = useConfirmationDialog({
        title: "Sign out",
        description: "Are you sure you want to sign out?",
        onConfirm: () => {
            onLogout()
        },
    })
    // Login
    const [loginModal, setLoginModal] = useAtom(isLoginModalOpenAtom)


    return (
        <div>
            <VerticalMenu
                itemClass="relative"
                onLinkItemClick={() => ctx.setOpen(false)}
                isSidebar
                items={[
                    ...serverStatus?.settings?.nakama?.enabled ? [{
                        iconType: MdOutlineConnectWithoutContact,
                        iconClass: "size-6",
                        name: "Nakama",
                        isCurrent: nakamaModalOpen,
                        onClick: () => {
                            ctx.setOpen(false)
                            setNakamaModalOpen(true)
                        },
                        addon: <>
                            {nakamaStatus?.isHost && !!nakamaStatus?.connectedPeers?.length && <Badge
                                className="absolute right-0 top-0" size="sm"
                                intent="info"
                            >{nakamaStatus?.connectedPeers?.length}</Badge>}

                            {nakamaStatus?.isConnectedToHost && <div
                                className="absolute right-2 top-2 animate-pulse size-2 bg-green-500 rounded-full"
                            ></div>}
                        </>,
                    }] : [],
                    {
                        iconType: BiExtension,
                        name: "Extensions",
                        href: "/extensions",
                        isCurrent: pathname.includes("/extensions"),
                        addon: (!!updateData?.length || !!pluginWithIssuesCount)
                            ? <Badge
                                className="absolute right-0 top-0 bg-red-400 animate-pulse" size="sm"
                                intent="alert-solid"
                            >
                                {updateData?.length || pluginWithIssuesCount || 1}
                            </Badge>
                            : undefined,
                    },
                    {
                        iconType: LuSettings,
                        name: "Settings",
                        href: "/settings",
                        isCurrent: pathname === ("/settings"),
                    },
                    {
                        iconType: user?.isSimulated ? FiLogIn : BiLogOut,
                        name: user?.isSimulated ? "Sign in" : "Sign out",
                        onClick: user?.isSimulated ? () => setLoginModal(true) : confirmSignOut.open,
                    },
                ]}
            />
            <ConfirmationDialog {...confirmSignOut} />
        </div>
    )
}

function SidebarUser() {
    const ctx = useAppSidebarContext()
    const user = useCurrentUser()
    const [loginModal, setLoginModal] = useAtom(isLoginModalOpenAtom)

    return (
        <>
            {!user && (
                <div>
                    <VerticalMenu
                        itemClass="relative"
                        onLinkItemClick={() => ctx.setOpen(false)}
                        isSidebar
                        items={[
                            {
                                iconType: FiLogIn,
                                name: "Login",
                                onClick: () => openTab(ANILIST_OAUTH_URL),
                            },
                        ]}
                    />
                </div>
            )}

            <MobileAnilistLogin open={!!(loginModal && user?.isSimulated)} onOpenChange={setLoginModal} />
        </>
    )
}
