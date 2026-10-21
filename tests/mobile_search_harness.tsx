import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router"
import { getDefaultStore } from "jotai"
import { z } from "zod"
import Page from "../backend/seanime-web/src/app/(main)/search/page"
import { __anilist_userAnimeListDataAtom } from "../backend/seanime-web/src/app/(main)/_atoms/anilist.atoms"
import { animeLibraryCollectionAtom } from "../backend/seanime-web/src/app/(main)/_atoms/anime-library-collection.atoms"
import { mangaCollectionAtom } from "../backend/seanime-web/src/app/(main)/_atoms/manga-collection.atoms"
import { __mangaLibrary_latestChapterNumbersAtom } from "../backend/seanime-web/src/app/(main)/manga/_lib/handle-manga-collection"
import "../backend/seanime-web/src/components/shared/mobile-surface.css"
import { SeaLink } from "./mobile_search_stubs"

const w = window as any
// The collections the main layout loads; the search reads list data from them (and the manga tab's latest chapters).
const store = getDefaultStore()
store.set(__anilist_userAnimeListDataAtom, w.collections.animeListData)
store.set(animeLibraryCollectionAtom, w.collections.library)
store.set(mangaCollectionAtom, w.collections.manga)
store.set(__mangaLibrary_latestChapterNumbersAtom, w.collections.chapters)

// The app's query defaults (client-providers.tsx): no retries, no refetch on focus.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } })

// The real router as main.tsx creates it (scrollRestoration: false, so it still scrolls each rendered page to the top),
// /search validated as routes/_main/search/index.tsx does; the pages around it are stand-ins with a link back to the search.
const rootRoute = createRootRoute({ component: Outlet })
const searchSchema = z.object({
    sorting: z.string().optional(), genre: z.string().optional(), status: z.string().optional(), format: z.string().optional(),
    season: z.string().optional(), year: z.coerce.number().optional(), type: z.string().optional(),
})
const other = (path: string) => createRoute({
    getParentRoute: () => rootRoute, path,
    component: () => <div data-other-page={path} style={{ minHeight: 1600 }}>{path} <SeaLink href="/search?type=manga" data-to-search-manga>Search manga</SeaLink></div>,
})
const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/search", validateSearch: searchSchema, component: Page }),
    other("/entry"), other("/manga/entry"), other("/discover"), other("/custom-sources"),
])
const router = createRouter({ routeTree, scrollRestoration: false })
w.router = router
// An in-app link (plugins, Discover's "See all") and the bottom bar's /search
w.navigate = (href: string) => router.navigate({ href })
router.subscribe("onBeforeNavigate", ({ toLocation }) => w.routes.push(toLocation.href))

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
