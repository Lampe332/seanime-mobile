import React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
// Discover tab harness: a fixture AniList server behind the real query hooks (keys and caching stay react-query's),
// a URL-backed router with TanStack's history keys, recorded previews and requests, plugin markers, markers for the
// desktop page's containers.
const w = window as any
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
window.addEventListener("popstate", notify)
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
w.subscribeRoutes = subscribe
const newKey = () => Math.random().toString(36).slice(2, 8)
// Every entry has its own key, as TanStack history gives it (the first one too, and a replace gets a new one); Back
// brings the entry's key back.
if (!history.state?.__TSR_key) history.replaceState({ __TSR_key: newKey() }, "")
const go = (href: string, replace = false) => {
    history[replace ? "replaceState" : "pushState"]({ __TSR_key: newKey() }, "", href)
    w.routes.push([replace ? "replace" : "push", href])
    notify()
}
export const useRouter = () => ({ push: (href: string) => go(href), replace: (href: string) => go(href, true), back: () => history.back() })
// Same identity per URL, as the app's useSearchParams (memoized on the router location).
export function useSearchParams() {
    const search = React.useSyncExternalStore(subscribe, () => location.search)
    return React.useMemo(() => new URLSearchParams(search), [search])
}
export const usePathname = () => React.useSyncExternalStore(subscribe, () => location.pathname)
export function useLocation<T>(options?: { select?: (location: any) => T }) {
    React.useSyncExternalStore(subscribe, () => `${location.href}|${history.state?.__TSR_key ?? ""}`)
    const current = { pathname: location.pathname, search: Object.fromEntries(new URLSearchParams(location.search)), state: history.state ?? {} }
    return options?.select ? options.select(current) : current
}
// TanStack's navigate: the options are recorded, and the page scrolls to the top after rendering unless resetScroll is false.
export const useNavigate = () => async ({ to, search, replace, resetScroll }: any) => {
    w.navigations.push({ to, search, replace: !!replace, resetScroll })
    go(`${to}${search ? `?${new URLSearchParams(search)}` : ""}`, !!replace)
    if (resetScroll !== false) requestAnimationFrame(() => window.scrollTo(0, 0))
}

export const SeaLink = React.forwardRef<HTMLAnchorElement, any>(({ href, warmEntryOnViewport, bypassEntryPreloadBudget, resetScroll, onClick, ...props }, ref) =>
    <a ref={ref} href={href} data-warm={warmEntryOnViewport ? "" : undefined} {...props} onClick={event => {
        onClick?.(event)
        if (event.defaultPrevented || !href) return
        event.preventDefault()
        go(href)
    }} />)
export const SeaImage = React.forwardRef<HTMLImageElement, any>(({ fill, sizes, quality, priority, placeholder, ...props }, ref) =>
    <img ref={ref} {...props} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : undefined} />)
export const getImageUrl = (src: string) => src

export const useMediaPreviewModal = () => ({ setPreviewModalMediaId: (id: number, type: string) => w.previews.push([id, type]) })
export const MediaEntryCardAdultVeil = () => <div data-adult-veil style={{ position: "absolute", inset: 0, zIndex: 4, background: "#111" }} />
export const PluginMediaCardContextMenuItems = ({ for: type }: { for: string }) => <div data-plugin-card-items={type}>Plugin card action</div>
// An empty slot renders nothing in the app; a template keeps the marker out of the layout.
export const PluginWebviewSlot = ({ slot }: { slot: string }) => <template data-plugin-slot={slot} />

// The desktop page's parts render their name, so the page is visible (and readable in the tablet screenshot).
export const DiscoverPageHeader = () => <div data-desktop-discover-header>Desktop hero</div>
export const DiscoverAiringSchedule = () => <div data-desktop-discover-row="schedule">Desktop row: schedule</div>
export const DiscoverMissedSequelsSection = () => <div data-desktop-discover-row="missed">Desktop row: missed</div>
export const DiscoverThisSeason = () => <div data-desktop-discover-row="season">Desktop row: season</div>
export const DiscoverPastSeason = () => <div data-desktop-discover-row="last-season">Desktop row: last season</div>
export const DiscoverTrending = () => <div data-desktop-discover-row="trending">Desktop row: trending</div>
export const DiscoverTrendingCountry = ({ country }: { country: string }) => <div data-desktop-discover-row={`manga-${country}`}>Desktop row: manga {country}</div>
export const DiscoverTrendingMovies = () => <div data-desktop-discover-row="movies">Desktop row: movies</div>
export const DiscoverUpcoming = () => <div data-desktop-discover-row="upcoming">Desktop row: upcoming</div>
export const RecentReleases = () => <div data-desktop-discover-row="recent">Desktop row: recent</div>

// The fixture server: window.respond(endpoint, data) answers; window.failWhen / window.hangWhen hold substrings of
// "endpoint data-json" that fail or never answer; every request is recorded in window.requests.
async function serve(endpoint: string, data: unknown) {
    const body = data === undefined ? null : JSON.parse(JSON.stringify(data))
    w.requests.push([endpoint, body])
    const probe = `${endpoint} ${JSON.stringify(body)}`
    await new Promise(resolve => setTimeout(resolve, w.latency ?? 60))
    if ((w.hangWhen ?? []).some((part: string) => probe.includes(part))) return new Promise(() => {})
    if ((w.failWhen ?? []).some((part: string) => probe.includes(part))) throw new Error("AniList error")
    return w.respond(endpoint, body)
}
export function useServerQuery({ endpoint, method, params, data, muteError, ...options }: any) {
    return useQuery({ queryFn: () => serve(endpoint, data ?? params), ...options })
}
export function useServerMutation({ endpoint, method, ...options }: any) {
    return useMutation({ mutationFn: async (variables: any) => { w.mutations.push([endpoint, variables]) }, ...options })
}
export const buildSeaQuery = async ({ endpoint, data, params }: any) => serve(endpoint, data ?? params)
export const useSeaQuery = () => ({ seaFetch: async () => null })
