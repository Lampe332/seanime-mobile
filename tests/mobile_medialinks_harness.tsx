import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDefaultStore } from "jotai"
import { serverStatusAtom } from "../backend/seanime-web/src/app/(main)/_atoms/server-status.atoms"
import { ManualProgressTracking } from "../backend/seanime-web/src/app/(main)/_features/progress-tracking/manual-progress-tracking"
import Page from "../backend/seanime-web/src/app/(main)/medialinks/page"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"

// The real /medialinks page as a phone opens it after "play in the external player", with the layout's manual progress
// tracking; window.server is the fixture server, websocket events come from window "ws" events.
const w = window as any
getDefaultStore().set(serverStatusAtom, w.server.status)
const client = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } })
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><Page /><ManualProgressTracking /></QueryClientProvider>)
