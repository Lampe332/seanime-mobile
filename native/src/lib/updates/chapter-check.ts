// geschrieben nach: lib/airing/airing-notifier.ts (Kanal, Berechtigung, Hintergrund-Job), den Kern-Routen GET /api/v1/manga/collection, /manga/preferences, /extensions/list/manga-provider, /status und POST /manga/chapters (core/manga/manga.ts hält die Kapitelliste 1 h) und dem Plan „Updates-Seite + Benachrichtigung neue Manga-Kapitel“; eigene Regel

import { getAppLanguage, tr } from "@/lib/app-language"
import { mangaLink } from "@/lib/app-links"
import { atomWithStorage, readStoredJSON, storage } from "@/lib/storage"
import * as Notifications from "expo-notifications"
import { AndroidImportance } from "expo-notifications"
import { Platform } from "react-native"
import {
    chapterItems,
    chapterNotice,
    dueCandidates,
    fallbackProvider,
    highestChapter,
    type MangaCandidate,
    mangaCandidates,
    mergeFeed,
    newChapterNumbers,
    type UpdateItem,
} from "./updates-policy"

/*
 * New manga chapters (Updates page, notifications). A check asks the chosen source of each Reading manga for its chapter
 * list through the core (which keeps a list for an hour) and compares the highest chapter with the one it knew; what is
 * above is new: kept in the local feed and, from the background job, announced once per chapter. Sparing with the
 * sources: a few manga per run, one after the other with a pause, each at most every few hours.
 */

const ENABLED_KEY = "seanime-mobile-chapter-notifications"
const KNOWN_KEY = "seanime-mobile-chapter-known"
const CHECKED_KEY = "seanime-mobile-chapter-checked"
const FEED_KEY = "seanime-mobile-updates-chapters"
const NEXT_RUN_KEY = "seanime-mobile-chapter-next-run"
const ENTRY_PROVIDER_KEY = "sea-manga-entry-provider"

const CHANNEL = "new_chapters"
/** The background check runs at most this often */
export const BACKGROUND_EVERY_MS = 4 * 60 * 60 * 1000
/** Manga per background run */
export const BACKGROUND_MAX = 8
/** Manga per check from the Updates page; a manga checked within PAGE_MIN_AGE_MS is not asked again */
export const PAGE_MAX = 20
export const PAGE_MIN_AGE_MS = 60 * 60 * 1000
/** Pause between two sources' answers */
const GAP_MS = 1500

export const chapterNotificationsAtom = atomWithStorage<boolean>(ENABLED_KEY, true)

export function isChapterNotifyEnabled() {
    return readStoredJSON(ENABLED_KEY, true)
}

export function writeChapterNotifyEnabled(enabled: boolean) {
    storage.set(ENABLED_KEY, JSON.stringify(enabled))
}

// ---- the feed, read by the page and the Menu's count ----

const listeners = new Set<() => void>()
let cached: { raw: string | undefined, value: UpdateItem[] } | null = null

export function readChapterFeed(): UpdateItem[] {
    const raw = storage.getString(FEED_KEY)
    if (cached && cached.raw === raw) return cached.value
    cached = { raw, value: readStoredJSON<UpdateItem[]>(FEED_KEY, []) }
    return cached.value
}

export function subscribeChapterFeed(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function writeJSON(key: string, value: unknown) {
    storage.set(key, JSON.stringify(value))
}

// ---- the core ----

async function core<T>(endpoint: string, method: "GET" | "POST" = "GET", data?: unknown): Promise<T | undefined> {
    const { buildSeaQuery } = await import("@/api/client/requests")
    return buildSeaQuery<T>({ endpoint, method, data })
}

type MangaCollection = { lists?: Parameters<typeof mangaCandidates>[0][number][] }

async function candidates(): Promise<MangaCandidate[]> {
    const [collection, preferences, installed, status] = await Promise.all([
        core<MangaCollection>("/api/v1/manga/collection"),
        core<{ entries?: Record<string, { provider?: string }> }>("/api/v1/manga/preferences").catch(() => undefined),
        core<{ id: string, name?: string }[]>("/api/v1/extensions/list/manga-provider").catch(() => undefined),
        core<{ settings?: { manga?: { defaultMangaProvider?: string } } }>("/api/v1/status").catch(() => undefined),
    ])
    // the manga's own choice: the core's preferences, else the one the app kept (handle-manga-selected-provider.ts)
    const chosen: Record<number, string> = {}
    for (const [id, provider] of Object.entries(readStoredJSON<Record<string, string>>(ENTRY_PROVIDER_KEY, {}))) chosen[Number(id)] = provider
    for (const [id, preference] of Object.entries(preferences?.entries ?? {})) if (preference?.provider) chosen[Number(id)] = preference.provider
    const sources = installed ?? []
    return mangaCandidates(collection?.lists ?? [], chosen, sources.map(item => item.id), fallbackProvider(sources, status?.settings?.manga?.defaultMangaProvider))
}

// ---- notifications ----

async function canPost() {
    if (Platform.OS !== "android") return false
    return (await Notifications.getPermissionsAsync()).granted
}

async function ensureChannel() {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: tr("New chapters", "Neue Kapitel"),
        importance: AndroidImportance.DEFAULT,
    })
}

