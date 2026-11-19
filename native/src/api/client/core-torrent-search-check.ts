// geschrieben nach: docs/EIGENER-KERN.md §4q (Phase 6c-1: Torrent-Suche, Prüf-Link) und dem Muster core-manga-check.ts (Vergleich Kern gegen Server am Gerät, nur lesend); kein Server-Quelltext
import { buildSeaQuery } from "@/api/client/requests"
import { type AutoSelectProfile, type FoundTorrent, chooseTorrent } from "@/core"
import { logger } from "@/lib/helpers/debug"

/*
 * Test and scratch app only (link `core?torrent=search-check&media=<AniList id>[&episode=<n>][&provider=<id>]`): asks
 * the torrent search through the same door the hooks use, so the area's switch decides who answers, and logs numbers
 * only: per provider the smart search for the episode (torrents, previews, metadata, magnet links, info hashes, batches,
 * the fields), the simple search with the anime's title (torrents), then the auto-select profile and the torrent the
 * core's rule would pick from all smart results (which fields it has, its resolution, batch or not). Nothing is added
 * to a torrent session, nothing loaded, nothing played. No titles, no links, no hashes in the log.
 */

const log = (text: string) => logger("CoreTorrent").info(text)

async function timed<T>(work: () => Promise<T>): Promise<{ value: T | null, error: string | null, ms: number }> {
    const started = Date.now()
    try {
        return { value: (await work()) ?? null, error: null, ms: Date.now() - started }
    }
    catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        return { value: null, error: text.replace(/https?:\/\/\S+/g, "<address>").replace(/magnet:\S+/g, "<magnet>").slice(0, 160), ms: Date.now() - started }
    }
}

type Search = { torrents?: FoundTorrent[], previews?: { episode?: unknown, torrent?: unknown }[], torrentMetadata?: Record<string, unknown>, animeMetadata?: unknown }

export async function runCoreTorrentSearchCheck(mediaId: number, episodeNumber: number, only: string): Promise<void> {
    const side = "core"
    log(`search check start, answered by: ${side}, episode ${episodeNumber}`)
    const entry = await timed(() => buildSeaQuery<{ media?: Record<string, unknown> }>({ endpoint: `/api/v1/library/anime-entry/${mediaId}`, method: "GET" }))
    const media = entry.value?.media
    if (!media) {
        log(`search check stopped: no anime (${entry.error ?? "empty"})`)
        return
    }
    const listed = await timed(() => buildSeaQuery<{ id: string }[]>({ endpoint: "/api/v1/extensions/list/anime-torrent-provider", method: "GET" }))
    const providers = (listed.value ?? []).map(item => item.id).filter(id => !only || id === only)
    log(`${side} providers: ${providers.length}${listed.error ? ` (${listed.error})` : ""}`)
    const title = media.title as { romaji?: string } | undefined
    const all: FoundTorrent[] = []
    for (const [number, provider] of providers.entries()) {
        const name = `provider ${number + 1}`
        const smart = await timed(() => buildSeaQuery<Search>({
            endpoint: "/api/v1/torrent/search", method: "POST",
            data: { query: "", episodeNumber, batch: false, media, absoluteOffset: 0, resolution: "", type: "smart", provider, bestRelease: false },
        }))
        const torrents = smart.value?.torrents ?? []
        all.push(...torrents)
        const previews = smart.value?.previews ?? []
        const fields = [...new Set(torrents.flatMap(torrent => Object.keys(torrent)))].sort().join("/")
        log(`${side} ${name} smart: ${smart.error ?? `torrents ${torrents.length}, previews ${previews.length} (with episode ${previews.filter(preview => preview.episode).length}), metadata ${Object.keys(smart.value?.torrentMetadata ?? {}).length}, magnet ${torrents.filter(torrent => torrent.magnetLink).length}, infoHash ${torrents.filter(torrent => torrent.infoHash).length}, batch ${torrents.filter(torrent => torrent.isBatch).length}, episode ${episodeNumber} ${torrents.filter(torrent => torrent.episodeNumber === episodeNumber).length}, anime metadata ${smart.value?.animeMetadata ? "yes" : "no"}, fields ${fields}`} (${smart.ms} ms)`)
        const simple = await timed(() => buildSeaQuery<Search>({
            endpoint: "/api/v1/torrent/search", method: "POST",
            data: { query: (title?.romaji ?? "").toLowerCase(), episodeNumber: 0, batch: false, media, absoluteOffset: 0, resolution: "", type: "simple", provider, bestRelease: false },
        }))
        log(`${side} ${name} simple: ${simple.error ?? `torrents ${simple.value?.torrents?.length ?? 0}, previews ${simple.value?.previews?.length ?? 0}, metadata ${Object.keys(simple.value?.torrentMetadata ?? {}).length}`} (${simple.ms} ms)`)
    }
    const profile = await timed(() => buildSeaQuery<AutoSelectProfile>({ endpoint: "/api/v1/auto-select/profile", method: "GET" }))
    log(`${side} auto-select profile: ${profile.error ?? `dbId ${profile.value?.dbId}, fields ${Object.keys(profile.value ?? {}).length}`} (${profile.ms} ms)`)
    if (profile.value) {
        const startYear = (media.startDate as { year?: number } | undefined)?.year ?? 0
        const chosen = chooseTorrent(all, profile.value, { episodeNumber, preferredResolution: "", startYear })
        log(`auto select (core rule) from ${all.length}: ${chosen ? `provider ${providers.indexOf(chosen.torrent.provider) + 1}, fields ${Object.keys(chosen.torrent).sort().join("/")}, resolution ${chosen.resolution || "-"}, batch ${chosen.batch}, episodes read ${chosen.episodes.length}, seeders ${chosen.torrent.seeders > 0 ? "> 0" : "0"}, magnet ${chosen.torrent.magnetLink ? "yes" : "no"}, infoHash ${chosen.torrent.infoHash ? "yes" : "no"}` : "none fits"}`)
    }
    log("search check done")
}
