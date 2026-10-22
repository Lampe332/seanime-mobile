import React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
// Library harness: a fixture Seanime server behind the real query hooks (react-query stays real) that applies scans,
// matches, ignores, additions and bulk actions to window.server.collection; a URL-backed router; recorded toasts, previews
// and command palette calls; websocket events from window "ws" events.
const w = window as any

const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
window.addEventListener("popstate", notify)
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const useRouter = () => ({ push: (href: string) => { history.pushState(null, "", href); w.routes.push(href); notify() }, replace: () => {}, back: () => history.back() })
export const useSearchParams = () => new URLSearchParams(React.useSyncExternalStore(subscribe, () => location.search))
export const usePathname = () => React.useSyncExternalStore(subscribe, () => location.pathname)

const record = (kind: string) => (message: any) => { w.toasts.push([kind, String(message)]) }
export const toast = Object.assign(record("default"), { success: record("success"), info: record("info"), warning: record("warning"), error: record("error") })

export const SeaImage = React.forwardRef<HTMLImageElement, any>(({ fill, sizes, quality, priority, placeholder, ...props }, ref) =>
    <img ref={ref} {...props} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : undefined} />)
export const SeaLink = React.forwardRef<HTMLAnchorElement, any>(({ href, warmEntryOnViewport, bypassEntryPreloadBudget, resetScroll, onClick, ...props }, ref) =>
    <a ref={ref} href={href} {...props} onClick={event => {
        onClick?.(event)
        event.preventDefault()
        w.routes.push(href)
    }} />)

export const useMediaPreviewModal = () => ({ setPreviewModalMediaId: (id: number, type: string) => w.previews.push([id, type]) })
export const PluginMediaCardContextMenuItems = () => null
export const CustomLibraryBanner = () => <div data-desktop-banner />
export const useLibraryExplorer = () => ({ openDirInLibraryExplorer: (path: string) => w.explorer.push(path) })
export const useSeaCommand = () => ({ setSeaCommandInput: (v: string) => w.command.push(v), setSeaCommandOpen: (v: boolean) => w.command.push(v) })
export const useSeaCommandSearchSelectMedia = () => ({ searchAndSelectMedia: () => {}, selectedAnime: null, onAcknowledgeSelection: () => {} })
export const useSeaCommandInject = () => ({ inject: () => {}, remove: () => {} })

// Websocket messages: dispatchEvent(new CustomEvent("ws", {detail: {type, payload}}))
export function useWebsocketMessageListener<T>({ type, onMessage }: { type: string, onMessage: (data: T) => void }) {
    const latest = React.useRef(onMessage)
    latest.current = onMessage
    React.useEffect(() => {
        const on = (event: Event) => {
            const { detail } = event as CustomEvent
            if (detail.type === type) latest.current(detail.payload)
        }
        window.addEventListener("ws", on)
        return () => window.removeEventListener("ws", on)
    }, [type])
}

const media = (id: number) => w.server.media[id]

/** The server's answer to one request; library changes go to window.server.collection. */
function respond(method: string, endpoint: string, body: any): any {
    const s = w.server
    const c = s.collection
    const route = `${method} ${endpoint.split("?")[0]}`
    const takeFiles = (paths: string[]) => {
        const moved = c.unmatchedLocalFiles.filter((lf: any) => paths.includes(lf.path))
        c.unmatchedLocalFiles = c.unmatchedLocalFiles.filter((lf: any) => !paths.includes(lf.path))
        c.unmatchedGroups = c.unmatchedGroups.map((g: any) => ({ ...g, localFiles: g.localFiles.filter((lf: any) => !paths.includes(lf.path)) }))
            .filter((g: any) => g.localFiles.length)
        return moved
    }
    switch (route) {
        case "GET /api/v1/library/collection":
            return c
        case "POST /api/v1/anilist/collection":
        case "POST /api/v1/library/scan":
        case "POST /api/v1/library/explorer/file-tree/refresh":
        case "POST /api/v1/library/local-files":
        case "DELETE /api/v1/library/empty-directories":
            return true
        case "PATCH /api/v1/library/local-files": {
            if (body.action === "ignore") c.ignoredLocalFiles = [...c.ignoredLocalFiles, ...takeFiles(body.paths).map((lf: any) => ({ ...lf, ignored: true }))]
            if (body.action === "unignore") c.ignoredLocalFiles = c.ignoredLocalFiles.filter((lf: any) => !body.paths.includes(lf.path))
            return true
        }
        case "POST /api/v1/library/anime-entry/suggestions":
            return (s.suggestions[body.dir] ?? []).map(media)
        case "POST /api/v1/library/anime-entry/manual-match":
            takeFiles(body.paths)
            return []
        case "POST /api/v1/anilist/list-anime":
            return { Page: { media: Object.values(s.media).filter((m: any) => m.title.romaji.toLowerCase().includes(body.search.toLowerCase())) } }
        case "POST /api/v1/library/unknown-media":
            c.unknownGroups = c.unknownGroups.filter((g: any) => !body.mediaIds.includes(g.mediaId))
            return c
        case "PATCH /api/v1/library/anime-entry/bulk-action":
            c.unknownGroups = c.unknownGroups.filter((g: any) => g.mediaId !== body.mediaId)
            return []
        case "GET /api/v1/library/scan-summaries":
            return s.scanSummaries ?? []
        case "GET /api/v1/library/missing-episodes":
        case "GET /api/v1/auto-downloader/items":
            return null
    }
    const entry = route.match(/^GET \/api\/v1\/library\/anime-entry\/(\d+)$/)
    if (entry) return media(Number(entry[1])) ? { mediaId: Number(entry[1]), media: media(Number(entry[1])) } : null
    throw new Error(`No fixture for ${route}`)
}

// window.failWhen holds substrings of "METHOD endpoint body-json" that answer with an error.
async function serve(method: string, endpoint: string, data: unknown) {
    const body = data === undefined ? null : JSON.parse(JSON.stringify(data))
    w.requests.push([method, endpoint, body])
    await new Promise(resolve => setTimeout(resolve, w.latency ?? 60))
    const probe = `${method} ${endpoint} ${JSON.stringify(body)}`
    if ((w.failWhen ?? []).some((part: string) => probe.includes(part))) throw Object.assign(new Error("Server error"), { response: { status: 500, data: { error: "fixture" } } })
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
