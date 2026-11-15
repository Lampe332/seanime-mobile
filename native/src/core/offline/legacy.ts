// geschrieben nach: der am Gerät beobachteten Form der Ablage des Servers (`files/mobile-offline/queue.json`: version, wifiOnly, items je ID, manga; Ordner `episodes/<id>/`, Bilder in `artwork/`; Pixel Tablet, scratch, 14.11.2026) und docs/EIGENER-KERN.md §4c (Regeln des Umzugs) und §4o (Phase 4c); kein Server-Quelltext

import type { OfflineItem, OfflineSubtitle } from "./offline"

/*
 * The episodes the server saved before the core took the downloads over (phase 4c). The server keeps a list of them in
 * `mobile-offline/queue.json` and their files in `mobile-offline/episodes/<id>/` (pictures: `mobile-offline/artwork/`).
 * The core reads the list once, never writes to it, and plays the files where they lie: nothing is copied or moved.
 *
 * Only finished episodes are taken (`status` "ready"): one the server had not finished goes on with the server, the
 * core would have to start it again from its own folder.
 */

/** The server's folder of the saved episodes, under the app's files folder */
export const OLD_OFFLINE_FOLDER = "mobile-offline"

/** A problem whose text is safe to show: it never carries a value read from the server's file */
export class OldQueueProblem extends Error {}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

/** A name that is one file or folder of the app's storage, nothing more */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const safeName = (value: unknown): value is string => typeof value === "string" && SAFE_NAME.test(value) && !value.includes("..")

const TEXTS = ["key", "provider", "quality", "server", "audioLanguage", "title", "description", "format", "coverUrl", "bannerUrl",
    "episodeTitle", "episodeImageUrl", "episodeDescription", "airDate"] as const
const AMOUNTS = ["bytes", "position", "order", "year", "totalEpisodes", "duration", "score"] as const
const ASSETS = ["coverAsset", "bannerAsset", "episodeImageAsset"] as const

function subtitlesOf(value: unknown): OfflineSubtitle[] | null {
    if (value === undefined) return []
    if (!Array.isArray(value)) return null
    const subtitles: OfflineSubtitle[] = []
    for (const subtitle of value) {
        if (!isRecord(subtitle) || !safeName(subtitle.file)) return null
        subtitles.push({
            file: subtitle.file,
            language: typeof subtitle.language === "string" ? subtitle.language : "",
            label: typeof subtitle.label === "string" ? subtitle.label : "",
            default: subtitle.default === true,
            mime: typeof subtitle.mime === "string" ? subtitle.mime : "",
        })
    }
    return subtitles
}

/** One entry of the server's list as the core's item; null: not finished, or not of the known form */
function itemOf(entry: unknown): OfflineItem | null {
    if (!isRecord(entry) || entry.status !== "ready" || !safeName(entry.id)) return null
    const mediaId = entry.mediaId
    if (typeof mediaId !== "number" || !Number.isInteger(mediaId) || mediaId <= 0) return null
    const episode = typeof entry.episode === "number" ? String(entry.episode) : entry.episode
    if (typeof episode !== "string" || episode === "") return null
    const files = entry.files
    if (!isRecord(files) || !safeName(files.video) || (files.audio !== undefined && !safeName(files.audio))) return null
    const subtitles = subtitlesOf(files.subtitles)
    if (subtitles === null) return null
    const item: OfflineItem = {
        id: entry.id,
        key: entry.id,
        status: "ready",
        ready: true,
        mediaId,
        provider: "",
        episode,
        dubbed: entry.dubbed === true,
        quality: "",
        server: "",
        audioLanguage: "",
        // the core counts from 0 to 1 (the server: to 100); a finished episode is whole
        progress: 1,
        bytes: 0,
        position: 0,
        files: { video: files.video, ...(typeof files.audio === "string" ? { audio: files.audio } : {}), ...(subtitles.length > 0 ? { subtitles } : {}) },
        order: 0,
        metadataSaved: false,
    }
    const fields = item as unknown as Json
    for (const name of TEXTS) if (typeof entry[name] === "string" && entry[name] !== "") fields[name] = entry[name]
    for (const name of AMOUNTS) if (typeof entry[name] === "number" && Number.isFinite(entry[name])) fields[name] = entry[name]
    for (const name of ASSETS) if (safeName(entry[name])) fields[name] = entry[name]
    if (Array.isArray(entry.genres)) {
        const genres = entry.genres.filter((genre): genre is string => typeof genre === "string" && genre !== "")
        if (genres.length > 0) item.genres = genres
    }
    // the pictures count as saved only when the server said so and each one it names is a plain file name
    item.metadataSaved = entry.metadataSaved === true && ASSETS.every(name => entry[name] === undefined || entry[name] === "" || safeName(entry[name]))
    return item
}

/**
 * The finished episodes of the server's list, in the server's order. `left`: entries that stay with the server (not
 * finished, or of a form the core does not know). Throws an OldQueueProblem when the text is not the list.
 */
export function oldEpisodes(text: string): { items: OfflineItem[], left: number } {
    let queue: unknown
    try {
        queue = JSON.parse(text)
    }
    catch {
        throw new OldQueueProblem("the server's list of saved episodes is not readable as JSON")
    }
    if (!isRecord(queue) || (queue.items !== undefined && !isRecord(queue.items))) throw new OldQueueProblem("the server's list of saved episodes has an unknown form")
    const items: OfflineItem[] = []
    let left = 0
    for (const entry of Object.values((queue.items ?? {}) as Json)) {
        const item = itemOf(entry)
        if (item) items.push(item)
        else left++
    }
    return { items: items.sort((a, b) => a.order - b.order), left }
}
