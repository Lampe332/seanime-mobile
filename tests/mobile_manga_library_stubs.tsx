import React from "react"
import { atom } from "jotai"
import { useAtomValue } from "jotai/react"
import { getDefaultStore } from "jotai/vanilla"
// Manga tab harness: URL-backed router, fixture collection / theme / server status, recorded plugin and theme calls.
const w = window as any
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
window.addEventListener("popstate", notify)
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
export const useRouter = () => ({ push: (href: string) => { history.pushState(null, "", href); w.routes.push(href); notify() } })
export const useSearchParams = () => new URLSearchParams(React.useSyncExternalStore(subscribe, () => location.search))
export const usePathname = () => React.useSyncExternalStore(subscribe, () => location.pathname)

export const useSeaQuery = () => ({ seaFetch: async (url: string) => { w.fetches.push(url); return null } })
export const useQueryClient = () => ({ invalidateQueries: async () => {}, setQueryData: () => {} })
// Query data keeps its identity between renders, as react-query's does.
const extensions = { data: [{ id: "p", name: "Provider", settings: {} }], isLoading: false }
export const useListMangaProviderExtensions = () => extensions

// Fixtures come from the page's init script; the test swaps the collection with window.setCollection(state).
const collectionAtom = atom<{ data: any, isLoading: boolean, isError: boolean } | null>(null)
w.setCollection = (state: any) => getDefaultStore().set(collectionAtom, state)
export function useGetMangaCollection() {
    const state = useAtomValue(collectionAtom) ?? w.collectionState
    return { ...state, refetch: () => { w.refetches++ } }
}
export const useGetMangaLatestChapterNumbersMap = () => ({ data: w.latestChapterNumbers })
export const useGetMangaSourceRefresh = () => ({ data: w.refreshJob })
export const useStartMangaSourceRefresh = () => ({ mutate: (v: any) => w.refreshCalls.push(["start", v]), isPending: false })
export const useStopMangaSourceRefresh = () => ({ mutate: (_v?: any, o?: any) => { w.refreshCalls.push(["stop"]); o?.onSuccess?.() }, isPending: false })

const themeAtom = atom<any>(null)
export const useThemeSettings = () => useAtomValue(themeAtom) ?? w.theme
export const ThemeLibraryScreenBannerType = { Dynamic: "dynamic", Custom: "custom" }
export const useUpdateTheme = () => ({
    mutate: (v: any) => { w.themeUpdates.push(v.theme); getDefaultStore().set(themeAtom, { ...v.theme }) },
    isPending: false,
})
export const useServerStatus = () => ({ isOffline: false, settings: { anilist: { blurAdultContent: true } } })
export const useIsSimulatedUser = () => false

export const getImageUrl = (src: string) => src
export const SeaImage = React.forwardRef<HTMLImageElement, any>(({ fill, sizes, quality, priority, placeholder, ...props }, ref) =>
    <img ref={ref} {...props} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : undefined} />)
export const SeaLink = React.forwardRef<HTMLAnchorElement, any>(({ href, warmEntryOnViewport, bypassEntryPreloadBudget, resetScroll, onClick, ...props }, ref) =>
    <a ref={ref} href={href} {...props} onClick={event => {
        onClick?.(event)
        if (event.defaultPrevented || !href) return
        event.preventDefault(); history.pushState(null, "", href); w.routes.push(href); notify()
    }} />)

export const useMediaPreviewModal = () => ({ setPreviewModalMediaId: (id: number, type: string) => w.previews.push([id, type]) })
export const MediaEntryCardAdultVeil = () => <div data-adult-veil style={{ position: "absolute", inset: 0, zIndex: 4, background: "#111" }} />
export const MediaEntryPageLoadingDisplay = () => <div data-desktop-loading />
export const CustomLibraryBanner = () => null
export const MangaLibraryHeader = () => null
export const MangaLibraryView = () => <div data-desktop-library />

export const PluginMediaCardContextMenuItems = () => <div data-plugin-card-items>Plugin card action</div>
export const usePluginMangaLibraryDropdownItems = () => ({
    items: w.pluginItems,
    handleClick: (item: any) => w.pluginClicks.push(item.id),
})
export const PluginWebviewSlot = ({ slot }: { slot: string }) => <div data-plugin-slot={slot} />
export const useSeaCommandInject = () => ({ inject: (key: string) => w.injected.push(key), remove: () => {} })
export const CommandItemMedia = () => null
export const seaCommand_compareMediaTitles = () => true
