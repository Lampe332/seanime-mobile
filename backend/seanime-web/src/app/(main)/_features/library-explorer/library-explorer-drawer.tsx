import { __unknownMedia_drawerIsOpen } from "@/app/(main)/_features/anime-library/_containers/unknown-media-manager"
import { __unmatchedFileManagerIsOpen } from "@/app/(main)/_features/anime-library/_containers/unmatched-file-manager"
import { LibraryExplorer } from "@/app/(main)/_features/library-explorer/library-explorer"
import { LibraryExplorerPhone } from "@/app/(main)/_features/library-explorer/library-explorer-phone"
import { libraryExplorer_drawerOpenAtom } from "@/app/(main)/_features/library-explorer/library-explorer.atoms"
import { isAndroidPhone } from "@/app/(main)/_features/video-core/video-core-menu"
import { cn } from "@/components/ui/core/styling"
import { Vaul, VaulContent } from "@/components/vaul"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { ScopeProvider } from "jotai-scope"
import { useAtom } from "jotai/react"
import React from "react"

export function LibraryExplorerDrawer(props: {}) {

    const ts = useThemeSettings()
    const [open, setOpen] = useAtom(libraryExplorer_drawerOpenAtom)

    // Phones: folders one level at a time in a sheet, instead of the tree that only renders on large screens
    if (isAndroidPhone()) return <ScopeProvider atoms={[__unmatchedFileManagerIsOpen]}><LibraryExplorerPhone /></ScopeProvider>

    return (
        <Vaul
            open={open}
            onOpenChange={v => setOpen(v)}
        >

            <VaulContent
                className={cn(
                    "bg-gray-950 h-[90%] lg:h-[80%] bg-opacity-100 lg:mx-[2rem] overflow-hidden",
                )}
                // overlayClass="bg-gray-900/80"
            >
                <ScopeProvider atoms={[__unmatchedFileManagerIsOpen, __unknownMedia_drawerIsOpen]}>
                    <LibraryExplorer />
                </ScopeProvider>
                <div className="block lg:hidden">
                    <p className="text-center text-white text-lg font-semibold py-4">
                        Library explorer can only be rendered on larger screens.
                    </p>
                </div>
            </VaulContent>
        </Vaul>
    )

}
