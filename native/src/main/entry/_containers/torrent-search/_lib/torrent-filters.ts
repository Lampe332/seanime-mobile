import type { HibikeTorrent_AnimeTorrent } from "@/api/generated/types"

export type TorrentLanguage = "de" | "en" | "fr" | "es" | "it" | "pt" | "ru" | "ar" | "zh" | "multi"
export type TorrentCodec = "hevc" | "avc" | "av1"
export type TorrentSource = "bluray" | "web"

export type TorrentFilters = {
    /** "2160", "1080", "720", … or "" for any */
    resolution: string
    /** Whole seasons (batches) only */
    batch: boolean
    /** Audio or subtitles in any of these languages */
    languages?: TorrentLanguage[]
    /** Japanese and another audio track */
    dualAudio?: boolean
    /** Leave out torrents nobody seeds */
    seeded?: boolean
    codecs?: TorrentCodec[]
    sources?: TorrentSource[]
    tenBit?: boolean
    /** Largest size in bytes, 0 for any; torrents without a size stay */
    maxSize?: number
    /** Words every name must contain; "-word" leaves names with it out */
    text?: string
}

export type TorrentSort = "best" | "seeders" | "newest" | "smallest" | "largest"

// How release names mark audio or subtitle languages: German, Deutsch, GER, GerDub, VOSTFR, SUB ITA, PT-BR, CHS, 简繁 …
const LANGUAGES: Record<Exclude<TorrentLanguage, "en">, RegExp> = {
    de: /german|deutsch|ger[-_. ]?(?:dub|sub)|\bger\b|\bde[-_. ]?(?:dub|sub)\b|\[de\]/i,
    fr: /french|fran[cç]ais|vostfr|\bvff?\b|\bfre\b|\bfra\b/i,
    es: /spanish|espa[nñ]ol|castellano|latino|\bspa\b|\besp\b/i,
    it: /italian|italiano|\bita\b/i,
    pt: /portugu|pt[-_. ]?br|\bpor\b|legendado|dublado/i,
    ru: /russian|\brus\b|anilibria|anidub|[Ѐ-ӿ]/i,
    ar: /arabic|\bara\b|[؀-ۿ]/i,
    zh: /chinese|\bch[st]\b|big5|[简繁粵]|中文|字幕/i,
    multi: /multi[-_. ]?subs?|multiple[-_. ]?subtitles?/i,
}
const ENGLISH = /english|\beng\b|eng[-_. ]?subs?|英[文语語]/i
// Raws carry no subtitles; Erai-raws is a subtitle group despite the name
const RAW = /(?<!erai-)\braws?\b/i
const CJK = /[぀-ヿ㐀-鿿]/

/** The word a title search adds to find releases in this language */
export const LANGUAGE_SEARCH_WORD: Partial<Record<TorrentLanguage, string>> = {
    de: "German", fr: "VOSTFR", es: "Spanish", it: "ITA", pt: "Portuguese", ru: "Russian", ar: "Arabic", zh: "Chinese",
}

/** Also read by the cards (torrent-facts.ts), so a card names the codec and source the filters find */
export const CODECS: Record<TorrentCodec, RegExp> = {
    hevc: /hevc|[xh][-_. ]?265/i,
    avc: /\bavc\b|[xh][-_. ]?264/i,
    av1: /\bav1\b/i,
}
export const SOURCES: Record<TorrentSource, RegExp> = {
    bluray: /blu[-_. ]?ray|\bbd(?:rip|remux|mv)?\b/i,
    web: /\bweb(?:[-_. ]?(?:dl|rip))?\b/i,
}
export const TEN_BIT = /10[-_. ]?bits?|\bhi10p?\b/i

// Batches: flagged by the provider, or named as a complete release, an episode range (01-12) or a season (S01, Season 2)
// that no episode number follows ("S3 - 08", "S02E05" are single episodes; "S01 1080p" is not one)
const BATCH = /\b(?:batch|complete|komplett|seasons|staffeln)\b|\b(?:(?:staffel|season)\s?|s)\d{1,2}\b(?![-–~ ]*(?:e\d|\d{1,3}(?![\dp]|bit)))|\b0?1\s*[-~]\s*\d{2,3}\b/i
const DUAL_AUDIO = /dual[-_. ]?audio|multi[-_. ]?audio|\bdual\b|\bdl\b/i

export function isGermanRelease(name: string) {
    return LANGUAGES.de.test(name)
}

/**
 * Whether the name marks the language. Most English releases carry no tag,
 * so English also covers multi-sub releases and names without another language, CJK text or a raw marker.
 */
export function isLanguageRelease(name: string, language: TorrentLanguage) {
    if (language !== "en") return LANGUAGES[language].test(name)
    if (ENGLISH.test(name) || LANGUAGES.multi.test(name)) return true
    return !RAW.test(name) && !CJK.test(name) && !Object.values(LANGUAGES).some(re => re.test(name))
}