async function announce(manga: MangaCandidate, numbers: number[]) {
    await Notifications.scheduleNotificationAsync({
        identifier: `chapter-${manga.mediaId}`,
        content: {
            title: chapterNotice(manga.title, numbers, getAppLanguage() === "de"),
            // tapping opens the manga page (app-links.ts `manga?id=`)
            data: { url: mangaLink(manga.mediaId) },
            autoDismiss: true,
        },
        trigger: { channelId: CHANNEL },
    })
}

// ---- the check ----

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

let running: Promise<number> | null = null

/**
 * Checks the due Reading manga; [notify]: announce what is new (the background job, the test link). Resolves the number
 * of new chapters found. One check at a time; a second caller joins the running one.
 */
export function checkNewChapters({ max, minAgeMs, notify }: { max: number, minAgeMs: number, notify: boolean }): Promise<number> {
    if (!running) {
        running = runCheck(max, minAgeMs, notify).finally(() => {
            running = null
        })
    }
    return running
}

async function runCheck(max: number, minAgeMs: number, notify: boolean): Promise<number> {
    const now = Date.now()
    const due = dueCandidates(await candidates(), readStoredJSON<Record<number, number>>(CHECKED_KEY, {}), now, minAgeMs, max)
    if (due.length === 0) return 0
    const allowed = notify && await canPost()
    if (allowed) await ensureChannel()
    const added: UpdateItem[] = []
    for (const [index, manga] of due.entries()) {
        if (index > 0) await wait(GAP_MS)
        let chapters: { chapter?: unknown }[]
        try {
            const answer = await core<{ chapters?: { chapter?: unknown }[] }>("/api/v1/manga/chapters", "POST", { mediaId: manga.mediaId, provider: manga.provider })
            chapters = answer?.chapters ?? []
        }
        catch {
            // a source that failed is asked again on its next turn, not at once
            chapters = []
        }
        // read and written per manga, so a reset by the test link or another check in between is not lost
        const checked = readStoredJSON<Record<number, number>>(CHECKED_KEY, {})
        writeJSON(CHECKED_KEY, { ...checked, [manga.mediaId]: Date.now() })
        const highest = highestChapter(chapters)
        if (highest <= 0) continue
        const known = readStoredJSON<Record<number, number>>(KNOWN_KEY, {})
        const numbers = newChapterNumbers(known[manga.mediaId], chapters)
        writeJSON(KNOWN_KEY, { ...known, [manga.mediaId]: Math.max(known[manga.mediaId] ?? 0, highest) })
        if (numbers.length === 0) continue
        added.push(...chapterItems(manga, numbers, Date.now()))
        if (allowed) await announce(manga, numbers).catch(() => undefined)
    }
    if (added.length > 0) {
        writeJSON(FEED_KEY, mergeFeed(readChapterFeed(), added, Date.now()))
        for (const listener of listeners) listener()
    }
    return added.length
}

/** The background job's part (and the app start's): at most every BACKGROUND_EVERY_MS, while the notifications are on */
export async function checkChaptersInBackground(): Promise<number> {
    if (!isChapterNotifyEnabled() || Platform.OS !== "android") return 0
    const now = Date.now()
    const next = storage.getNumber(NEXT_RUN_KEY) ?? 0
    if (now < next && next - now <= BACKGROUND_EVERY_MS) return 0
    storage.set(NEXT_RUN_KEY, now + BACKGROUND_EVERY_MS)
    return checkNewChapters({ max: BACKGROUND_MAX, minAgeMs: BACKGROUND_EVERY_MS - 10 * 60 * 1000, notify: true })
}

/**
 * Test and scratch app only (`dev/check-updates`): every known manga is set one chapter back, then checked at once with
 * notifications, so the newest chapter shows in the feed and as a notification. A manga never checked gets its baseline
 * first.
 */
export async function checkChaptersForTest(): Promise<number> {
    await checkNewChapters({ max: PAGE_MAX, minAgeMs: 0, notify: false })
    const known = readStoredJSON<Record<number, number>>(KNOWN_KEY, {})
    writeJSON(KNOWN_KEY, Object.fromEntries(Object.entries(known).map(([id, number]) => [id, Math.max(0, number - 1)])))
    writeJSON(CHECKED_KEY, {})
    return checkNewChapters({ max: PAGE_MAX, minAgeMs: 0, notify: true })
}
