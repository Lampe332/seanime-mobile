import type { AL_BaseAnime, Anime_Entry, Anime_EntryDownloadInfo, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import type { Translate } from "@/lib/app-language"
import { upath } from "@/lib/helpers/upath"
import { atomWithStorage, readStoredJSON, storage } from "@/lib/storage"
import type { TorrentLanguage, TorrentSort } from "@/main/entry/_containers/torrent-search/_lib/torrent-filters"
import type { TorrentSelectionType } from "@/main/entry/_containers/torrent-search/torrent-search.atoms"
import { addDays } from "date-fns/addDays"
import { addHours } from "date-fns/addHours"
import { addMonths } from "date-fns/addMonths"
import { addYears } from "date-fns/addYears"
import { formatDistanceStrict } from "date-fns/formatDistanceStrict"
import { subDays } from "date-fns/subDays"
import { subMonths } from "date-fns/subMonths"
import { de } from "date-fns/locale/de"

/*
 * The logic of the phone torrent sheet (torrent-search-phone.tsx) without its screen: what the sheet is for, the stored
 * choices, the facts line of a result, the missing episodes as ranges, the download destination and its errors.
 */

export type TorrentSheetKind = "torrent" | "debrid" | "download"

export const RESOLUTIONS = ["2160", "1080", "720", "480"]
export const SIZES = [500, 1000, 2000, 5000].map(mb => mb * 1_000_000)

/** The German switch of earlier versions ("true" under this key) becomes the German language */
export const LEGACY_GERMAN_KEY = "sea-torrent-search-phone-german"
export const LANGUAGES_KEY = "sea-torrent-search-phone-languages"

/** The stored languages, or German for someone who had the old German switch on and never chose languages since */
export function initialTorrentLanguages(legacyGerman: string | undefined, stored: TorrentLanguage[] | undefined): TorrentLanguage[] {
    if (stored) return stored
    return legacyGerman === "true" ? ["de"] : []
}

// The providers searched together (the first decides what the search can do) and the languages, kept for the next search
export const __torrentSearchPhone_providersAtom = atomWithStorage<string[]>("sea-torrent-search-phone-providers", [])
export const __torrentSearchPhone_languagesAtom = atomWithStorage<TorrentLanguage[]>(LANGUAGES_KEY,
    initialTorrentLanguages(storage.getString(LEGACY_GERMAN_KEY), readStoredJSON<TorrentLanguage[] | undefined>(LANGUAGES_KEY, undefined)))
export const __torrentSearchPhone_sortAtom = atomWithStorage<TorrentSort>("sea-torrent-search-phone-sort", "best")

/** Phones pick the episode's file from a batch automatically; the desktop file pickers are not used here. */
export function streamKind(type: TorrentSelectionType | undefined): TorrentSheetKind | undefined {
    if (type === "torrentstream-select" || type === "torrentstream-select-file") return "torrent"
    if (type === "debridstream-select" || type === "debridstream-select-file") return "debrid"
    if (type === "download") return "download"
    return undefined
}

/**
 * Whether the search starts with whole seasons: a download of missing episodes of an anime that ended at least 6 days
 * ago, a stream of one that ended at least a month ago (and the provider can search batches for it).
 */
export function shouldLookForBatches(kind: TorrentSheetKind, downloadInfo: Pick<Anime_EntryDownloadInfo, "canBatch" | "episodesToDownload"> | undefined,
    endDate: AL_BaseAnime["endDate"] | undefined, now = new Date()) {
    const end = endDate?.year ? new Date(endDate.year, (endDate.month || 1) - 1, endDate.day || 1) : null
    if (kind === "download") return !!downloadInfo?.canBatch && !!downloadInfo?.episodesToDownload?.length && !(end && subDays(now, 6) < end)
    return !!downloadInfo?.canBatch && !(end && subMonths(now, 1) < end)
}

/** Release names sometimes come with HTML entities from the provider ("Returner&#39;s") */
export function decodeEntities(text: string) {
    return text.replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code: string) => {
        const lower = code.toLowerCase()
        if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16))
        if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10))
        return ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " } as Record<string, string>)[lower] ?? match
    })
}

type AgoUnit = "hour" | "day" | "month" | "year"

/** "3 days ago" in the app language; empty without a date */
export function ago(date: string, language: string, now = Date.now()) {
    const time = Date.parse(date)
    if (!time) return ""
    const hours = Math.round((time - now) / 3_600_000)
    const days = Math.round(hours / 24)
    const [value, unit]: [number, AgoUnit] = Math.abs(hours) < 24 ? [hours, "hour"] : Math.abs(days) < 31 ? [days, "day"]
        : Math.abs(days) < 365 ? [Math.round(days / 30), "month"] : [Math.round(days / 365), "year"]
    return relative(value, unit, language)
}

