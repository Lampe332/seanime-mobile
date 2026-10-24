import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDefaultStore } from "jotai"
import { serverStatusAtom } from "../backend/seanime-web/src/app/(main)/_atoms/server-status.atoms"
import { SeaContextMenu } from "../backend/seanime-web/src/app/(main)/_features/context-menu/sea-context-menu"
import { MediaPreviewModal, useMediaPreviewModal } from "../backend/seanime-web/src/app/(main)/_features/media/_containers/media-preview-modal"
import { AnimeEntryPhoneMenu } from "../backend/seanime-web/src/app/(main)/entry/_containers/entry-actions/anime-entry-phone-menu"
import { ContextMenuItem, ContextMenuLabel, ContextMenuTrigger } from "../backend/seanime-web/src/components/ui/context-menu"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"
import "../backend/seanime-web/src/app/(main)/entry/_components/mobile-anime.css"

// The anime page's button row as a phone shows it (the real "More" menu and its sheets), a cover with the real long-press
// menu and the real preview modal mounted as the layout mounts it. window.server is the fixture server.
const w = window as any
getDefaultStore().set(serverStatusAtom, w.server.status)
const client = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } })

function Page() {
    const entry = w.server.anime[w.entryId]
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    return <div data-mobile-anime="true" style={{ padding: 16 }}>
        <div data-anime-meta-section-buttons-row style={{ display: "flex" }}><AnimeEntryPhoneMenu entry={entry} details={w.server.details} /></div>
        <SeaContextMenu content={<>
            <ContextMenuLabel className="line-clamp-1">HELL MODE: The Hardcore Gamer Dominates in Another World with Garbage Balancing</ContextMenuLabel>
            <ContextMenuItem onClick={() => setPreviewModalMediaId(w.previewId, w.previewType)} data-menu-preview>Preview</ContextMenuItem>
            <ContextMenuItem>Open page</ContextMenuItem>
        </>}>
            <ContextMenuTrigger asChild><div data-cover style={{ marginTop: 24, marginLeft: "auto", width: 110, height: 165, background: "#333" }} /></ContextMenuTrigger>
        </SeaContextMenu>
        <MediaPreviewModal />
    </div>
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
