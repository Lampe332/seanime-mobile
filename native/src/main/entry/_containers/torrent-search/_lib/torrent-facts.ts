import type { Habari_Metadata, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import type { Translate } from "@/lib/app-language"
import { type AutoSelectProfile, type FoundTorrent, chooseTorrent, decodeEntities, isMovieRelease } from "@/core/torrent/autoselect"
import { magnetOf } from "@/core/torrent/torrent"
import { CODECS, isBatchRelease, SOURCES, TEN_BIT } from "@/main/entry/_containers/torrent-search/_lib/torrent-filters"
import { ago } from "@/main/entry/_containers/torrent-search/_lib/torrent-search-phone"

/*
 * What a torrent card shows (torrent-card.tsx), read from the provider's fields and the release name. The provider's
 * fields win; the name, read by the core's own parser ($habari, the same reading auto-select uses), fills the gaps:
 * most providers leave `resolution` and `releaseGroup` out, so without the name a card had only size, seeders and age.
 */

export type SeedHealth = "unknown" | "none" | "low" | "good"

export type TorrentFacts = {
    /** "SubsPlease"; "" when neither the provider nor the name says */
    group: string
    /** "Ep 5", "Ep 1–12", "Batch" or "" */
    episode: string
    /** A whole season or a range of episodes ("Ep 1–12", "Batch") */
    batch: boolean
    /** "S2", "S1–S2" (a batch over several seasons) or "" */
    season: string
    /** "v2" or "" (a first version is not shown) */
    version: string
    /** "1080p", "2160p" (4k reads as 2160p) or "" */
    resolution: string
    health: SeedHealth
    /** "332 seeders", "1 seeder", "No seeders", "? seeders" */
    seeders: string
    /** "18 leechers"; "" when the seeders are unknown (the provider counts neither) */
    leechers: string
    /** "1.4 GiB" or "" */
    size: string
    /** "3 days ago" or "" */
    age: string
    provider: string
    /** What the name says about the video and sound: "HEVC", "10bit", "BluRay", "Dual audio", "Multi subs" */
    tech: string[]
}

const lower = (text: unknown) => (typeof text === "string" ? text.toLowerCase() : "")
const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])

/** "4k", "UHD", "2160" → "2160p"; "1920x1080" → "1080p"; "" when it names no height */
export function resolutionLabel(text: string | undefined): string {
    const value = lower(text).trim()
    if (!value) return ""
    if (/\b(?:4k|uhd)\b/.test(value)) return "2160p"
    const by = /\d{3,4}\s*[x×]\s*(\d{3,4})/.exec(value)
    if (by) return `${Number(by[1])}p`
    const height = /(\d{3,4})p?/.exec(value)
    return height ? `${Number(height[1])}p` : ""
}

/**
 * The seeder icon's box for a text line of `fontSize` on `lineHeight` (4.2.0 E: at 15 dp beside 13 dp text its bars were
 * a dot). Lucide's signal bars stand in the lower half of the icon (y 8 to 20 of 24), so the full bar is half the box: the
 * box is twice the cap height (about 0.73 em), and `top` moves it so the bars stand on the text's baseline (about 0.5 of
 * the leading plus 0.97 em down the line, Inter's ascent).
 */
export function seedIconBox(fontSize: number, lineHeight: number): { size: number, top: number } {
    const size = Math.round(fontSize * 0.73 * 2)
    const baseline = (lineHeight - fontSize * 1.21) / 2 + fontSize * 0.97
    return { size, top: Math.round(baseline - size * 20 / 24) }
}

/** Binary units like the providers write them: "1.4 GiB", "700 MiB"; "" for an unknown size (0) */
export function sizeText(bytes: number): string {
    if (!(bytes > 0)) return ""
    const units = ["B", "KiB", "MiB", "GiB", "TiB"]
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")} ${units[unit]}`
}

export function seedHealth(seeders: number): SeedHealth {
    if (seeders < 0) return "unknown"
    if (seeders === 0) return "none"
    return seeders < 10 ? "low" : "good"
}

