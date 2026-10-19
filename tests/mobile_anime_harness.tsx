import React from "react"
import { createRoot } from "react-dom/client"
import { EpisodeGridItem } from "../backend/seanime-web/src/app/(main)/_features/anime/_components/episode-grid-item"
import { MediaEpisodeInfoModal } from "../backend/seanime-web/src/app/(main)/_features/media/_components/media-episode-info-modal"
import "../backend/seanime-web/src/app/(main)/entry/_components/mobile-anime.css"
const media: any = { id: 123, type: "ANIME", title: { userPreferred: "Controlled regression anime" } }
function App() {
    const [selected, setSelected] = React.useState(1)
    return <div data-mobile-anime="true" style={{ padding: 12 }}>
        {[1, 2, 3].map(n => <EpisodeGridItem key={n} media={media} mobileEntry title={`Episode ${n}`} episodeTitle={"Langer deutscher und englischer Episodentitel – ".repeat(8)} episodeNumber={n}
            isSelected={selected === n} isWatched={n === 1} disabled={n === 3}
            onClick={() => { (window as any).episodeSelections.push(n); setSelected(n) }}
            action={<MediaEpisodeInfoModal mobileEntry title={`Episode ${n}`} episodeTitle="Controlled episode" summary={"Ausführliche Beschreibung. ".repeat(100)} />} />)}
    </div>
}
;(window as any).episodeSelections = []
createRoot(document.getElementById("root")!).render(<App />)
