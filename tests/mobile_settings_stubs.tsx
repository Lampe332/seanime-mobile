import React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { atom } from "jotai"
// Settings harness: a fixture Seanime server behind the real query hooks (react-query stays real) that stores every
// change in sessionStorage, so a reload shows what was saved; a URL-backed router; recorded toasts, clipboard, file saves,
// update checks, tutorial and issue recorder starts, manga source overwrites; markers for the desktop page's containers.
const w = window as any
const persist = () => sessionStorage.setItem("settings-fixture", JSON.stringify(w.server))

const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
window.addEventListener("popstate", notify)
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const go = (href: string, replace = false) => {
    history[replace ? "replaceState" : "pushState"](null, "", href)
    w.routes.push([replace ? "replace" : "push", href])
    notify()
}
export const useRouter = () => ({ push: (href: string) => go(href), replace: (href: string) => go(href, true), back: () => history.back() })
export function useSearchParams() {
    const search = React.useSyncExternalStore(subscribe, () => location.search)
    return React.useMemo(() => new URLSearchParams(search), [search])
}
export const usePathname = () => React.useSyncExternalStore(subscribe, () => location.pathname)

const record = (kind: string) => (message: any) => { w.toasts.push([kind, String(message)]) }
export const toast = Object.assign(record("default"), { success: record("success"), info: record("info"), warning: record("warning"), error: record("error") })

export const getAndroidAppVersion = () => "1.9.37"
export const copyToClipboard = async (text: string) => { w.clipboard.push(text) }
export const openTab = (url: string) => { w.tabs.push(url) }

// Update check (the app's native AppUpdater on Android)
export const useCheckForUpdates = () => useMutation({ mutationFn: async () => { w.updateChecks++; return w.server.update ?? { release: null } } })
const recorded = (name: string) => {
    const base = atom<any>(false)
    return atom(get => get(base), (_get, set, value: any) => { w[name].push(value); set(base, value) })
}
export const updateModalOpenAtom = recorded("updateModal")
export const __issueReport_overlayOpenAtom = recorded("issueRecorder")
export const useStartMobileTutorial = () => () => { w.tutorial++ }
export const useStoredMangaProviders = () => ({
    storedProviders: w.server.storedProviders,
    overwriteStoredProviders: (providers: Record<string, string>) => { w.mangaSources.push(["restore", providers]) },
    overwriteStoredProvidersWith: (id: string) => { w.mangaSources.push(["all", id]) },
})
export const fileTimestamp = () => "2026-10-21_12-00-00"
export const saveBlob = () => {}
export const useSaveServerFile = () => async (endpoint: string, filename: string, options?: { text?: boolean }) => {
    w.saves.push([endpoint, filename, !!options?.text])
    if (w.server.failSaves) throw new Error("HTTP 500")
}

// The desktop page's parts (never rendered on a phone) and its banner
const desktop = (name: string) => () => <div data-desktop-settings={name}>{name}</div>
export const CustomLibraryBanner = desktop("banner")

export const SettingsCard = desktop("card"), SettingsNavCard = desktop("nav"), SettingsPageHeader = desktop("header")
export const PlaybackSettings = desktop("playback"), MediaplayerSettings = desktop("media-player"), ExternalPlayerLinkSettings = desktop("external-player-link")
export const SettingsIsDirty = desktop("dirty"), SettingsSubmitButton = desktop("submit")
export const AnimeLibrarySettings = desktop("library"), DebridSettings = desktop("debrid"), FilecacheSettings = desktop("filecache")
export const LogsSettings = desktop("logs"), MangaSettings = desktop("manga"), MediastreamSettings = desktop("mediastream")
export const ServerSettings = desktop("server"), TorrentstreamSettings = desktop("torrentstream"), UISettings = desktop("ui")
export const DenshiSettings = desktop("denshi"), DiscordRichPresenceSettings = desktop("discord"), LocalSettings = desktop("local"), NakamaSettings = desktop("nakama")

