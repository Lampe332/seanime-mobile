import type { Anime_Entry, Status } from "@/api/generated/types"
import type { Translate } from "@/lib/app-language"
import { atomWithStorage } from "@/lib/storage"
import { atom } from "jotai"

/*
 * Which source an anime page shows (anime-entry-page.tsx): the local library, torrent streaming, debrid streaming or
 * online streaming. Plugin episode tabs come with the plugins (2.17); a plugin source ("ext:…", "episodeTab:…") counts as
 * unavailable until then and the page falls back to its usual view.
 */

export type AnimeEntryView = "library" | "torrentstream" | "debridstream" | "onlinestream"
export const STREAM_VIEWS = ["torrentstream", "debridstream", "onlinestream"] as const

/**
 * Which source views have their native screen (anime-entry-page.tsx); the others are left out like a hidden tab.
 * All three are there since 2.15 (online streaming); a new source starts false until its screen exists.
 */
export const NATIVE_VIEW_READY: Record<(typeof STREAM_VIEWS)[number], boolean> = { torrentstream: true, debridstream: true, onlinestream: true }
export const NOT_READY_VIEWS: string[] = STREAM_VIEWS.filter(view => !NATIVE_VIEW_READY[view])

export const __anime_entryPageViewAtom = atom<AnimeEntryView>("library")

/** Streaming tabs hidden on this device's anime pages (More → Tabs); the library tab always stays. */
export const __anime_hiddenEntryViewsAtom = atomWithStorage<string[]>("sea-anime-entry-hidden-views", [])

type StatusLike = Pick<Status, "debridSettings" | "torrentstreamSettings" | "settings"> | null | undefined

export function isBuiltInAnimeEntryViewAvailable(view: string, serverStatus: StatusLike, hidden: string[]) {
    if (view !== "library" && hidden.includes(view)) return false
    switch (view) {
        case "library":
            return true
        case "debridstream":
            return !!serverStatus?.debridSettings?.enabled
        case "torrentstream":
            return !!serverStatus?.torrentstreamSettings?.enabled
        case "onlinestream":
            return !!serverStatus?.settings?.library?.enableOnlinestream
        default:
            return false
    }
}

/** Online streaming for an anime outside the library when it is on, the library otherwise */
export function getAutomaticAnimeEntryView(entry: Pick<Anime_Entry, "libraryData"> | undefined, serverStatus: StatusLike, hidden: string[]): AnimeEntryView {
    return isBuiltInAnimeEntryViewAvailable("onlinestream", serverStatus, hidden) && !entry?.libraryData ? "onlinestream" : "library"
}

/**
 * The view a page opens with: an upcoming anime only has its library tab; then the `tab` of the link, then the default
 * playback source of the settings, then the automatic view.
 */
export function getInitialAnimeEntryView({ entry, serverStatus, hidden, tab }: {
    entry: Pick<Anime_Entry, "libraryData" | "media"> | undefined
    serverStatus: StatusLike
    hidden: string[]
    tab?: string | null
}): AnimeEntryView {
    if (entry?.media?.status === "NOT_YET_RELEASED") return "library"
    if (tab && isBuiltInAnimeEntryViewAvailable(tab, serverStatus, hidden)) return tab as AnimeEntryView
    const defaultSource = serverStatus?.settings?.library?.defaultPlaybackSource || ""
    if (defaultSource && isBuiltInAnimeEntryViewAvailable(defaultSource, serverStatus, hidden)) return defaultSource as AnimeEntryView
    return getAutomaticAnimeEntryView(entry, serverStatus, hidden)
}

/**
 * The view the page shows (anime-entry-page.tsx). A page that was left keeps its view while it is hidden: switching it
 * to the library there rebuilt the hidden page (the episodes, characters and relations) right when Back flew the cover
 * into its card, and the flight stood still meanwhile (S22 ~0.45 s, tablet up to 1.1 s). Shown again it starts from its
 * first view at once: `start` once the anime is there, the library until then (what the reset on leaving showed).
 */
export function shownAnimeEntryView(stored: AnimeEntryView, focused: boolean, left: boolean, start: AnimeEntryView | null): AnimeEntryView {
    if (!focused || !left) return stored
    return start ?? "library"
}

/** The source tabs over the episodes; none when only the library is there (EntrySectionTabs) */
export function getAnimeEntryTabs(t: Translate, entry: Pick<Anime_Entry, "media"> | undefined, serverStatus: StatusLike, hidden: string[]) {
    if (!entry || entry.media?.status === "NOT_YET_RELEASED") return []
    const on = STREAM_VIEWS.filter(view => isBuiltInAnimeEntryViewAvailable(view, serverStatus, hidden))
    if (!on.length) return []
    // Phones split the row evenly: from three sources on, short names keep each tab on one line
    const short = 1 + on.length > 2
    const labels: Record<AnimeEntryView, string> = {
        library: short ? t("Library", "Bibliothek") : t("Local library", "Lokale Bibliothek"),
        torrentstream: short ? "Torrent" : t("Torrent streaming", "Torrent-Streaming"),
        debridstream: short ? "Debrid" : t("Debrid streaming", "Debrid-Streaming"),
        onlinestream: short ? "Online" : t("Online streaming", "Online-Streaming"),
    }
    return (["library", ...on] as AnimeEntryView[]).map(value => ({ value, label: labels[value] }))
}

/** The rows of More → Tabs: every streaming source, switchable when it is on, otherwise a link to its setting */
export function getEntryTabSettings(t: Translate, serverStatus: StatusLike) {
    return [
        { view: "torrentstream", settingsTab: "torrentstream", label: t("Torrent streaming", "Torrent-Streaming"), on: !!serverStatus?.torrentstreamSettings?.enabled },
        { view: "debridstream", settingsTab: "debrid", label: t("Debrid streaming", "Debrid-Streaming"), on: !!serverStatus?.debridSettings?.enabled },
        { view: "onlinestream", settingsTab: "onlinestream", label: t("Online streaming", "Online-Streaming"), on: !!serverStatus?.settings?.library?.enableOnlinestream },
    ]
}
