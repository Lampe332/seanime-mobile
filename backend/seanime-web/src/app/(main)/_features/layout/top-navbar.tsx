import { HomeMobileHeader } from "../home/home-mobile-header"
import { LayoutHeaderBackground } from "@/app/(main)/_features/layout/_components/layout-header-background"
import { ManualProgressTrackingButton } from "@/app/(main)/_features/progress-tracking/manual-progress-tracking"
import { PlaybackManagerProgressTrackingButton } from "@/app/(main)/_features/progress-tracking/playback-manager-progress-tracking"
import { ChapterDownloadsButton } from "@/app/(main)/manga/_containers/chapter-downloads/chapter-downloads-button"
import { __manga_chapterDownloadsDrawerIsOpenAtom } from "@/app/(main)/manga/_containers/chapter-downloads/chapter-downloads-drawer"
import { cn } from "@/components/ui/core/styling"
import { VerticalMenu } from "@/components/ui/vertical-menu"
import { usePathname } from "@/lib/navigation"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useSetAtom } from "jotai/react"
import React from "react"
import { LuFolderDown } from "react-icons/lu"
import { PluginSidebarTray } from "../plugin/tray/plugin-sidebar-tray"

type TopNavbarProps = {
    children?: React.ReactNode
}

export function TopNavbar(props: TopNavbarProps) {

    const {
        children,
        ...rest
    } = props

    const pathname = usePathname()
    const mobileHome = pathname === "/"
    const NavbarFrame = mobileHome ? HomeMobileHeader : React.Fragment

    return (
        <>
            <div
                data-top-navbar
                data-home-navbar={mobileHome || undefined}
                data-entry-navbar={pathname === "/entry" || undefined}
                className={cn(
                    "w-full h-[5rem] relative overflow-hidden flex items-center",
                    mobileHome && "h-auto",
                )}
            >
                <NavbarFrame>
                <div
                    data-top-navbar-content-container
                    className="relative z-10 px-4 w-full flex flex-row md:items-center overflow-x-auto overflow-y-hidden"
                >
                    <div data-top-navbar-content className="flex items-center w-full gap-3 z-[90]">
                        <PlaybackManagerProgressTrackingButton />
                        <ManualProgressTrackingButton />
                        <div data-top-navbar-content-separator className="flex flex-1"></div>
                        <PluginSidebarTray />
                        <ChapterDownloadsButton />
                    </div>
                </div>
                </NavbarFrame>
                <LayoutHeaderBackground />
            </div>
        </>
    )
}


export function SidebarNavbar() {
    const ts = useThemeSettings()
    const pathname = usePathname()

    const openDownloadQueue = useSetAtom(__manga_chapterDownloadsDrawerIsOpenAtom)
    const isMangaPage = pathname.startsWith("/manga")

    if (!ts.hideTopNavbar) return null

    return (
        <div data-sidebar-navbar className="flex flex-col gap-1">
            <VerticalMenu
                data-sidebar-navbar-vertical-menu
                className="px-4"
                itemClass="relative"
                isSidebar
                items={[
                    ...(isMangaPage ? [
                        {
                            iconType: LuFolderDown,
                            name: "Manga Downloads",
                            onClick: () => {
                                openDownloadQueue(true)
                            },
                        },
                    ] : []),
                ]}
            />
            <div data-sidebar-navbar-playback-manager-progress-tracking-button className="flex justify-center">
                <PlaybackManagerProgressTrackingButton asSidebarButton />
            </div>
            <div data-sidebar-navbar-manual-progress-tracking-button className="flex justify-center">
                <ManualProgressTrackingButton asSidebarButton />
            </div>
        </div>
    )
}
