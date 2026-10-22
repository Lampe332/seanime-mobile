import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDefaultStore } from "jotai"
import { serverStatusAtom } from "../backend/seanime-web/src/app/(main)/_atoms/server-status.atoms"
import { AnimeEntryPhoneMenu } from "../backend/seanime-web/src/app/(main)/entry/_containers/entry-actions/anime-entry-phone-menu"
import { useTorrentSearchSelectedStreamEpisode } from "../backend/seanime-web/src/app/(main)/entry/_containers/torrent-search/_lib/handle-torrent-selection"
import {
    __torrentSearch_selectionAtom,
    __torrentSearch_selectionEpisodeAtom,
} from "../backend/seanime-web/src/app/(main)/entry/_containers/torrent-search/torrent-search-drawer"
import { TorrentSearchPhone } from "../backend/seanime-web/src/app/(main)/entry/_containers/torrent-search/torrent-search-phone"
import { StreamControlsPhone } from "../backend/seanime-web/src/app/(main)/entry/_containers/torrent-stream/_components/stream-controls-phone"
import { TorrentDownloads } from "../backend/seanime-web/src/app/(main)/android-downloads/torrent-downloads"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"
import "../backend/seanime-web/src/app/(main)/entry/_components/mobile-anime.css"
import "../backend/seanime-web/src/app/(main)/android-downloads/downloads-mobile.css"

// The phone torrent pieces as the anime page and Downloads mount them: the More sheet's entry, the search sheet (stream,
// debrid, download) and its download sheet, the source controls, and the Torrents tab. window.server is the fixture server;
// window.openSearch(type, episode) does what an episode tap on the Torrent / Debrid source does.
const w = window as any
const store = getDefaultStore()
store.set(serverStatusAtom, w.server.status)
const client = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } })

function Page() {
    const entry = w.server.entry
    const { setTorrentSearchStreamEpisode } = useTorrentSearchSelectedStreamEpisode()
    w.openSearch = (type: string, episode?: number) => {
        if (episode) {
            setTorrentSearchStreamEpisode({ episodeNumber: episode, aniDBEpisode: String(episode) } as any)
            store.set(__torrentSearch_selectionEpisodeAtom, episode)
        }
        store.set(__torrentSearch_selectionAtom, type as any)
    }
    const [auto, setAuto] = React.useState(false)
    if (w.screen === "downloads") return <div data-mobile-downloads="true" className="mdl-page"><TorrentDownloads /></div>
    return <div data-mobile-anime="true" style={{ padding: 16 }}>
        <div data-anime-meta-section-buttons-row style={{ display: "flex" }}><AnimeEntryPhoneMenu entry={entry} /></div>
        <StreamControlsPhone kind="torrent" autoSelect={auto} onAutoSelect={setAuto} batchName={w.batchName} onForgetBatch={() => w.forgot = true}
            mappingError={w.mappingError} />
        <TorrentSearchPhone entry={entry} />
    </div>
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
