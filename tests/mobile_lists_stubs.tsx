import React from "react"
import { atom } from "jotai"
// My lists harness: URL-backed router, the AniList collections, tag maps, stats and server status from window.server,
// recorded refetches, mutations, invalidations, previews, playback hand-offs, playlist picks and toasts.
const w = window as any
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
window.addEventListener("popstate", notify)
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
export const useRouter = () => ({ push: (href: string) => { history.pushState(null, "", href); w.routes.push(href); notify() } })
export const useSearchParams = () => new URLSearchParams(React.useSyncExternalStore(subscribe, () => location.search))
export const usePathname = () => React.useSyncExternalStore(subscribe, () => location.pathname)

// The fixture server: query data keeps its identity between renders (as react-query's does); a change bumps a version.
let version = 0
const serverListeners = new Set<() => void>()
w.serverEmit = () => { version++; serverListeners.forEach(listener => listener()) }
const useServer = () => React.useSyncExternalStore(cb => { serverListeners.add(cb); return () => serverListeners.delete(cb) }, () => version)

function useFixture(name: string, enabled = true) {
    useServer()
    const state = w.server.states?.[name] ?? "ok"
    React.useEffect(() => { if (enabled) w.requested.push(name) }, [enabled])
    // As react-query: pending until the first answer, which may be null (no AniList user, a plugin hook); an error is not pending.
    return {
        data: enabled && state === "ok" ? w.server[name] : undefined,
        isLoading: enabled && state === "loading",
        isPending: !enabled || state === "loading",
        isError: enabled && state === "error",
        refetch: async () => { w.refetches.push(name) },
    }
}
export const useGetRawAnimeCollection = () => useFixture("anime")
export const useGetRawAnimeCollectionTags = () => useFixture("animeTags")
export const useGetRawAnilistMangaCollection = () => useFixture("manga")
export const useGetRawAnilistMangaCollectionTags = () => useFixture("mangaTags")
export const useGetAniListStats = (enabled = true) => useFixture("stats", enabled)

export const useServerStatus = () => { useServer(); return w.server.status }
export const useCurrentUser = () => useServerStatus()?.user
export const useIsSimulatedUser = () => !!useServerStatus()?.user?.isSimulated
export const useHasTorrentOrDebridInclusion = () => ({ hasStreamingEnabled: !!w.server.streaming, hasTorrentOrDebridInclusion: false })

export function useServerMutation(options: any) {
    const [isPending, setPending] = React.useState(false)
    const latest = React.useRef(options)
    latest.current = options
    return {
        isPending,
        mutate: () => {
            w.mutations.push([options.method, options.endpoint])
            setPending(true)
            // window.server.mutationError: the server's error answer, as axios hands it to onError
            setTimeout(async () => {
                const error = w.server.mutationError
                if (error) latest.current.onError?.({ response: error })
                else await latest.current.onSuccess?.()
                setPending(false)
            }, w.server.mutationDelay ?? 600)
        },
    }
}

// The chapter numbers Home or the Manga tab loaded (sources chosen per manga), from window.server.mangaChapters.
export const __mangaLibrary_latestChapterNumbersAtom = atom(w.server?.mangaChapters ?? { latestChapterNumbers: {}, storedProviders: {}, storedFilters: {} })
export const useQueryClient = () => ({ invalidateQueries: async ({ queryKey }: any) => { w.invalidated.push(queryKey[0]) } })

const record = (kind: string) => (message: any) => { w.toasts.push([kind, String(message)]) }
export const toast = Object.assign(record("default"), { success: record("success"), info: record("info"), warning: record("warning"), error: record("error") })

export const getImageUrl = (src: string) => src
export const SeaImage = React.forwardRef<HTMLImageElement, any>(({ fill, sizes, quality, priority, placeholder, ...props }, ref) =>
    <img ref={ref} {...props} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : undefined} />)
export const SeaLink = React.forwardRef<HTMLAnchorElement, any>(({ href, warmEntryOnViewport, bypassEntryPreloadBudget, resetScroll, onClick, ...props }, ref) =>
    <a ref={ref} href={href} {...props} data-warm={warmEntryOnViewport ? "" : undefined} onClick={event => {
        onClick?.(event)
        if (event.defaultPrevented || !href) return
        event.preventDefault(); history.pushState(null, "", href); w.routes.push(href); notify()
    }} />)

export const useMediaPreviewModal = () => ({ setPreviewModalMediaId: (id: number, type: string) => w.previews.push([id, type]) })
export const MediaEntryCardAdultVeil = () => <div data-adult-veil style={{ position: "absolute", inset: 0, zIndex: 4, background: "#111" }} />
export const CustomLibraryBanner = () => <div data-desktop-banner />
export const AnilistCollectionLists = () => <div data-desktop-lists />
export const PluginMediaCardContextMenuItems = ({ for: type }: { for: string }) => <div data-plugin-card-items={type}>Plugin card action</div>

export const usePlayNext = () => ({ playNext: null, setPlayNext: (id: number, then: () => void) => { w.playNext.push(id); then() }, resetPlayNext: () => {} })
export const usePlaylistEditorManager = () => ({ selectMediaAndOpenEditor: (id: number) => w.playlist.push(id) })
