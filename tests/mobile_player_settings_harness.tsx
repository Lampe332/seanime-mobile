import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSetAtom } from "jotai"
import React from "react"
import { createRoot } from "react-dom/client"
import { vc_subtitleManager } from "../backend/seanime-web/src/app/(main)/_features/video-core/video-core"
import { vc_isMobile } from "../backend/seanime-web/src/app/(main)/_features/video-core/video-core-atoms"
import { VideoCoreSettingsMenu } from "../backend/seanime-web/src/app/(main)/_features/video-core/video-core-settings-menu"

const w = window as any
w.subtitleUpdates = 0
function Setup() {
    const setMobile = useSetAtom(vc_isMobile)
    const setSubtitleManager = useSetAtom(vc_subtitleManager)
    React.useLayoutEffect(() => {
        setMobile(true)
        setSubtitleManager({ updateSettings: () => { w.subtitleUpdates++ } } as any)
    }, [])
    return <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <VideoCoreSettingsMenu />
    </div>
}
createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={new QueryClient()}>
        <div id="player" style={{ position: "relative", height: "100vh", background: "#000" }}>
            <div id="outside" style={{ position: "absolute", left: 0, top: 0, width: 80, height: 80 }} />
            <Setup />
        </div>
    </QueryClientProvider>,
)
