import React from "react"
import { createRoot } from "react-dom/client"
import { getDefaultStore } from "jotai"
import { useAtomValue } from "jotai/react"
import Page from "../backend/seanime-web/src/app/(main)/manga/page"
import { __manga_continueIntentAtom } from "../backend/seanime-web/src/app/(main)/manga/_lib/manga-continue"
import { __manga_preferencesHydratedAtom } from "../backend/seanime-web/src/app/(main)/manga/_lib/handle-manga-selected-provider"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"

// Server-backed manga preferences count as loaded (the source refresh waits for them).
getDefaultStore().set(__manga_preferencesHydratedAtom, true)

// Exposes the "Continue reading" hand-off to the manga page, which the test reads as window.intent.
function IntentProbe() {
    const intent = useAtomValue(__manga_continueIntentAtom)
    React.useEffect(() => { (window as any).intent = intent }, [intent])
    return null
}

createRoot(document.getElementById("root")!).render(<><Page /><IntentProbe /></>)
