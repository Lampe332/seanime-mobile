import type { TorrentClient_Torrent } from "@/api/generated/types"

/*
 * The sections of the Torrents tab (torrent-downloads.tsx), by the status of core/torrent/client.ts `clientStatusOf`.
 * Before 4.2.0 E every torrent that was not sharing counted as "Downloading": five torrents that all said "Paused · 100 %"
 * (stopped by "Stop sharing when finished") stood under "Downloading 5".
 */

export type TorrentGroupKey = "downloading" | "waiting" | "stopped" | "done"

export type TorrentGroup = { key: TorrentGroupKey, rows: TorrentClient_Torrent[] }

/** Complete: every wanted byte is there (a paused torrent at 100 % is done, not stopped halfway) */
const complete = (torrent: TorrentClient_Torrent) => torrent.progress >= 1

export function torrentGroupOf(torrent: TorrentClient_Torrent): TorrentGroupKey {
    // loading, or getting ready to load (file list, checking): the only ones that count as downloading
    if (torrent.status === "downloading" || torrent.status === "other") return "downloading"
    if (torrent.status === "seeding") return "done"
    // in the download queue: waits for its turn, does not load yet
    if (torrent.status === "queued") return "waiting"
    if (torrent.status !== "error" && complete(torrent)) return "done"
    return "stopped"
}

/** The sections in their order on screen, without empty ones */
export function torrentGroups(torrents: TorrentClient_Torrent[]): TorrentGroup[] {
    const order: TorrentGroupKey[] = ["downloading", "waiting", "stopped", "done"]
    return order.map(key => ({ key, rows: torrents.filter(torrent => torrentGroupOf(torrent) === key) })).filter(group => group.rows.length > 0)
}
