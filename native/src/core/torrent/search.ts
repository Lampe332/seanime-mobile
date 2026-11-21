// geschrieben nach: Form der Aufzeichnungen TORRENT_SEARCH.SearchTorrent.* vom 13.11.2026 (search.recorded.json), dem Vertrag anime-torrent-provider.d.ts (search, smartSearch, getTorrentInfoHash, getTorrentMagnetLink, getLatest, getSettings), den App-Typen SearchTorrent_Variables, Torrent_SearchData, Torrent_Preview, Torrent_TorrentMetadata und HibikeTorrent_AnimeTorrent (src/api/generated), App-Code handle-torrent-search.ts/torrent-search-phone.tsx, dem Muster streams/onlinestream.ts (Erweiterung im Sandkasten) und docs/EIGENER-KERN.md §4q (Phase 6c-1); kein Server-Quelltext

import { CoreError } from "../errors"
import { readInstalled } from "../extensions/manage/installed"
import { loaderOf, preferencesOf, savedUserConfig, torrentProviders } from "../extensions/manage/manage"
import { parse } from "../extensions/helpers/prelude/habari"
import { animeWithEpisodes } from "../library/library"
import { animeMetadata } from "../library/metadata"
import { type StreamEnvironment, failureOf, streamMediaOf } from "../streams/onlinestream"
import { type FoundTorrent, type ReadTorrent, chooseTorrent, getAutoSelectProfile } from "./autoselect"

/*
 * Torrent search in the core (phase 6c-1, area `torrent`). The work is the provider extension's, in its own sandbox:
 *
 * - type "smart": `smartSearch` with the anime, the episode, batch, resolution, best releases and the anime's AniDB
 *   numbers (from the episode metadata); a provider that cannot search smartly gets `search` with the words, else the
 *   anime's title. The answer has the torrents and one preview each (the episode the torrent numbers, when the core
 *   knows it), which the phone shows.
 * - type "simple": `search` with the user's words; without words the provider's newest torrents (`getLatest`).
 *
 * Every torrent gets `provider`, the recorded fields (missing magnet/info hash: "", missing episode: -1) and, by its info
 * hash, what its name says (own $habari) with `distance`: the fewest letters to change between the title the name
 * carries and one of the anime's titles (own measure). The torrents come with the most seeders first. Debrid stays with
 * the server (6c-2): `debridInstantAvailability` is null, `includedSpecialProviders` empty.
 */

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === "string" ? value : "")
const number = (value: unknown, otherwise: number) => (typeof value === "number" && Number.isFinite(value) ? value : otherwise)

type Provider = { id: string, smart: boolean, call: <T>(method: string, ...args: unknown[]) => Promise<T> }

async function providerOf(environment: StreamEnvironment, id: string): Promise<Provider> {
    const { extensions } = await readInstalled(environment.manage.place)
    const manifest = extensions.find(extension => extension.id === id && extension.type === "anime-torrent-provider")
    if (!manifest) throw new CoreError(`torrent provider not found: ${id}`, 404)
    const settings = (await torrentProviders(environment.manage)).find(item => item.id === id)?.settings
    const preferences = preferencesOf(manifest, await savedUserConfig(environment.manage, id))
    return {
        id,
        smart: isRecord(settings) && settings.canSmartSearch === true,
        call: async <T>(method: string, ...args: unknown[]) => {
            await environment.core.pause(`torrent: ${id} ${method}`)
            try {
                return await loaderOf(environment.manage).call<T>(manifest, preferences, method, ...args)
            }
            catch (error) {
                throw failureOf(id, method, error)
            }
        },
    }
}

/** A torrent of the provider in the recorded form, `provider` first */
export function torrentOut(provider: string, raw: Json): FoundTorrent {
    const resolution = text(raw.resolution)
    const releaseGroup = text(raw.releaseGroup)
    const infoHash = text(raw.infoHash).trim().toLowerCase()
    return {
        provider,
        name: text(raw.name),
        date: text(raw.date),
        size: number(raw.size, 0),
        formattedSize: text(raw.formattedSize),
        seeders: number(raw.seeders, 0),
        leechers: number(raw.leechers, 0),
        downloadCount: number(raw.downloadCount, 0),
        link: text(raw.link),
        downloadUrl: text(raw.downloadUrl),
        magnetLink: text(raw.magnetLink),
        infoHash,
        ...(resolution ? { resolution } : {}),
        ...(raw.isBatch === true ? { isBatch: true } : {}),
        episodeNumber: Number.isInteger(raw.episodeNumber) && (raw.episodeNumber as number) > 0 ? raw.episodeNumber as number : -1,
        ...(releaseGroup ? { releaseGroup } : {}),
        isBestRelease: raw.isBestRelease === true,
        confirmed: raw.confirmed === true,
    }
}

