import React from "react"
import { atom } from "jotai"
import { useMutation, useQuery } from "@tanstack/react-query"
// Torrent harness: a fixture server behind the real query hooks (react-query stays real), a recording router, links,
// toasts, no websocket, and the page view / plugin items the anime page's More sheet reads.
const w = window as any

export const useRouter = () => ({ push: (href: string) => w.routes.push(href), replace: () => {}, back: () => {} })
export const useSearchParams = () => new URLSearchParams(location.search)
export const usePathname = () => location.pathname

const record = (kind: string) => (message: any) => { w.toasts.push([kind, String(message)]) }
export const toast = Object.assign(record("default"), { success: record("success"), info: record("info"), warning: record("warning"), error: record("error"), dismiss: () => {} })

export const SeaImage = React.forwardRef<HTMLImageElement, any>(({ fill, sizes, quality, priority, placeholder, ...props }, ref) => <img ref={ref} {...props} />)
export const SeaLink = React.forwardRef<HTMLAnchorElement, any>(({ href, warmEntryOnViewport, bypassEntryPreloadBudget, resetScroll, onClick, ...props }, ref) =>
    <a ref={ref} href={href} {...props} onClick={event => {
        onClick?.(event)
        event.preventDefault()
        w.routes.push(href)
    }} />)

export const clientIdAtom = atom<string | null>("harness-client")
export const websocketConnectedAtom = atom(true)
export const useWebsocketMessageListener = () => {}
export const useWebsocketPluginMessageListener = () => {}
export const useIsMainTab = () => true
export const useIsMainTabRef = () => ({ current: true })
export const useWebsocketSender = () => ({ sendMessage: () => {}, sendPluginMessage: () => {} })
export const useWebsocketSendEvent = () => ({ sendEvent: () => {} })

export function useAnimeEntryPageView() {
    return { currentView: "library", isLibraryView: true, setView: () => {}, isTorrentStreamingView: false, isDebridStreamingView: false, isOnlineStreamingView: false }
}
export function usePluginAnimePageDropdownItems() { return { items: [], handleClick: () => {} } }
export const PluginMediaCardContextMenuItems = () => null
export const PluginAnimePageDropdownItems = () => null
export const PluginEpisodeGridItemMenuItems = () => null

function respond(method: string, endpoint: string, body: any): any {
    const s = w.server
    const route = `${method} ${endpoint.split("?")[0]}`
    switch (route) {
        case "GET /api/v1/extensions/list/anime-torrent-provider":
            return s.providers
        case "POST /api/v1/torrent/search":
            if (s.searchFails) throw new Error("provider timed out")
            return s.empty ? { torrents: [], previews: [] } : {
                torrents: body.type === "simple" ? s.torrents : [],
                previews: body.type === "smart" ? s.torrents.map((torrent: any) => ({ torrent })) : [],
                debridInstantAvailability: s.cached,
            }
        case "POST /api/v1/torrentstream/start":
        case "POST /api/v1/debrid/stream/start":
        case "POST /api/v1/torrent-client/download":
            return true
        case "GET /api/v1/torrent-client/list":
            return s.list
        case "POST /api/v1/torrent-client/action": {
            const item = s.list.find((torrent: any) => torrent.hash === body.hash)
            if (body.action === "pause" && item) item.status = "paused"
            if (body.action === "resume" && item) item.status = "downloading"
            if (body.action === "remove" || body.action === "remove-keep-files") s.list = s.list.filter((torrent: any) => torrent.hash !== body.hash)
            return true
        }
        case "GET /api/v1/torrentstream/batch-history":
        case "POST /api/v1/torrentstream/batch-history":
            return null
        case "GET /api/v1/anime/episode-collection/154587":
            return s.episodes
        case "GET /api/v1/continuity/history":
            return {}
    }
    throw new Error(`No fixture for ${route}`)
}
async function serve(method: string, endpoint: string, data: unknown) {
    const body = data === undefined ? null : JSON.parse(JSON.stringify(data))
    w.requests.push([method, endpoint, body])
    await new Promise(resolve => setTimeout(resolve, w.latency ?? 60))
    const answer = respond(method, endpoint, body)
    return answer === undefined ? null : JSON.parse(JSON.stringify(answer))
}
export function useServerQuery({ endpoint, method, params, data, muteError, ...options }: any) {
    return useQuery({ queryFn: () => serve(method, endpoint, data ?? params), ...options })
}
export function useServerMutation({ endpoint, method, ...options }: any) {
    return useMutation({ mutationFn: (variables: any) => serve(method, endpoint, variables), ...options })
}
export const buildSeaQuery = async ({ endpoint, method, data, params }: any) => serve(method, endpoint, data ?? params)
export const useSeaQuery = () => ({ seaFetch: async () => null })
