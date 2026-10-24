import React from "react"
import { createRoot } from "react-dom/client"
import { MediaCoreVolumeButton } from "../backend/seanime-web/src/app/(main)/_features/media-core/media-core-control-bar"
const w = window as any
w.volumeEvents = []
function App() {
    const [volume, setVolume] = React.useState(0.64)
    const [muted, setMuted] = React.useState(false)
    const [open, setOpen] = React.useState(false)
    w.volumeState = { volume, muted, open }
    return <div style={{ background: "#333", padding: 40, display: "flex", justifyContent: "flex-end", height: 300 }}>
        <div id="outside" style={{ position: "absolute", left: 0, bottom: 0, width: 80, height: 80 }} />
        <div style={{ height: 48 }}>
            <MediaCoreVolumeButton volume={volume} muted={muted} isMiniPlayer={false}
                onVolumeChange={v => { w.volumeEvents.push(v); setVolume(v); setMuted(v === 0) }}
                onMuteToggle={() => setMuted(m => !m)}
                panelOpen={open} onPanelOpenChange={setOpen} />
        </div>
    </div>
}
createRoot(document.getElementById("root")!).render(<App />)