function setPath(target: any, path: string, value: unknown) {
    const keys = path.split(".")
    let node = target
    for (const key of keys.slice(0, -1)) node = node[key] ??= {}
    node[keys[keys.length - 1]] = value
}

const seaError = (message: string) => Object.assign(new Error(message), { response: { status: 500, data: { error: message } } })

/** The server's answer to one request; changes are stored at once (and survive a reload). */
function respond(method: string, endpoint: string, body: any): any {
    const s = w.server
    const route = `${method} ${endpoint.split("?")[0]}`
    switch (route) {
        case "PATCH /api/v1/settings/path":
            setPath(s.status.settings, body.path, body.value)
            s.status.settings.updatedAt = `t${Date.now()}`
            return s.status
        case "PATCH /api/v1/theme":
            s.status.themeSettings = { ...body.theme, id: 1 }
            return s.status.themeSettings
        case "GET /api/v1/status":
            return s.status
        case "GET /api/v1/anilist/cache-layer/status":
            return s.apiWorking
        case "POST /api/v1/anilist/cache-layer/status":
            s.apiWorking = !s.apiWorking
            return true
        case "POST /api/v1/local/sync-simulated-to-anilist":
            return true
        case "GET /api/v1/logs/filenames":
            return s.logFiles
        case "GET /api/v1/logs/latest":
            return s.logContent
        case "DELETE /api/v1/logs":
            s.logFiles = s.logFiles.filter((name: string) => !body.filenames.includes(name))
            return true
        case "GET /api/v1/filecache/total-size":
            return s.cacheSize
        case "DELETE /api/v1/filecache/bucket":
            s.cacheSize = "0 B"
            return true
        case "GET /api/v1/memory/stats":
        case "POST /api/v1/memory/gc":
            return s.memory
        case "GET /api/v1/extensions/list/manga-provider":
            return s.mangaProviders
        case "GET /api/v1/extensions/list/anime-entry-episode-tabs":
            return s.episodeTabs
        case "GET /api/v1/extensions/list/anime-torrent-provider":
            return s.torrentProviders ?? []
        case "PATCH /api/v1/torrentstream/settings":
            s.status.torrentstreamSettings = { ...body.settings, id: 1, updatedAt: `t${Date.now()}` }
            return s.status.torrentstreamSettings
        case "PATCH /api/v1/debrid/settings":
            s.status.debridSettings = { ...body.settings, id: 1, updatedAt: `t${Date.now()}` }
            return s.status.debridSettings
        case "GET /api/v1/debrid/torrents": {
            // As the server answers: no provider after a failed sign-in, else the provider's own error for a wrong key
            const debrid = s.status.debridSettings
            if (!debrid?.enabled || !debrid.provider) throw seaError("debrid: Provider not set")
            if (debrid.apiKey !== s.validDebridKey) throw seaError(`torbox: Failed to get torrents: request failed: code 403, body: {"detail":"Invalid API key ${debrid.apiKey}"}`)
            return []
        }
    }
    if (method === "GET" && endpoint.startsWith("/api/v1/log/")) return `${decodeURIComponent(endpoint.slice(12))}\n2026-10-21 12:00:00 |INF| server started`
    throw new Error(`No fixture for ${route}`)
}

// window.failWhen holds substrings of "METHOD endpoint body-json" that answer with an error.
async function serve(method: string, endpoint: string, data: unknown) {
    const body = data === undefined ? null : JSON.parse(JSON.stringify(data))
    w.requests.push([method, endpoint, body])
    await new Promise(resolve => setTimeout(resolve, w.latency ?? 80))
    const probe = `${method} ${endpoint} ${JSON.stringify(body)}`
    if ((w.failWhen ?? []).some((part: string) => probe.includes(part))) throw Object.assign(new Error("Server error"), { response: { status: 500, data: { error: "fixture" } } })
    const answer = respond(method, endpoint, body)
    if (method !== "GET") persist()
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
