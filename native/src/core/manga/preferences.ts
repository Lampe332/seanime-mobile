// geschrieben nach: Aufzeichnungen MANGA.GetMangaPreferences/PatchMangaPreference/ImportMangaPreferences/GetMangaSourceRefresh (Form, Zustand davor/danach), den generierten Typen Manga_MangaPreferences/Manga_MangaSourceRefreshJob, App-Code src/main/manga/_lib (manga-preferences-sync.tsx, handle-manga-selected-provider.ts) und docs/EIGENER-KERN.md §4n; kein Server-Quelltext

import { eq } from "drizzle-orm"
import { inOrder } from "../database/database"
import { mangaPreferences } from "../database/schema"
import { CoreError } from "../errors"
import type { CoreRequest } from "../registry"
import type { StreamEnvironment } from "../streams/onlinestream"

/*
 * The source and chapter filters the user chose per manga (phase 4a-2, §4n), in core.db. The server's ones are read
 * once (its answer to GET /manga/preferences, read only), the first time they are needed while the server is there; a
 * choice made in the core before wins over it. The source refresh stays a job of the server: when one of its jobs has
 * ended with changes, the core takes the server's choice for exactly those manga, once per job.
 */

type Json = Record<string, unknown>
type Entry = { provider: string, filters: Json }

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function entriesOf(value: unknown): Map<number, Entry> {
    const found = new Map<number, Entry>()
    const entries = isRecord(value) && isRecord(value.entries) ? value.entries : {}
    for (const [key, entry] of Object.entries(entries)) {
        const mediaId = Number(key)
        if (!Number.isInteger(mediaId) || mediaId <= 0 || !isRecord(entry) || typeof entry.provider !== "string" || entry.provider === "") continue
        found.set(mediaId, { provider: entry.provider, filters: isRecord(entry.filters) ? entry.filters : {} })
    }
    return found
}

async function allEntries(environment: StreamEnvironment): Promise<Json> {
    const database = await environment.core.database()
    const rows = await database.select().from(mangaPreferences)
    rows.sort((a, b) => a.mediaId - b.mediaId)
    return { entries: Object.fromEntries(rows.map(row => [String(row.mediaId), { provider: row.provider, filters: row.filters }])) }
}

/** GET /api/v1/manga/preferences */
export async function mangaPreferencesOf(environment: StreamEnvironment): Promise<Json> {
    return allEntries(environment)
}

/** PATCH /api/v1/manga/preferences/{mediaId}: the given fields over the kept ones; answers the manga's entry */
export async function patchMangaPreference(environment: StreamEnvironment, request: CoreRequest): Promise<Entry> {
    const mediaId = Number(request.path.mediaId)
    if (!Number.isInteger(mediaId) || mediaId <= 0) throw new CoreError("mediaId is required", 400)
    const body = isRecord(request.body) ? request.body : {}
    const database = await environment.core.database()
    const known = (await database.select().from(mangaPreferences).where(eq(mangaPreferences.mediaId, mediaId)))[0]
    const entry: Entry = {
        provider: typeof body.provider === "string" ? body.provider : known?.provider ?? "",
        filters: isRecord(body.filters) ? body.filters : known?.filters ?? {},
    }
    if (entry.provider === "") throw new CoreError("provider is required", 400)
    const now = environment.core.now()
    await inOrder(database, () => database.insert(mangaPreferences)
        .values({ mediaId, ...entry, origin: "core", changedAt: now })
        .onConflictDoUpdate({ target: mangaPreferences.mediaId, set: { ...entry, origin: "core", changedAt: now } }))
    return entry
}

/** POST /api/v1/manga/preferences/import: the app's older choices, only for manga the core has none for; answers all */
export async function importMangaPreferences(environment: StreamEnvironment, body: unknown): Promise<Json> {
    const database = await environment.core.database()
    const now = environment.core.now()
    const given = entriesOf(body)
    await inOrder(database, () => database.transaction(async writer => {
        for (const [mediaId, entry] of given) {
            await writer.insert(mangaPreferences).values({ mediaId, ...entry, origin: "core", changedAt: now }).onConflictDoNothing()
        }
    }))
    return allEntries(environment)
}
