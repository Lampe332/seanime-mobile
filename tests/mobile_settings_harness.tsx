import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDefaultStore } from "jotai"
import Page from "../backend/seanime-web/src/app/(main)/settings/page"
import { serverStatusAtom } from "../backend/seanime-web/src/app/(main)/_atoms/server-status.atoms"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"

// The real /settings page with the server status the app's layout loads and react-query's defaults (no retries, no
// refetch on focus). window.server is the fixture server; its stored state comes back after a reload.
const w = window as any
getDefaultStore().set(serverStatusAtom, w.server.status)
const client = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } })
w.queryClient = client
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
