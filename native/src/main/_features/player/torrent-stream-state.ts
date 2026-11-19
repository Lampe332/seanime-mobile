import type { Torrentstream_TorrentStatus } from "@/api/generated/types"
import { plural, type Translate } from "@/lib/app-language"

/**
 * The core's `torrentstream-state` (core/torrent/torrent.ts streamStateOf), once per second from the torrent's adding on.
 * `peers` and `downloadRate` (bytes per second) are the core's own; a server without them leaves them out.
 */
export type TorrentStreamState = {
    state: string
    status: Torrentstream_TorrentStatus & { peers?: number, downloadRate?: number }
}

/** A state as the player keeps it: with the time it came */
export type HeardStreamState = TorrentStreamState & { at: number }

/** A state older than this is gone (the stream stopped, another one starts): the player shows no numbers of it */
export const STREAM_STATE_STALE_MS = 5000

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/** The event's payload when it has the fields the loading screen reads, else null */
export function heardStreamState(payload: unknown, now: number): HeardStreamState | null {
    if (!payload || typeof payload !== "object") return null
    const { state, status } = payload as { state?: unknown, status?: unknown }
    if (typeof state !== "string" || !status || typeof status !== "object") return null
    const fields = status as Partial<TorrentStreamState["status"]>
    if (!isNumber(fields.progressPercentage) || !isNumber(fields.seeders) || typeof fields.downloadSpeed !== "string") return null
    return { state, status: status as TorrentStreamState["status"], at: now }
}

export type StreamStateLines = {
    /** "Finding peers", "Getting file list", "Buffering", "Waiting for peers" */
    stage: string
    /** The numbers: loaded percent, ↓ speed, peers, seeders (mid-stream stalled: the speed only) */
    detail: string
    /** Mid-stream and nothing comes in */
    stalled: boolean
}

const percentText = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)}%`

/**
 * What the player's loading screen says of the torrent. `midStream`: the episode played already and the buffer ran empty.
 * Nothing (null) without a state or with a stale one: the screen then keeps the core's own step text.
 */
export function streamStateLines(heard: HeardStreamState | null, now: number, midStream: boolean, t: Translate): StreamStateLines | null {
    if (!heard || now - heard.at > STREAM_STATE_STALE_MS) return null
    const { status } = heard
    const peers = isNumber(status.peers) ? status.peers : null
    const rate = isNumber(status.downloadRate) ? status.downloadRate : /^0 /.test(status.downloadSpeed) ? 0 : null
    const speed = `↓ ${status.downloadSpeed}`
    const counts = [
        peers === null ? null : plural(t, peers, ["1 peer", "{0} peers"], ["1 Peer", "{0} Peers"]),
        plural(t, status.seeders, ["1 seeder", "{0} seeders"], ["1 Seeder", "{0} Seeder"]),
    ]

    if (midStream) {
        if (rate === 0) return { stage: t("Waiting for peers", "Warte auf Peers"), detail: status.downloadSpeed, stalled: true }
        return { stage: t("Buffering", "Puffern"), detail: [speed, ...counts].filter(Boolean).join(" · "), stalled: false }
    }

    const noPeers = peers === null ? status.seeders === 0 : peers === 0
    const listing = heard.state === "metadata"
    const stage = listing
        ? noPeers ? t("Finding peers", "Suche Peers") : t("Getting file list", "Lade Dateiliste")
        : noPeers && rate === 0 ? t("Finding peers", "Suche Peers") : t("Buffering", "Puffern")
    const loaded = listing ? null : t(`${percentText(status.progressPercentage)} loaded`, `${percentText(status.progressPercentage)} geladen`)
    return { stage, detail: [loaded, speed, ...counts].filter(Boolean).join(" · "), stalled: false }
}

/**
 * Whether a failed start was a torrent nobody shares (the core's "file list did not come", the server's "timeout waiting
 * for torrent info"): the player offers the torrent list again.
 */
export function offersOtherTorrent(reason: string | null): boolean {
    return !!reason && /file list did not come|timeout waiting for torrent info/i.test(reason)
}