/** Intl.RelativeTimeFormat where the engine has it (Hermes may not), else the same words from date-fns */
function relative(value: number, unit: AgoUnit, language: string) {
    if (typeof Intl.RelativeTimeFormat === "function") return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(value, unit)
    const base = new Date(0)
    const other = unit === "hour" ? addHours(base, value) : unit === "day" ? addDays(base, value) : unit === "month" ? addMonths(base, value) : addYears(base, value)
    return formatDistanceStrict(other, base, { addSuffix: true, unit, locale: language === "de" ? de : undefined })
}

/** The facts line under a result: provider (several searched), best, cached, batch, group, resolution, size, seeders, age */
export function torrentMeta(torrent: HibikeTorrent_AnimeTorrent, t: Translate, language: string, cached: boolean, provider = "", now = Date.now()) {
    const parts = [
        provider,
        torrent.isBestRelease ? t("Best release", "Bestes Release") : "",
        cached ? t("Cached", "Gecacht") : "",
        torrent.isBatch ? "Batch" : "",
        torrent.releaseGroup || "",
        torrent.resolution || "",
        torrent.formattedSize || "",
        // Providers without seeder counts send -1
        torrent.seeders > 0 ? t(`${torrent.seeders} seeders`, `${torrent.seeders} Seeder`)
            : torrent.seeders < 0 ? t("Seeders unknown", "Seeder unbekannt") : t("No seeders", "Keine Seeder"),
        ago(torrent.date, language, now),
    ]
    return parts.filter(Boolean).join(" · ")
}

/** "1–3, 5" */
export function episodeList(numbers: number[]) {
    const out: string[] = []
    for (let i = 0; i < numbers.length; i++) {
        let j = i
        while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++
        out.push(j > i ? `${numbers[i]}–${numbers[j]}` : `${numbers[i]}`)
        i = j
    }
    return out.join(", ")
}

export function toggled<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter(item => item !== value) : [...list, value]
}

/** "≤ 500 MB", "≤ 2 GB" */
export function sizeLabel(bytes: number) {
    return bytes >= 1_000_000_000 ? `≤ ${bytes / 1_000_000_000} GB` : `≤ ${bytes / 1_000_000} MB`
}

/** "Only the episodes you are missing" needs a torrent that holds all of them, from one season; the sheet stays open to pick another way. */
export function downloadError(reason: string, t: Translate) {
    if (/could not find the right season files/i.test(reason)) {
        return t("This torrent doesn't hold every missing episode. Choose \"Everything in the torrent\" or another torrent.",
            "Dieser Torrent enthält nicht alle fehlenden Folgen. Wähle „Alles im Torrent“ oder einen anderen Torrent.")
    }
    if (/can't tell seasons apart/i.test(reason)) {
        return t("This torrent mixes seasons. Choose \"Everything in the torrent\" or another torrent.",
            "Dieser Torrent mischt Staffeln. Wähle „Alles im Torrent“ oder einen anderen Torrent.")
    }
    return reason
}

/** One torrent holding the whole season of a finished series of which some, not all, episodes are missing */
export function canSmartSelect(torrents: Pick<HibikeTorrent_AnimeTorrent, "isBatch">[] | null | undefined,
    media: Pick<AL_BaseAnime, "format" | "status" | "episodes"> | undefined, missing: number[]) {
    return torrents?.length === 1 && !!torrents[0].isBatch && media?.format !== "MOVIE" && media?.status === "FINISHED"
        && (media?.episodes ?? 0) > 1 && missing.length > 0 && missing.length !== media?.episodes
}

/** torrent-download-file-selection.tsx: next to the anime's files, else a folder named after it in the library */
export function getDefaultDestination(entry: Pick<Anime_Entry, "localFiles" | "media">, libraryPath?: string): string {
    const files = entry.localFiles ?? []
    const fPath = files.length ? files[files.length - 1]?.path : undefined
    const newPath = libraryPath ? upath.join(libraryPath, sanitizeDirectoryName(entry.media?.title?.romaji || "")) : ""
    return fPath ? upath.normalize(upath.dirname(fPath)) : newPath
}

export function sanitizeDirectoryName(input: string): string {
    // Pattern for disallowed characters (with the control characters)
    const disallowedChars = /[<>:"/\\|?*\x00-\x1F]/g
    const sanitized = input.replace(disallowedChars, " ")
    const trimmed = sanitized.trim().replace(/^\.+|\.+$/g, "").replace(/\s+/g, " ")
    return trimmed || "Untitled"
}
