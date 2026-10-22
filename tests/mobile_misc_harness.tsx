import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDefaultStore } from "jotai"
import { serverStatusAtom } from "../backend/seanime-web/src/app/(main)/_atoms/server-status.atoms"
import { __issueReport_overlayOpenAtom, IssueReport } from "../backend/seanime-web/src/app/(main)/_features/issue-report/issue-report"
import CustomSources from "../backend/seanime-web/src/app/(main)/custom-sources/page"
import { LuffyError } from "../backend/seanime-web/src/components/shared/luffy-error"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"

// window.view picks what to show as a phone shows it: the real /custom-sources page, a LuffyError as the app's pages use
// it (title, text, retry), or the real issue recorder opened from Settings. window.server is the fixture server.
const w = window as any
const store = getDefaultStore()
store.set(serverStatusAtom, w.server.status)
w.openRecorder = () => store.set(__issueReport_overlayOpenAtom, true)
const client = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } })

function View() {
    if (w.view === "custom") return <CustomSources />
    if (w.view === "luffy") return <LuffyError title="Transcoding not enabled" showRefreshButton><p>Turn it on in Seanime on a computer.</p></LuffyError>
    return <><p style={{ padding: 16, height: 1200 }}>Settings</p><IssueReport />
        <nav id="__seanime_bottom_nav" style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: "4.75rem", background: "#222", zIndex: 9000 }} /></>
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><View /></QueryClientProvider>)