function matchesAny<K extends string>(name: string, wanted: K[] | undefined, patterns: Record<K, RegExp>) {
    return !wanted?.length || wanted.some(key => patterns[key].test(name))
}

// A whole season is never this small: a provider's batch flag on a single ~150 MiB episode (Internet Archive reads no
// episode number in "Dr. Stone Sub 2" and calls the item a batch) is not believed
const SMALLEST_BATCH = 500 * 1024 * 1024

/** The provider's batch flag, unless the size is one of a single episode (an unknown size, 0, keeps the flag) */
export function isProviderBatch(torrent: Pick<HibikeTorrent_AnimeTorrent, "isBatch" | "size">) {
    return !!torrent.isBatch && !(torrent.size > 0 && torrent.size < SMALLEST_BATCH)
}

export function isBatchRelease(torrent: Pick<HibikeTorrent_AnimeTorrent, "name" | "isBatch" | "size">) {
    return isProviderBatch(torrent) || BATCH.test(torrent.name)
}

export function isDualAudioRelease(name: string) {
    return DUAL_AUDIO.test(name)
}

export function matchesResolution(torrent: Pick<HibikeTorrent_AnimeTorrent, "name" | "resolution">, resolution: string) {
    if (!resolution) return true
    const wanted = resolution.replace(/p$/i, "")
    if (torrent.resolution) return torrent.resolution.replace(/p$/i, "").replace(/^4k$/i, "2160") === wanted
    return new RegExp(wanted === "2160" ? "\\b(?:2160p?|4k|uhd)\\b" : `\\b${wanted}p?\\b`, "i").test(torrent.name)
}

export function matchesText(torrent: Pick<HibikeTorrent_AnimeTorrent, "name" | "releaseGroup">, text = "") {
    const haystack = `${torrent.name} ${torrent.releaseGroup ?? ""}`.toLowerCase()
    return text.toLowerCase().split(/\s+/).filter(Boolean).every(word => word.startsWith("-") && word.length > 1
        ? !haystack.includes(word.slice(1))
        : haystack.includes(word))
}

/** The results the chosen filters keep. `serverBatch`: the provider already searched batches only. */
export function filterTorrents<T extends HibikeTorrent_AnimeTorrent>(torrents: T[], filters: TorrentFilters, serverBatch = false): T[] {
    return torrents.filter(torrent => (!filters.languages?.length || filters.languages.some(language => isLanguageRelease(torrent.name, language)))
        && (!filters.batch || serverBatch || isBatchRelease(torrent))
        && (!filters.dualAudio || isDualAudioRelease(torrent.name))
        && (!filters.seeded || torrent.seeders > 0)
        && (!filters.tenBit || TEN_BIT.test(torrent.name))
        && matchesAny(torrent.name, filters.codecs, CODECS)
        && matchesAny(torrent.name, filters.sources, SOURCES)
        && (!filters.maxSize || !(torrent.size > 0) || torrent.size <= filters.maxSize)
        && matchesResolution(torrent, filters.resolution)
        && matchesText(torrent, filters.text))
}

/**
 * "best": by `place` first (4.2.0 E, the auto-select reading: 0 the Best match, 1 the rest, 2 releases of another show
 * such as a film or the live action, which auto-select leaves out), then best releases, then the most seeded (the order
 * the providers rank by stays for equal ones). The other sorts ignore `place`.
 */
export function sortTorrents<T extends HibikeTorrent_AnimeTorrent>(torrents: T[], sort: TorrentSort, place: (torrent: T) => number = () => 1): T[] {
    const list = [...torrents]
    switch (sort) {
        case "seeders":
            return list.sort((a, b) => b.seeders - a.seeders)
        case "newest":
            return list.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
        case "smallest":
            return list.sort((a, b) => (a.size || Number.MAX_SAFE_INTEGER) - (b.size || Number.MAX_SAFE_INTEGER))
        case "largest":
            // the best quality first for those who download it; an unknown size (0) goes last
            return list.sort((a, b) => (b.size || 0) - (a.size || 0))
        default:
            // !! because providers may leave isBestRelease out, and Number(undefined) is NaN
            return list.sort((a, b) => place(a) - place(b) || Number(!!b.isBestRelease) - Number(!!a.isBestRelease) || b.seeders - a.seeders)
    }
}

/**
 * Toggles a provider in the selection; the first one is the main provider (its settings decide what the search can do).
 * At least one stays selected.
 */
export function toggleProvider(selection: string[], id: string): string[] {
    if (!selection.includes(id)) return [...selection, id]
    if (selection.length === 1) return selection
    return selection.filter(item => item !== id)
}
