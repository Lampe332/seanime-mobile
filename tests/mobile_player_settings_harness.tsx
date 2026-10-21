import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSetAtom } from "jotai"
import React from "react"
import { createRoot } from "react-dom/client"
import { PhoneSkipButton, vc_subtitleManager } from "../backend/seanime-web/src/app/(main)/_features/video-core/video-core"
import { vc_activePlayerId, vc_isMobile } from "../backend/seanime-web/src/app/(main)/_features/video-core/video-core-atoms"
import { serverStatusAtom } from "../backend/seanime-web/src/app/(main)/_atoms/server-status.atoms"
import { VideoCoreSettingsMenu } from "../backend/seanime-web/src/app/(main)/_features/video-core/video-core-settings-menu"

const w = window as any
w.subtitleUpdates = 0
w.translateUpdates = []
w.initialMediaPlayer = {
    vcTranslate: false, vcTranslateProvider: "", vcTranslateTargetLanguage: "", vcTranslateApiKey: "", vcTranslateBaseUrl: "", vcTranslateModel: "",
}
function Setup() {
    const setMobile = useSetAtom(vc_isMobile)
    const setSubtitleManager = useSetAtom(vc_subtitleManager)
    const setActivePlayer = useSetAtom(vc_activePlayerId)
    const setServerStatus = useSetAtom(serverStatusAtom)
    React.useLayoutEffect(() => {
        setMobile(true)
        // A web player (online stream); the native player would hide the libass switch.
        setActivePlayer("onlinestream")
        setSubtitleManager({
            updateSettings: () => { w.subtitleUpdates++ },
            updateShouldTranslate: (target: string | null) => { w.translateUpdates.push(target) },
        } as any)
        // Server settings as a fresh install has them; PATCH answers come from the test's route.
        setServerStatus({ settings: { mediaPlayer: w.initialMediaPlayer } } as any)
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
            <div id="skip-player" data-vc-element="container" style={{ position: "absolute", left: 0, right: 0, top: 200, aspectRatio: "16 / 9", background: "#223" }}>
                <PhoneSkipButton label="Opening" onSkip={() => { w.skips = (w.skips || 0) + 1 }} />
            </div>
        </div>
    </QueryClientProvider>,
)
