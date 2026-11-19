import type { Habari_Metadata, HibikeTorrent_AnimeTorrent, Torrent_TorrentMetadata } from "@/api/generated/types"
import { parse } from "@/core/extensions/helpers/prelude/habari"
import React from "react"

/*
 * The release names of the torrent sheet as $habari reads them, for the cards (torrent-facts.ts). The search already
 * sends most of them (`torrentMetadata`, by info hash, read in the core a few names per turn); the rest – torrents
 * without an info hash, the download sheet's picks – are read here the same way: a few names, then the app's thread
 * gets its turn back, so a long list does not stutter. Every name is read once and kept by its text.
 */

/** As search.ts: reading names is work on the app's thread, it gets its turn back every few names */
export const NAMES_PER_TURN = 8
const KEPT = 600

const readings = new Map<string, Habari_Metadata>()

function keep(name: string, metadata: Habari_Metadata) {
    if (readings.has(name)) return
    if (readings.size >= KEPT) readings.delete(readings.keys().next().value!)
    readings.set(name, metadata)
}

/** The reading of a name, if it was read already */
export function readingOf(name: string): Habari_Metadata | undefined {
    return readings.get(name)
}

/** Reads the names nobody has read yet, a few per turn; `done` after each turn. Returns a stop function. */
export function readNamesInTurns(names: string[], done: () => void, later: (step: () => void) => unknown = step => setTimeout(step, 0)): () => void {
    const waiting = [...new Set(names)].filter(name => !readings.has(name))
    let stopped = false
    let at = 0
    const step = () => {
        if (stopped) return
        for (const end = Math.min(at + NAMES_PER_TURN, waiting.length); at < end; at++) {
            keep(waiting[at]!, parse(waiting[at]!) as unknown as Habari_Metadata)
        }
        done()
        if (at < waiting.length) later(step)
    }
    if (waiting.length) later(step)
    return () => {
        stopped = true
    }
}

/**
 * The readings of these torrents' names: the search's own first, the rest read in turns. The returned function changes
 * when new readings arrived, so the cards show them.
 */
export function useTorrentReads(torrents: HibikeTorrent_AnimeTorrent[], metadata?: Record<string, Torrent_TorrentMetadata>) {
    const [turn, setTurn] = React.useState(0)
    // the search's readings, taken before the first frame so most cards show complete at once
    for (const torrent of torrents) {
        const read = torrent.infoHash ? metadata?.[torrent.infoHash]?.metadata : undefined
        if (read) keep(torrent.name, read)
    }
    const namesKey = torrents.map(torrent => torrent.name).join("\n")
    React.useEffect(() => readNamesInTurns(namesKey ? namesKey.split("\n") : [], () => setTurn(value => value + 1)), [namesKey])
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return React.useCallback((torrent: Pick<HibikeTorrent_AnimeTorrent, "name">) => readings.get(torrent.name), [turn])
}
