// geschrieben nach: Aufzeichnungen MANGA.GetMangaCollection/GetMangaLatestChapterNumbersMap/GetRawAnilistMangaCollection (Form; Reihenfolge verglichen), den generierten Typen Manga_Collection/Manga_MangaLatestChapterNumberItem, App-Code src/main/manga/_lib (handle-manga-collection.ts sortiert selbst, handle-manga-utils.ts Kapitelnummer) und docs/EIGENER-KERN.md §4n; kein Server-Quelltext

import { inOrder } from "../database/database"
import { mangaChapterNumbers } from "../database/schema"
import { rawCollectionOf } from "../anilist/anilist"
import type { CoreEnvironment, CoreRequest } from "../registry"
import type { StreamEnvironment } from "../streams/onlinestream"
import { listDataOf } from "./manga"

/*
 * The manga library (phase 4a-2, §4n). The collection is the user's AniList lists in the core's own rule: one list per
 * status, custom lists left out, lists and entries in AniList's order (the screens sort each list themselves). The
 * latest chapter numbers are kept in core.db over restarts: the server's ones are read once (read only), after that
 * every chapter list a provider gives the core writes its highest chapter number.
 */

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The number of a chapter as the screens read it: the first number in it, without its decimals; none = 0 */
export function chapterNumberOf(chapter: unknown): number {
    const found = typeof chapter === "string" ? chapter.match(/(\d+(\.\d+)?)/)?.[0] : undefined
    return found ? Math.floor(parseFloat(found)) : 0
}

/** GET /api/v1/manga/collection */
export async function mangaCollection(request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    const raw = await rawCollectionOf("MANGA")(request, environment)
    const lists: Json[] = []
    for (const list of raw.MediaListCollection.lists as Json[]) {
        if (list.isCustomList === true || typeof list.status !== "string") continue
        const entries: Json[] = []
        for (const entry of (Array.isArray(list.entries) ? list.entries : []).filter(isRecord)) {
            if (!isRecord(entry.media) || typeof entry.media.id !== "number") continue
            entries.push({ media: entry.media, mediaId: entry.media.id, listData: listDataOf(entry) })
        }
        if (entries.length > 0) lists.push({ type: list.status, status: list.status, entries })
        await environment.pause()
    }
    return { lists }
}

/** Keeps the highest chapter number of a provider's fresh chapter list */
export async function keepChapterNumber(environment: StreamEnvironment, mediaId: number, provider: string, chapters: Json[]): Promise<void> {
    const number = chapters.reduce((highest, chapter) => Math.max(highest, chapterNumberOf(chapter.chapter)), 0)
    const database = await environment.core.database()
    const now = environment.core.now()
    await inOrder(database, () => database.insert(mangaChapterNumbers)
        .values({ mediaId, provider, number, origin: "core", changedAt: now })
        .onConflictDoUpdate({ target: [mangaChapterNumbers.mediaId, mangaChapterNumbers.provider], set: { number, origin: "core", changedAt: now } }))
}

/** GET /api/v1/manga/latest-chapter-numbers: per manga one item per provider (scanlator and language are not told apart) */
export async function latestChapterNumbers(environment: StreamEnvironment): Promise<Json> {
    const database = await environment.core.database()
    const rows = await database.select().from(mangaChapterNumbers)
    rows.sort((a, b) => a.mediaId - b.mediaId || a.provider.localeCompare(b.provider))
    const map: Record<string, Json[]> = {}
    for (const row of rows) (map[String(row.mediaId)] ??= []).push({ provider: row.provider, scanlator: "", language: "", number: row.number })
    return map
}
