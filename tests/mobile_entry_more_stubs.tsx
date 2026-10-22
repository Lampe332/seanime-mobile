import React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
// Anime page "More" harness: a fixture server behind the real query hooks (react-query stays real), the page's view
// from window.view, plugin items from window.server.pluginItems, a recording router, links, clipboard and toasts.
const w = window as any

export const useRouter = () => ({ push: (href: string) => w.routes.push(href), replace: () => {}, back: () => {} })
export const useSearchParams = () => new URLSearchParams(location.search)
export const usePathname = () => location.pathname

const record = (kind: string) => (message: any) => { w.toasts.push([kind, String(message)]) }
export const toast = Object.assign(record("default"), { success: record("success"), info: record("info"), warning: record("warning"), error: record("error") })
export const copyToClipboard = async (text: string) => { w.clipboard.push(text) }
export const openTab = (url: string) => { w.tabs.push(url) }

export const SeaImage = React.forwardRef<HTMLImageElement, any>(({ fill, sizes, quality, priority, placeholder, ...props }, ref) =>
    <img ref={ref} {...props} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : undefined} />)
export const SeaLink = React.forwardRef<HTMLAnchorElement, any>(({ href, warmEntryOnViewport, bypassEntryPreloadBudget, resetScroll, onClick, ...props }, ref) =>
    <a ref={ref} href={href} {...props} onClick={event => {
        onClick?.(event)
        event.preventDefault()
        w.routes.push(href)
    }} />)

export function useAnimeEntryPageView() {
    return { currentView: w.view, isLibraryView: w.view === "library", isTorrentStreamingView: false, isDebridStreamingView: false, isOnlineStreamingView: w.view === "onlinestream" }
}
export function usePluginAnimePageDropdownItems() {
    return { items: w.server.pluginItems, handleClick: (item: any) => w.pluginClicks.push(item.id) }
}
export const PluginMediaCardContextMenuItems = () => null
export const PluginAnimePageDropdownItems = () => null

function respond(method: string, endpoint: string, body: any): any {
    const s = w.server
    const route = `${method} ${endpoint.split("?")[0]}`
    let m = route.match(/^GET \/api\/v1\/library\/anime-entry\/(\d+)$/)
    if (m) return s.anime[m[1]] ?? null
    m = route.match(/^GET \/api\/v1\/manga\/entry\/(\d+)$/)
    if (m) return s.manga[m[1]] ?? null
    m = route.match(/^GET \/api\/v1\/metadata\/parent\/(\d+)$/)
    if (m) return s.parents[m[1]] ?? null
    switch (route) {
        case "POST /api/v1/metadata/parent":
            s.parents[body.mediaId] = { id: 1, ...body }
            return true
        case "DELETE /api/v1/metadata/parent":
            delete s.parents[body.mediaId]
            return true
        case "POST /api/v1/metadata-provider/filler":
        case "DELETE /api/v1/metadata-provider/filler":
        case "PATCH /api/v1/library/local-files":
        case "DELETE /api/v1/library/local-files":
            return true
        case "GET /api/v1/library/collection":
        case "GET /api/v1/library/missing-episodes":
            return null
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
