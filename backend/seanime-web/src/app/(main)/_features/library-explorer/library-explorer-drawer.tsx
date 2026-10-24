import { __unmatchedFileManagerIsOpen } from "@/app/(main)/_features/anime-library/_containers/unmatched-file-manager"
import { LibraryExplorerPhone } from "@/app/(main)/_features/library-explorer/library-explorer-phone"
import { ScopeProvider } from "jotai-scope"
import React from "react"

export function LibraryExplorerDrawer(props: {}) {
    // Phones: folders one level at a time in a sheet, instead of the tree that only renders on large screens
    return <ScopeProvider atoms={[__unmatchedFileManagerIsOpen]}><LibraryExplorerPhone /></ScopeProvider>
}
