import { buildSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Anime_Entry, Manga_Entry, Nullish } from "@/api/generated/types"
import type { QueryClient } from "@tanstack/react-query"

type EntryPreloadType = "anime" | "manga"

type EntryPreloadTarget = {
    type: EntryPreloadType
    id: string
}

type EntryPreloadOptions = {
    bypassBudget?: boolean
}

export const ENTRY_PRELOAD_STALE_TIME = 10 * 1000
const ENTRY_PRELOAD_GC_TIME = 90 * 1000
// dense grids and viewport preloading can surface a lot of entry cards at once
const TOKEN_CAPACITY = 10
const TOKEN_REFILL_MS = 6000
const MAX_QUEUED_PRELOADS = 24

let tokens = TOKEN_CAPACITY
let lastRefill = Date.now()
let queueTimer: number | undefined
let preloaderQueryClient: QueryClient | undefined
let getAuthToken: () => string | undefined = () => undefined
let canPreloadEntries: () => boolean = () => true

const inFlight = new Set<string>()
const queued = new Map<string, EntryPreloadTarget>()
const warmedAt = new Map<string, number>()

export function initEntryPreloader(
    queryClient: QueryClient,
    authTokenGetter: () => string | undefined,
    preloadEnabledGetter?: () => boolean,
) {
    preloaderQueryClient = queryClient
    getAuthToken = authTokenGetter
    canPreloadEntries = preloadEnabledGetter ?? (() => true)
}

function clearQueuedPreloads() {
    queued.clear()

    if (queueTimer && typeof window !== "undefined") {
        window.clearTimeout(queueTimer)
        queueTimer = undefined
    }
}

function isEntryPreloadingEnabled() {
    const enabled = canPreloadEntries()

    if (!enabled) {
        clearQueuedPreloads()
    }

    return enabled
}

function getTargetKey(target: EntryPreloadTarget) {
    return `${target.type}:${target.id}`
}

function normalizePath(pathname: string) {
    return pathname.replace(/\/$/, "")
}

function getEntryPreloadTarget(href: Nullish<string>): EntryPreloadTarget | undefined {
    if (!href || typeof window === "undefined") return undefined

    let url: URL
    try {
        url = new URL(href, window.location.origin)
    }
    catch {
        return undefined
    }

    if (url.origin !== window.location.origin) return undefined

    const id = url.searchParams.get("id")
    if (!id) return undefined

    const pathname = normalizePath(url.pathname)
    if (pathname === "/entry") return { type: "anime", id }
    if (pathname === "/manga/entry") return { type: "manga", id }

    return undefined
}

function getAnimeEntryQueryKey(id: string) {
    return [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, id]
}

function getMangaEntryQueryKey(id: string) {
    return [API_ENDPOINTS.MANGA.GetMangaEntry.key, id]
}

function isQueryFresh(queryKey: Array<string>) {
    if (!preloaderQueryClient) return false

    const state = preloaderQueryClient.getQueryState(queryKey)
    return !!state?.dataUpdatedAt && Date.now() - state.dataUpdatedAt < ENTRY_PRELOAD_STALE_TIME
}

function isWarm(target: EntryPreloadTarget) {
    const warmed = warmedAt.get(getTargetKey(target))
    if (warmed && Date.now() - warmed < ENTRY_PRELOAD_STALE_TIME) return true

    // only the main entry payload participates here so the page shell can render before details
    if (target.type === "anime") {
        return isQueryFresh(getAnimeEntryQueryKey(target.id))
    }

    return isQueryFresh(getMangaEntryQueryKey(target.id))
}

function refillTokens() {
    const now = Date.now()
    const elapsed = now - lastRefill
    if (elapsed < TOKEN_REFILL_MS) return

    const refill = Math.floor(elapsed / TOKEN_REFILL_MS)
    tokens = Math.min(TOKEN_CAPACITY, tokens + refill)
    lastRefill += refill * TOKEN_REFILL_MS
}

function takeToken() {
    refillTokens()
    if (tokens <= 0) return false
    tokens -= 1
    return true
}

function scheduleQueue() {
    if (!isEntryPreloadingEnabled()) return
    if (queueTimer || queued.size === 0 || typeof window === "undefined") return

    // keep hover and viewport warming even when a whole card row becomes visible together
    refillTokens()
    const delay = tokens > 0 ? 0 : Math.max(100, TOKEN_REFILL_MS - (Date.now() - lastRefill))
    queueTimer = window.setTimeout(drainQueue, delay)
}

function drainQueue() {
    queueTimer = undefined
    if (!isEntryPreloadingEnabled()) return
    refillTokens()

    while (tokens > 0 && queued.size > 0) {
        const next = queued.entries().next().value
        if (!next) break

        const [key, target] = next
        queued.delete(key)

        if (inFlight.has(key) || isWarm(target)) continue

        tokens -= 1
        void runEntryPreload(target)
    }

    scheduleQueue()
}

async function runEntryPreload(target: EntryPreloadTarget) {
    if (!preloaderQueryClient || !isEntryPreloadingEnabled()) return

    const key = getTargetKey(target)
    if (inFlight.has(key) || isWarm(target)) return

    inFlight.add(key)

    try {
        const password = getAuthToken()

        if (target.type === "anime") {
            await preloaderQueryClient.prefetchQuery<Anime_Entry | undefined>({
                queryKey: getAnimeEntryQueryKey(target.id),
                queryFn: () => buildSeaQuery<Anime_Entry>({
                    endpoint: API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.endpoint.replace("{id}", target.id),
                    method: API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.methods[0],
                    password,
                }),
                staleTime: ENTRY_PRELOAD_STALE_TIME,
                gcTime: ENTRY_PRELOAD_GC_TIME,
            })
        } else {
            await preloaderQueryClient.prefetchQuery<Manga_Entry | undefined>({
                queryKey: getMangaEntryQueryKey(target.id),
                queryFn: () => buildSeaQuery<Manga_Entry>({
                    endpoint: API_ENDPOINTS.MANGA.GetMangaEntry.endpoint.replace("{id}", target.id),
                    method: API_ENDPOINTS.MANGA.GetMangaEntry.methods[0],
                    password,
                }),
                staleTime: ENTRY_PRELOAD_STALE_TIME,
                gcTime: ENTRY_PRELOAD_GC_TIME,
            })
        }

        warmedAt.set(key, Date.now())
    }
    catch {
    }
    finally {
        inFlight.delete(key)
        scheduleQueue()
    }
}

export function preloadMediaEntry(href: Nullish<string>, options?: EntryPreloadOptions) {
    if (!isEntryPreloadingEnabled()) return

    const target = getEntryPreloadTarget(href)
    if (!target) return

    const key = getTargetKey(target)
    if (inFlight.has(key) || isWarm(target)) return

    // collection-backed entries can skip the budget
    if (options?.bypassBudget) {
        queued.delete(key)
        void runEntryPreload(target)
        return
    }

    if (queued.has(key)) return

    if (takeToken()) {
        void runEntryPreload(target)
        return
    }

    if (queued.size >= MAX_QUEUED_PRELOADS) {
        const oldestKey = queued.keys().next().value
        if (oldestKey) queued.delete(oldestKey)
    }

    queued.set(key, target)
    scheduleQueue()
}

export function getEntryPreloadStaleTime(type: EntryPreloadType, id: Nullish<string | number>) {
    if (!id) return 0

    const warmed = warmedAt.get(`${type}:${String(id)}`)
    if (!warmed) return 0

    return Math.max(0, ENTRY_PRELOAD_STALE_TIME - (Date.now() - warmed))
}
