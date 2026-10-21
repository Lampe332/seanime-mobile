import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDefaultStore } from "jotai"
import Page from "../backend/seanime-web/src/app/(main)/discover/page"
import { serverStatusAtom } from "../backend/seanime-web/src/app/(main)/_atoms/server-status.atoms"
import { __anilist_userAnimeListDataAtom } from "../backend/seanime-web/src/app/(main)/_atoms/anilist.atoms"
import { animeLibraryCollectionAtom } from "../backend/seanime-web/src/app/(main)/_atoms/anime-library-collection.atoms"
import { mangaCollectionAtom } from "../backend/seanime-web/src/app/(main)/_atoms/manga-collection.atoms"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"

// The real /discover page with the collections the app's main layout loads, the server status and react-query's
// defaults (no retries, no refetch on focus). As in the app, /discover unmounts while another route (an entry page) is
// shown, comes back on Back, and the router scrolls each newly rendered page to the top. window.remount() mounts the
// page anew; window.queryClient is the cache.
const w = window as any
const store = getDefaultStore()
store.set(serverStatusAtom, w.serverStatus)
store.set(__anilist_userAnimeListDataAtom, w.animeListData ?? {})
store.set(animeLibraryCollectionAtom, w.libraryCollection)
store.set(mangaCollectionAtom, w.mangaCollection)
const client = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } })
w.queryClient = client

function Routes() {
    // The stubbed router's subscription (one module instance with the page's router hooks).
    const path = React.useSyncExternalStore(w.subscribeRoutes, () => location.pathname)
    // TanStack's onRendered scroll reset: after the new route rendered (parents' layout effects run after the page's).
    React.useLayoutEffect(() => { window.scrollTo(0, 0) }, [path])
    return path === "/discover" ? <Page /> : <main data-harness-route={path} style={{ height: "150vh" }}>{path}</main>
}

const root = createRoot(document.getElementById("root")!)
let mount = 0
w.remount = () => root.render(<QueryClientProvider client={client}><Routes key={++mount} /></QueryClientProvider>)
w.remount()
