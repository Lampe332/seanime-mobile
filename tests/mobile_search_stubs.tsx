import React from "react"
import { Link } from "@tanstack/react-router"
// Search tab harness fixtures: a fixture AniList behind buildSeaQuery with recorded requests, fixture server status / custom
// sources, recorded preview, playlist and explorer calls. Routing is the real TanStack router (see mobile_search_harness.tsx).
const w = window as any

// SeaLink as the app has it (a TanStack Link, numbers in the query as numbers, resetScroll on), without entry preloading.
export const SeaLink = React.forwardRef<HTMLAnchorElement, any>(({ href, warmEntryOnViewport, bypassEntryPreloadBudget, resetScroll = true, ...props }, ref) => {
    if (!href) return <a ref={ref} {...props} />
    const [pathname, query] = href.split("?")
    const search = query ? Object.fromEntries([...new URLSearchParams(query)].map(([key, value]) => [key, value.trim() !== "" && !isNaN(Number(value)) ? Number(value) : value])) : undefined
    return <Link ref={ref} to={pathname} search={search ? () => search : undefined} resetScroll={resetScroll} preload={false} {...props} />
})
export const SeaImage = React.forwardRef<HTMLImageElement, any>(({ fill, sizes, quality, priority, placeholder, ...props }, ref) =>
    <img ref={ref} {...props} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : undefined} />)
export const getImageUrl = (src: string) => src
export const CustomLibraryBanner = () => <div data-desktop-banner />
export const AdvancedSearchList = () => <div data-desktop-search-list>Desktop results</div>
export const AdvancedSearchOptions = () => <div data-desktop-search-options>Desktop filters</div>
export const AdvancedSearchPageTitle = () => <h2 data-desktop-search-title>Highest rated shows</h2>

// Server status and the custom sources keep their identity between renders, as react-query data does.
export const useServerStatus = () => w.serverStatus
export const useIsSimulatedUser = () => false
export const useHasTorrentOrDebridInclusion = () => ({ hasStreamingEnabled: !!w.streaming, hasTorrentOrDebridInclusion: false })
const customSources = { get data() { return w.customSources } }
export const useListCustomSourceExtensions = () => customSources
// Imported by the manga collection module (its chapter data atom is read); never called here.
export const useListMangaProviderExtensions = () => ({ data: undefined })
export const useServerQuery = () => ({ data: undefined })
export const useServerMutation = () => ({ mutate() {} })
export const useSeaQuery = () => ({ data: undefined })

export const useMediaPreviewModal = () => ({ setPreviewModalMediaId: (id: number, type: string) => w.previews.push([id, type]) })
export const MediaEntryCardAdultVeil = () => <div data-adult-veil style={{ position: "absolute", inset: 0, zIndex: 4, background: "#111" }} />
export const PluginMediaCardContextMenuItems = () => <div data-plugin-card-items>Plugin card action</div>
export const usePlaylistEditorManager = () => ({ selectMediaAndOpenEditor: (id: number) => w.playlist.push(id) })
export const useLibraryExplorer = () => ({ openDirInLibraryExplorer: (path: string) => w.explorer.push(path) })

const ANIME = ["Frieren: Beyond Journey's End", "Gintama: THE VERY FINAL", "Fullmetal Alchemist: Brotherhood", "Steins;Gate", "Attack on Titan Season 3 Part 2",
    "Re:ZERO -Starting Life in Another World- Season 4", "Chainsaw Man – The Movie: Reze Arc", "BLEACH: Thousand-Year Blood War - The Calamity",
    "Fruits Basket The Final Season", "Clannad: After Story", "Monogatari Series: Second Season", "Vinland Saga Season 2"]
const MANGA = ["Berserk", "Vagabond", "One Piece", "Solo Leveling", "Omniscient Reader", "Oyasumi Punpun", "Monster", "Vinland Saga", "Slam Dunk", "Blue Period"]
const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"]
const FORMATS = ["TV", "TV", "MOVIE", "TV", "ONA", "OVA"]
// Every 8th title is airing, every 8th from the 6th on upcoming
const STATUS = (i: number) => i % 8 === 5 ? "NOT_YET_RELEASED" : i % 8 === 7 ? "RELEASING" : "FINISHED"
function media(manga: boolean, i: number) {
    const base = manga ? 5000 : 1000
    const names = manga ? MANGA : ANIME
    const title = names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : "")
    return {
        id: base + i, idMal: 90000 + base + i, title: { userPreferred: title }, coverImage: { large: `/cover/${base + i}.svg` }, isAdult: i === 4, status: STATUS(i),
        format: manga ? (i % 7 === 3 ? "ONE_SHOT" : "MANGA") : FORMATS[i % FORMATS.length], startDate: { year: 2020 - (i % 7) },
        ...(manga ? { chapters: 100 + i } : { season: SEASONS[i % 4], seasonYear: 2024 - (i % 9), episodes: 12 + i }),
    }
}

// The fixture AniList: `server.total` results (12 for a title, none for "zzz", an error for "boom"), 48 per page; a later page
// repeats the last title of the one before (AniList does that when the order shifts). `server.failNext` fails later pages.
function serve(endpoint: string, request: any) {
    const server = w.server
    if (request.search === "boom") throw new Error("AniList could not be reached")
    if (request.page > 1 && server.failNext) throw new Error("Page failed")
    const manga = endpoint.includes("/manga/")
    const total = request.search === "zzz" ? 0 : request.search ? 12 : server.total
    const start = (request.page - 1) * request.perPage
    const ids: number[] = []
    for (let i = start; i < Math.min(start + request.perPage, total); i++) ids.push(i)
    if (request.page > 1 && ids.length) ids.unshift(start - 1)
    return { Page: { pageInfo: { currentPage: request.page, hasNextPage: start + request.perPage < total, total, perPage: request.perPage }, media: ids.map(i => media(manga, i)) } }
}

export async function buildSeaQuery({ endpoint, data }: { endpoint: string, data: any }) {
    const request = JSON.parse(JSON.stringify(data ?? {}))
    w.requests.push({ endpoint, ...request })
    await new Promise(resolve => setTimeout(resolve, w.server.delay))
    return serve(endpoint, request)
}
