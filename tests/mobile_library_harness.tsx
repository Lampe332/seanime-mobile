import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDefaultStore } from "jotai"
import { useGetLibraryCollection } from "../backend/seanime-web/src/api/hooks/anime_collection.hooks"
import { __anilist_userAnimeMediaAtom } from "../backend/seanime-web/src/app/(main)/_atoms/anilist.atoms"
import { serverStatusAtom } from "../backend/seanime-web/src/app/(main)/_atoms/server-status.atoms"
import { BulkActionModal } from "../backend/seanime-web/src/app/(main)/_features/anime-library/_containers/bulk-action-modal"
import { IgnoredFileManager } from "../backend/seanime-web/src/app/(main)/_features/anime-library/_containers/ignored-file-manager"
import { ScanProgressBar } from "../backend/seanime-web/src/app/(main)/_features/anime-library/_containers/scan-progress-bar"
import { __scanner_isScanningAtom, ScannerModal } from "../backend/seanime-web/src/app/(main)/_features/anime-library/_containers/scanner-modal"
import { UnknownMediaManager } from "../backend/seanime-web/src/app/(main)/_features/anime-library/_containers/unknown-media-manager"
import { UnmatchedFileManager } from "../backend/seanime-web/src/app/(main)/_features/anime-library/_containers/unmatched-file-manager"
import { LibraryPhoneAction, LibraryPhoneAttention } from "../backend/seanime-web/src/app/(main)/_features/anime-library/_screens/library-phone"
import { LibraryExplorerDrawer } from "../backend/seanime-web/src/app/(main)/_features/library-explorer/library-explorer-drawer"
import { libraryExplorer_drawerOpenAtom, libraryExplorer_openDirectoryAtom } from "../backend/seanime-web/src/app/(main)/_features/library-explorer/library-explorer.atoms"
import { LibraryWatcher } from "../backend/seanime-web/src/app/(main)/_features/library-watcher/library-watcher"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"
import "../backend/seanime-web/src/app/(main)/_features/home/home-mobile.css"

// The real library containers as Home and the layout mount them on a phone: the header action and the queue rows in
// Android Home's header, the scanner, the three queue managers fed from the library collection query, the bulk action
// modal, the scan progress, the library watcher and the library explorer. window.server is the fixture server; a fake bottom bar marks where
// the app's native one sits.
const w = window as any
const store = getDefaultStore()
store.set(serverStatusAtom, w.server.status)
store.set(__anilist_userAnimeMediaAtom, w.server.userMedia)
w.store = store
w.atoms = { scanning: __scanner_isScanningAtom }
// "Open in library explorer" from a card: the folder, then the drawer
w.openExplorerAt = (path: string) => {
    store.set(libraryExplorer_openDirectoryAtom, path)
    store.set(libraryExplorer_drawerOpenAtom, true)
}
const client = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } })
w.queryClient = client

function Home() {
    const { data } = useGetLibraryCollection()
    return <>
        <header data-home-navbar><div className="home-mobile-header"><div className="home-mobile-heading"><h1>Home</h1></div>
            <div className="home-mobile-tools"><div className="home-mobile-actions"><LibraryPhoneAction /></div></div></div></header>
        <div data-home-mobile="true"><LibraryPhoneAttention /><p style={{ padding: "0 16px", height: 900 }}>Home content</p></div>
        <UnmatchedFileManager unmatchedGroups={data?.unmatchedGroups ?? []} />
        <UnknownMediaManager unknownGroups={data?.unknownGroups ?? []} onActionComplete={() => w.completed++} />
        <IgnoredFileManager files={data?.ignoredLocalFiles ?? []} />
        <BulkActionModal />
        <ScannerModal />
        <ScanProgressBar />
        <LibraryWatcher />
        <LibraryExplorerDrawer />
        <style>{"body:has(.UI-Modal__content[data-state=open]) #__seanime_bottom_nav { display: none }"}</style>
        <nav id="__seanime_bottom_nav" style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: "4.75rem", background: "#222", zIndex: 9000 }} />
    </>
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><Home /></QueryClientProvider>)
