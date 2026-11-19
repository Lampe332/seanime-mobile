import type { HibikeTorrent_AnimeTorrent, Torrentstream_FilePreview } from "@/api/generated/types"
import type { TorrentClientDownload_Variables } from "@/api/generated/endpoint.types"
import { episodeOfName } from "@/core/torrent/torrent"
import { isBatchRelease } from "@/main/entry/_containers/torrent-search/_lib/torrent-filters"

/*
 * The download sheet's file choice (4.2.0, A2): the video files of one batch torrent, as the stream's file chooser lists
 * them (core torrent.ts torrentFilePreviews), each with a box. What is chosen goes out through the download request's
 * own `deselect` field (client.ts choiceOf/chooseFiles): the files left out by index; files that are no video (subtitles,
 * fonts) are not listed and come along. Everything chosen sends no choice: the whole torrent, as before.
 */

export type FileRow = {
    index: number
    /** "Episode 5", or the file's name when it numbers no episode */
    title: string
    /** The file's own name */
    name: string
    episode: number
    /** An opening, ending, special or preview: never one of the missing episodes */
    extra: boolean
    /** Bytes; 0 when the core did not say */
    size: number
}

const nameOf = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)

/** The file list for the screen: in episode order, extras after the episodes, then by name */
export function fileRowsOf(previews: Torrentstream_FilePreview[] | null | undefined): FileRow[] {
    return (previews ?? []).map(preview => {
        const named = episodeOfName(preview.path)
        return {
            index: preview.index,
            // an extra ("NCOP1") is named by its file, not as an episode
            title: (!named.extra && preview.displayTitle) || nameOf(preview.path),
            name: nameOf(preview.path),
            episode: preview.episodeNumber,
            extra: named.extra,
            size: typeof preview.size === "number" && preview.size > 0 ? preview.size : 0,
        }
    }).sort((a, b) => Number(a.extra) - Number(b.extra) || (a.episode || Infinity) - (b.episode || Infinity) || a.name.localeCompare(b.name))
}

/**
 * The files chosen when the list comes: with the old "Only the episodes you are missing" (smartSelect) those episodes,
 * the way the core picks them (a video of a missing episode, no extra); otherwise, or when none fits, every file.
 */
export function defaultFileChoice(rows: FileRow[], missing: number[], smartSelect: boolean): Set<number> {
    if (smartSelect) {
        const wanted = rows.filter(row => !row.extra && missing.includes(row.episode)).map(row => row.index)
        if (wanted.length) return new Set(wanted)
    }
    return new Set(rows.map(row => row.index))
}

export function toggledFile(chosen: Set<number>, index: number): Set<number> {
    const next = new Set(chosen)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
}

/** The bytes of the chosen files */
export function chosenBytes(rows: FileRow[], chosen: Set<number>): number {
    return rows.reduce((sum, row) => sum + (chosen.has(row.index) ? row.size : 0), 0)
}

export type SpaceState = "unknown" | "fits" | "full"

/** Whether the chosen files fit into the free storage (`free` null: the phone cannot say) */
export function spaceStateOf(bytes: number, free: number | null): SpaceState {
    if (free === null || !(bytes > 0)) return "unknown"
    return bytes > free ? "full" : "fits"
}

/** The request's file part: everything chosen → the whole torrent; else the files left out, by index */
export function fileChoiceRequest(rows: FileRow[], chosen: Set<number>): Pick<TorrentClientDownload_Variables, "smartSelect" | "deselect"> {
    const left = rows.filter(row => !chosen.has(row.index)).map(row => row.index)
    return {
        smartSelect: { enabled: false, missingEpisodeNumbers: [] },
        ...(left.length ? { deselect: { enabled: true, indices: left } } : {}),
    }
}

/** A list to choose from: one torrent that holds a whole season or a range of episodes */
export function wantsFileChoice(torrents: Pick<HibikeTorrent_AnimeTorrent, "name" | "isBatch" | "size">[], batchByName: boolean): boolean {
    return torrents.length === 1 && (isBatchRelease(torrents[0]!) || batchByName)
}
