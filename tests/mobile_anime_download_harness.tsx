import React from "react"
import { createRoot } from "react-dom/client"
import { EpisodeDownloadPicker } from "../backend/seanime-web/src/app/(main)/onlinestream/_containers/episode-download-picker"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"
import "../backend/seanime-web/src/app/(main)/entry/_components/mobile-anime.css"
const media: any = { id: 209983, title: { userPreferred: "HELL MODE: The Hardcore Gamer Dominates in Another World with Garbage Balancing Season 2" }, episodes: 13 }
const episodes: any[] = Array.from({ length: 13 }, (_, i) => ({ number: i + 1, title: i === 4 ? "The Sovereign of Spirits' Prophecy – ".repeat(4) : `Controlled episode ${i + 1}` }))
const w = window as any
w.__seanimeOfflineToken = "token"
w.batches = []
// Episodes 1-2 are already saved with original audio; 3 is saved as dub and must stay selectable.
w.SeanimeOffline = {
    snapshot: () => JSON.stringify([{ mediaId: 209983, episode: "1", status: "done", audioLanguage: "ja" }, { mediaId: 209983, episode: "2", status: "queued", audioLanguage: "ja" }, { mediaId: 209983, episode: "3", status: "done", audioLanguage: "de" }]),
    batch: (_token: string, data: string) => { const value = JSON.parse(data); w.batches.push(value); return JSON.stringify({ added: value.episodes.length }) },
}
createRoot(document.getElementById("root")!).render(<div data-mobile-anime="true" style={{ padding: 16 }}>
    <EpisodeDownloadPicker media={media} episodes={episodes} provider="animetoast" server="VidMoly" quality={null} dubbed={false} currentEpisode={11} />
</div>)