/** The fewest single letters to add, remove or change to turn `a` into `b` */
export function distanceOf(a: string, b: string): number {
    let row = Array.from({ length: b.length + 1 }, (_value, index) => index)
    for (let i = 1; i <= a.length; i++) {
        const next = [i]
        for (let j = 1; j <= b.length; j++) next.push(Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)))
        row = next
    }
    return row[b.length]!
}

function titlesOf(media: Json): string[] {
    const title = isRecord(media.title) ? media.title : {}
    const all = [title.romaji, title.english, title.native, title.userPreferred, ...(Array.isArray(media.synonyms) ? media.synonyms : [])]
    return [...new Set(all.map(item => text(item).toLowerCase().trim()).filter(Boolean))]
}

/** Reading names is work on the app's thread: it gets its turn back every few torrents (the watch's 8 ms) */
const NAMES_PER_TURN = 8

async function metadataOf(torrents: FoundTorrent[], titles: string[], pause: (where: string) => Promise<void>): Promise<Record<string, Json>> {
    const out: Record<string, Json> = {}
    for (const [index, torrent] of torrents.entries()) {
        if (index > 0 && index % NAMES_PER_TURN === 0) await pause("torrent names")
        if (!torrent.infoHash || out[torrent.infoHash]) continue
        const metadata = parse(torrent.name) as unknown as Json
        const title = text(metadata.title).toLowerCase().trim()
        out[torrent.infoHash] = { distance: titles.length > 0 ? Math.min(...titles.map(one => distanceOf(title, one))) : 0, metadata }
    }
    return out
}

function torrentsOf(provider: string, answer: unknown): FoundTorrent[] {
    return (Array.isArray(answer) ? answer : []).filter(isRecord).map(raw => torrentOut(provider, raw)).sort((a, b) => b.seeders - a.seeders)
}

/** The anime's AniDB numbers: of the anime, and of the episode (0 when unknown) */
function anidbOf(metadata: Json | null, episodeNumber: number): { anidbAID: number, anidbEID: number } {
    const mappings = isRecord(metadata?.mappings) ? metadata.mappings : {}
    const episodes = isRecord(metadata?.episodes) ? metadata.episodes : {}
    const episode = episodes[String(episodeNumber)]
    return { anidbAID: number(mappings.anidbId, 0), anidbEID: isRecord(episode) ? number(episode.anidbEid, 0) : 0 }
}

type SmartWanted = { query: string, episodeNumber: number, batch: boolean, resolution: string, bestReleases: boolean, absoluteOffset: number }

async function smartSearch(provider: Provider, media: Json, metadata: Json | null, wanted: SmartWanted): Promise<FoundTorrent[]> {
    const contractMedia = { ...streamMediaOf(media), ...(wanted.absoluteOffset > 0 ? { absoluteSeasonOffset: wanted.absoluteOffset } : {}) }
    if (!provider.smart) {
        const query = wanted.query || contractMedia.romajiTitle || contractMedia.englishTitle || ""
        return torrentsOf(provider.id, await provider.call<unknown>("search", { media: contractMedia, query }))
    }
    const options = { media: contractMedia, query: wanted.query, batch: wanted.batch, episodeNumber: wanted.episodeNumber, resolution: wanted.resolution, ...anidbOf(metadata, wanted.episodeNumber), bestReleases: wanted.bestReleases }
    return torrentsOf(provider.id, await provider.call<unknown>("smartSearch", options))
}