// Words a scene name ends with that are no group ("…WEB-DL", "…BD-Rip")
const NOT_A_GROUP = new Set(["dl", "rip", "web", "bd", "x264", "x265", "hevc", "avc", "aac", "flac", "ddp", "dts", "hd", "ma", "remux"])

/** A scene-style group at the end of a name without brackets: "Sousou.no.Frieren.S01.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.5.1-KAF" → "KAF" */
function trailingGroup(name: string): string {
    if (/^\s*[[(【]/.test(name)) return ""
    const found = /-([A-Za-z][A-Za-z0-9]{1,15})(?:\.[A-Za-z0-9]{2,4})?\s*$/.exec(name)
    return found && !NOT_A_GROUP.has(found[1]!.toLowerCase()) ? found[1]! : ""
}

/** The episodes a name numbers: one, a range ("(01-12)", " - 01-28 [") or none */
function episodesOf(torrent: Pick<HibikeTorrent_AnimeTorrent, "name" | "episodeNumber">, parsed: Habari_Metadata | undefined): number[] {
    if (typeof torrent.episodeNumber === "number" && torrent.episodeNumber > 0) return [torrent.episodeNumber]
    const read = list(parsed?.episode_number).flatMap(text => {
        const range = /^(\d+)\s*[-~]\s*(\d+)$/.exec(text)
        return range ? [Number(range[1]), Number(range[2])] : [Number(text)]
    }).filter(number => Number.isFinite(number))
    if (read.length) return read.length > 2 ? [read[0]!, read[read.length - 1]!] : read
    // the parser leaves a range in the title (the same reading as autoselect.ts readTorrent)
    const range = /(?:^|[\s([_])(\d{1,4})\s*[-~]\s*(\d{1,4})(?=$|[\s)\]_])/.exec(lower(torrent.name))
    return range && Number(range[1]) < Number(range[2]) ? [Number(range[1]), Number(range[2])] : []
}

/** The parser's video words, else the words the codec filter finds in the name (so a card agrees with the filter) */
function codecOf(terms: string[], name: string): string {
    if (terms.some(term => /hevc|[xh]\.?265/.test(term)) || CODECS.hevc.test(name)) return "HEVC"
    if (terms.some(term => /^av1$/.test(term)) || CODECS.av1.test(name)) return "AV1"
    if (terms.some(term => /^avc$|[xh]\.?264/.test(term)) || CODECS.avc.test(name)) return "AVC"
    return ""
}

function sourceOf(sources: string[], name: string): string {
    if (sources.some(source => /^(?:bd|bdrip|bd-rip|bluray|blu-ray|blu ray)$/.test(source)) || SOURCES.bluray.test(name)) return "BluRay"
    if (sources.some(source => /^(?:web|web-?dl|webdl|web-?rip|webrip|amzn|cr|nf|dsnp|webcast)$/.test(source)) || SOURCES.web.test(name)) return "WEB"
    if (sources.some(source => /dvd|r2j/.test(source))) return "DVD"
    if (sources.some(source => /tv/.test(source))) return "TV"
    return ""
}

/** A group as the provider or the parser names it ("A&amp;C" decoded), unless it is a list of languages in brackets ("[JAP/ENG/SPA]") */
function groupOf(group: string | undefined): string {
    const text = decodeEntities(group ?? "").trim()
    return text && !/[/,+]/.test(text) ? text : ""
}

/** A fact that wraps as one piece ("3 months ago"), so a long line breaks only between facts */
export const whole = (fact: string) => fact.replace(/ /g, " ")

/**
 * Every fact of one torrent for its card. `parsed` is the name as $habari reads it (the search's `torrentMetadata`, or
 * read on the phone); without it only the provider's fields and the name's batch marks count.
 */
export function torrentFacts(torrent: HibikeTorrent_AnimeTorrent, parsed: Habari_Metadata | undefined, t: Translate, language: string,
    options: { provider?: string, now?: number } = {}): TorrentFacts {
    const name = decodeEntities(torrent.name ?? "")
    const lowerName = lower(name)
    const episodes = episodesOf(torrent, parsed)
    const batch = isBatchRelease(torrent) || list(parsed?.release_information).some(term => /^(?:batch|complete)$/i.test(term))
    const range = episodes.length === 2 && episodes[0]! < episodes[1]!
    // a film's number counts films (4.2.0 E: "[A&C] One Piece - Movie 01" read as "Ep 1")
    const movie = isMovieRelease(name, parsed?.anime_type)
    const episode = movie
        ? range ? t(`Movies ${episodes[0]}–${episodes[1]}`, `Filme ${episodes[0]}–${episodes[1]}`)
            : episodes.length >= 1 ? t(`Movie ${episodes[0]}`, `Film ${episodes[0]}`) : t("Movie", "Film")
        : range ? t(`Ep ${episodes[0]}–${episodes[1]}`, `Folge ${episodes[0]}–${episodes[1]}`)
            : batch ? t("Batch", "Batch")
                : episodes.length >= 1 ? t(`Ep ${episodes[0]}`, `Folge ${episodes[0]}`) : ""
    // a batch over several seasons ("Frieren S1 and S2") is read with each of them: shown as their range, "S1–S2"
    const seasons = list(parsed?.season_number).map(Number).filter(number => Number.isInteger(number) && number > 0)
    const first = seasons.length ? Math.min(...seasons) : 0
    const last = seasons.length ? Math.max(...seasons) : 0
    const version = Number(list(parsed?.release_version)[0])

    const terms = list(parsed?.video_term).map(lower)
    const audio = list(parsed?.audio_term).map(lower)
    const subtitles = list(parsed?.subtitles).map(lower)
    const multiAudio = /multi[-_. ]?audio/.test(lowerName) || audio.some(term => /multi/.test(term))
    const dualAudio = !multiAudio && (/dual[-_. ]?audio|\bdual\b/.test(lowerName) || audio.some(term => /dual/.test(term)))
    const multiSubs = /multi[-_. ]?subs?\b|multiple[-_. ]?subtitles?/.test(lowerName) || subtitles.some(term => /multi/.test(term))
    const tech = [
        codecOf(terms, name),
        terms.some(term => /10-?bits?|hi10/.test(term)) || TEN_BIT.test(name) ? "10bit" : "",
        sourceOf(list(parsed?.source).map(lower), name),
        multiAudio ? t("Multi audio", "Mehrere Tonspuren") : dualAudio ? t("Dual audio", "Dual Audio") : "",
        multiSubs ? t("Multi subs", "Mehrere Untertitel") : "",
    ].filter(Boolean)

    const seeders = torrent.seeders
    return {
        group: groupOf(torrent.releaseGroup) || groupOf(parsed?.release_group) || trailingGroup(name),
        episode,
        batch: range || batch,
        season: last > first ? `S${first}–S${last}` : first > 0 ? `S${first}` : "",
        version: version > 1 ? `v${version}` : "",
        resolution: resolutionLabel(torrent.resolution) || resolutionLabel(parsed?.video_resolution),
        health: seedHealth(seeders),
        seeders: seeders < 0 ? t("? seeders", "? Seeder")
            : seeders === 0 ? t("No seeders", "Keine Seeder")
                : seeders === 1 ? t("1 seeder", "1 Seeder") : t(`${seeders} seeders`, `${seeders} Seeder`),
        leechers: seeders < 0 || !(torrent.leechers >= 0) ? ""
            : torrent.leechers === 1 ? t("1 leecher", "1 Leecher") : t(`${torrent.leechers} leechers`, `${torrent.leechers} Leecher`),
        size: torrent.formattedSize || sizeText(torrent.size),
        age: ago(torrent.date, language, options.now),
        provider: options.provider ?? "",
        tech,
    }
}

/** The card's head: "SubsPlease · S2 · Ep 5 · v2" */
export function factsHead(facts: TorrentFacts): string {
    return [facts.group, facts.season, facts.episode, facts.version].filter(Boolean).join(" · ")
}

/**
 * The head in two parts (4.2.0, A2): the group, which may be cut short, and the rest ("S2 · Ep 5 · v2"), which never is.
 * Beside the pick box a long group cut the head to "SubsPlease · S2 · Ep…", so the episode was lost.
 */
export function headParts(facts: TorrentFacts): { group: string, rest: string } {
    return { group: facts.group, rest: [facts.season, facts.episode, facts.version].filter(Boolean).join(" · ") }
}

/**
 * The numbers and the tags in one flowing text (4.2.0, A2): "332 seeders · 18 leechers · 1.4 GiB · 3 days ago · Nyaa ·
 * HEVC · 10bit". Two lines of their own each left half a line empty; flowing, the card is a line shorter. Each fact wraps whole.
 */
export function factsFlow(facts: TorrentFacts, tags: string[] = []): string {
    // a fixed space before the dot: the dot stays at the end of a line when the text wraps
    return [facts.seeders, facts.leechers, facts.size, facts.age, facts.provider, ...tags].filter(Boolean).map(whole).join(" · ")
}

/** The card's numbers line: "332 seeders · 18 leechers · 1.4 GiB · 3 days ago · Nyaa" */
export function factsLine(facts: TorrentFacts): string {
    return [facts.seeders, facts.leechers, facts.size, facts.age, facts.provider].filter(Boolean).join(" · ")
}

/** The same line for the screen: each fact kept on one line when it wraps, the dot staying at the end of the line */
export function factsLineWrapped(facts: TorrentFacts): string {
    return [facts.seeders, facts.leechers, facts.size, facts.age, facts.provider].filter(Boolean).map(whole).join(" · ")
}

/** The whole card as one sentence for screen readers */
export function factsSentence(name: string, facts: TorrentFacts, marks: string[] = []): string {
    return [name, ...marks, factsHead(facts), facts.resolution, factsLine(facts), facts.tech.join(", ")].filter(Boolean).join(", ")
}

/** The key a result is known by in the lists of the sheet */
export function torrentKey(torrent: Pick<HibikeTorrent_AnimeTorrent, "infoHash" | "link" | "name">): string {
    return torrent.infoHash || torrent.link || torrent.name
}

/**
 * The torrent auto-select would take from these (autoselect.ts `chooseTorrent` with the user's profile), as its key;
 * "" when none fits. `episodeNumber` 0: any episode. `startYear`: the anime's (AniList `startDate.year`), so a name dated
 * for another show (the live-action series, a remake) is no match; 0: unknown. `format`: the anime's AniList format, so a
 * film is no match for a series; "": unknown.
 */
export function bestMatchKey(torrents: HibikeTorrent_AnimeTorrent[], profile: AutoSelectProfile, episodeNumber: number, preferredResolution: string,
    startYear = 0, format = ""): string {
    if (!torrents.length) return ""
    const found = torrents.map(torrent => ({ ...torrent, provider: torrent.provider ?? "" }) as unknown as FoundTorrent)
    const chosen = chooseTorrent(found, profile, { episodeNumber, preferredResolution, startYear, format })
    return chosen ? torrentKey(chosen.torrent as unknown as HibikeTorrent_AnimeTorrent) : ""
}

/** The magnet link a card copies: the provider's, else one made of the info hash; "" when it has neither */
export function magnetLinkOf(torrent: Pick<HibikeTorrent_AnimeTorrent, "magnetLink" | "infoHash">): string {
    return magnetOf(torrent as Record<string, unknown>)
}

/** Copies the magnet link with `write` (expo-clipboard's setStringAsync); false when the torrent has none */
export async function copyMagnet(torrent: Pick<HibikeTorrent_AnimeTorrent, "magnetLink" | "infoHash">, write: (text: string) => Promise<unknown>): Promise<boolean> {
    const magnet = magnetLinkOf(torrent)
    if (!magnet) return false
    await write(magnet)
    return true
}
