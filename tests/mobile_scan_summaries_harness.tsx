import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDefaultStore } from "jotai"
import { serverStatusAtom } from "../backend/seanime-web/src/app/(main)/_atoms/server-status.atoms"
import { ScannerModal } from "../backend/seanime-web/src/app/(main)/_features/anime-library/_containers/scanner-modal"
import Page from "../backend/seanime-web/src/app/(main)/scan-summaries/page"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"

// The real /scan-summaries page as a phone opens it, with the layout's scanner; window.server is the fixture server.
const w = window as any
getDefaultStore().set(serverStatusAtom, w.server.status)
const client = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } })
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><Page /><ScannerModal /></QueryClientProvider>)