/** POST /api/v1/torrent/search */
export async function searchTorrents(environment: StreamEnvironment, body: unknown): Promise<Json> {
    const request = isRecord(body) ? body : {}
    // the phone's search asks several providers at once: their ids joined by commas
    const ids = [...new Set(text(request.provider).split(",").map(id => id.trim()).filter(id => id !== ""))]
    if (!ids.length) throw new CoreError("provider is required", 400)
    const media = isRecord(request.media) ? request.media : null
    const mediaId = media ? number(media.id, 0) : 0
    const query = text(request.query).trim()
    const smart = request.type === "smart"
    if (smart && !media) throw new CoreError("media is required for a smart search", 400)
    // a title of TVmaze (negative id) has its episodes from TVmaze (library/metadata.ts)
    const metadata = mediaId !== 0 ? await animeMetadata(environment.core, mediaId).catch(() => null) : null
    const episodeNumber = Math.max(0, Math.trunc(number(request.episodeNumber, 0)))

    const searchOne = async (id: string): Promise<FoundTorrent[]> => {
        const provider = await providerOf(environment, id)
        if (smart) {
            return smartSearch(provider, media!, metadata, {
                query, episodeNumber, batch: request.batch === true, resolution: text(request.resolution), bestReleases: request.bestRelease === true,
                absoluteOffset: Math.max(0, number(request.absoluteOffset, 0)),
            })
        }
        if (query) return torrentsOf(id, await provider.call<unknown>("search", { media: streamMediaOf(media ?? {}), query }))
        return torrentsOf(id, await provider.call<unknown>("getLatest"))
    }
    let torrents: FoundTorrent[]
    if (ids.length === 1) torrents = await searchOne(ids[0])
    else {
        // several providers: the answers put together, most seeders first; one that fails falls away, unless all do
        const answers = await Promise.allSettled(ids.map(searchOne))
        const found = answers.flatMap(answer => answer.status === "fulfilled" ? [answer.value] : [])
        if (!found.length) throw (answers[0] as PromiseRejectedResult).reason
        torrents = found.flat().sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))
    }

    const previews: Json[] = []
    if (smart) {
        // the episodes' cards come from the core's own episode list; without it, the previews have the torrent only
        const built = await animeWithEpisodes(environment.core, mediaId).catch(() => null)
        for (const torrent of torrents) {
            const own = torrent.episodeNumber ?? -1
            const shown = own > 0 ? own : torrent.isBatch ? 0 : episodeNumber
            const episode = shown > 0 ? built?.episodes.find(one => one.episodeNumber === shown) : undefined
            previews.push(episode ? { episode, torrent } : { torrent })
        }
    }
    return {
        torrents,
        previews,
        torrentMetadata: await metadataOf(torrents, media ? titlesOf(media) : query ? [query.toLowerCase()] : [], where => environment.core.pause(where)),
        debridInstantAvailability: null,
        animeMetadata: metadata,
        includedSpecialProviders: [],
    }
}

/* ---- For the stream: choosing by itself, asking the provider for the magnet link ---- */

export type AutoSelected = { torrent: FoundTorrent, read: ReadTorrent, asked: string[], found: number }

/**
 * The torrent auto-select picks for an episode: every installed torrent provider (the profile's, when it names some)
 * searched smartly for the episode, the answers put together, the rule of autoselect.ts applied. A provider that fails
 * is left out; none answering, or nothing fitting: an error the screens show.
 */
export async function autoSelectTorrent(environment: StreamEnvironment, mediaId: number, episodeNumber: number, preferredResolution: string): Promise<AutoSelected> {
    const profile = await getAutoSelectProfile(null, environment.core)
    const installed = (await torrentProviders(environment.manage)).map(item => item.id)
    const named = (profile.providers ?? []).filter(id => installed.includes(id))
    const asked = named.length > 0 ? named : installed
    if (asked.length === 0) throw new CoreError("no torrent provider is installed", 404)
    const built = await animeWithEpisodes(environment.core, mediaId)
    const wanted: SmartWanted = { query: "", episodeNumber, batch: false, resolution: "", bestReleases: false, absoluteOffset: 0 }
    const answers = await Promise.allSettled(asked.map(async id => smartSearch(await providerOf(environment, id), built.media, built.metadata, wanted)))
    const torrents = answers.flatMap(answer => (answer.status === "fulfilled" ? answer.value : []))
    if (torrents.length === 0 && answers.every(answer => answer.status === "rejected")) throw (answers[0] as PromiseRejectedResult).reason
    const startDate = built.media.startDate as { year?: unknown } | undefined
    const startYear = typeof startDate?.year === "number" ? startDate.year : 0
    const format = typeof built.media.format === "string" ? built.media.format : ""
    const read = chooseTorrent(torrents, profile, { episodeNumber, preferredResolution, startYear, format })
    if (!read) throw new CoreError(`auto select found no torrent for episode ${episodeNumber} (${torrents.length} looked at)`, 404)
    return { torrent: read.torrent, read, asked, found: torrents.length }
}

/** The magnet link of a torrent that came without one: its provider is asked (magnet link, else info hash); "" when neither */
export async function magnetFromProvider(environment: StreamEnvironment, torrent: Json): Promise<string> {
    const id = text(torrent.provider)
    if (!id) return ""
    const provider = await providerOf(environment, id)
    const magnet = text(await provider.call<unknown>("getTorrentMagnetLink", torrent).catch(() => "")).trim()
    if (/^magnet:\?/i.test(magnet)) return magnet
    const infoHash = text(await provider.call<unknown>("getTorrentInfoHash", torrent)).trim().toLowerCase()
    return /^[0-9a-f]{40}$/.test(infoHash) ? `magnet:?xt=urn:btih:${infoHash}` : ""
}
