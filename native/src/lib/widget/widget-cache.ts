/**
 * The widget's last list (WidgetCache.kt). Entries keep their airing time, so the countdowns stay right on every redraw
 * without a fetch. The list is fresh for a few hours or until its first episode airs (then the next one is unknown);
 * after that it is still shown, with its time, until a fetch succeeds. Pure over a small key-value store, so it can be
 * unit tested; widget-task.tsx passes MMKV.
 */
export type WidgetEntry = { title: string, episode: number, airingAt: number, mediaId: number, coverUrl: string }

/** A fetched row: seconds until it airs, as AniList reports it. */
export type FetchedEntry = Omit<WidgetEntry, "airingAt"> & { timeUntil: number }

export type KeyValue = {
    getString(key: string): string | undefined
    getNumber(key: string): number | undefined
    getBoolean(key: string): boolean | undefined
    set(key: string, value: string | number | boolean): void
    remove(key: string): void
    contains(key: string): boolean
}

const KEY_DATA = "widget.anime_cache_data"
const KEY_TIMESTAMP = "widget.cache_timestamp"
const KEY_LOADING = "widget.is_loading"
const KEY_ERROR = "widget.error_message"
const KEY_ERROR_TIMESTAMP = "widget.error_timestamp"
const KEY_NEXT_AIRING = "widget.next_airing"
const CACHE_DURATION = 3 * 60 * 60 * 1000
// a failed fetch is not repeated by every redraw, only by the refresh button or after this
const ERROR_PAUSE = 15 * 60 * 1000

export function createWidgetCache(store: KeyValue, clock: () => number = Date.now) {
    return {
        save(entries: FetchedEntry[]) {
            const now = clock()
            const saved: WidgetEntry[] = entries.map(({ timeUntil, ...entry }) => ({ ...entry, airingAt: Math.floor(now / 1000) + timeUntil }))
            const nextAiring = saved.length ? Math.min(...saved.map(it => it.airingAt)) : Number.MAX_SAFE_INTEGER
            store.set(KEY_DATA, JSON.stringify(saved))
            store.set(KEY_TIMESTAMP, now)
            store.set(KEY_NEXT_AIRING, nextAiring)
            store.set(KEY_LOADING, false)
            store.remove(KEY_ERROR)
            store.remove(KEY_ERROR_TIMESTAMP)
        },

        /** The last list, also an outdated one, without the episodes that aired since, soonest first. */
        entries(): WidgetEntry[] {
            const now = Math.floor(clock() / 1000)
            try {
                const list = JSON.parse(store.getString(KEY_DATA) ?? "[]") as WidgetEntry[]
                return list.filter(it => it.airingAt > now).sort((a, b) => a.airingAt - b.airingAt)
            }
            catch {
                return []
            }
        },

        setLoading(loading: boolean) {
            store.set(KEY_LOADING, loading)
        },
        isLoading: () => store.getBoolean(KEY_LOADING) ?? false,

        /** The refresh button forgets the last error; its loading flag makes the list fetch while the last one stays visible. */
        clearError() {
            store.remove(KEY_ERROR)
            store.remove(KEY_ERROR_TIMESTAMP)
        },
        setError(message: string) {
            store.set(KEY_ERROR, message)
            store.set(KEY_ERROR_TIMESTAMP, clock())
            store.set(KEY_LOADING, false)
        },
        error: () => store.getString(KEY_ERROR) ?? null,
        recentError: () => store.getString(KEY_ERROR) !== undefined && clock() - (store.getNumber(KEY_ERROR_TIMESTAMP) ?? 0) < ERROR_PAUSE,

        /** When the shown list was fetched (ms), 0 for none. */
        savedAt: () => store.getNumber(KEY_TIMESTAMP) ?? 0,

        hasValidCache(): boolean {
            const now = clock()
            return store.contains(KEY_DATA) && now - (store.getNumber(KEY_TIMESTAMP) ?? 0) < CACHE_DURATION &&
                Math.floor(now / 1000) < (store.getNumber(KEY_NEXT_AIRING) ?? Number.MAX_SAFE_INTEGER)
        },
    }
}

export type WidgetCache = ReturnType<typeof createWidgetCache>

/** "2d 5h" from a day on, else "5h 12m" (AnimeListFactory.getViewAt). */
export function countdown(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds))
    const days = Math.floor(s / 86400)
    const hours = Math.floor((s % 86400) / 3600)
    const minutes = Math.floor((s % 3600) / 60)
    return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`
}

/** HH:mm, with the date when it is not from today ("MMM d, HH:mm" / "dd.MM., HH:mm"). */
export function stampText(millis: number, now: number, german: boolean): string {
    const date = new Date(millis)
    const today = new Date(now)
    const pad = (n: number) => String(n).padStart(2, "0")
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
    if (date.toDateString() === today.toDateString()) return time
    if (german) return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}., ${time}`
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return `${months[date.getMonth()]} ${date.getDate()}, ${time}`
}
