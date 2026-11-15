// geschrieben nach: Aufzeichnungen MANGA.GetMangaMapping/MangaManualMapping/RemoveMangaMapping (Form), dem Schema der Server-DB-Kopie (Tabelle `manga_mappings`, nur Spaltennamen) und docs/EIGENER-KERN.md §4m/§4n; kein Server-Quelltext

import { and, eq } from "drizzle-orm"
import { type CoreDatabase, inOrder } from "../database/database"
import { mangaMappingMove, mangaMappings } from "../database/schema"
import type { ExtensionPlace } from "../extensions/manage/installed"

/*
 * Which entry of a provider a manga is, when the user chose it by hand (§4n). The core keeps its own table; the
 * server's mappings are taken over once, read only, the first time any mapping is needed (like the online streams, §4m, and the move of stage 1,
 * §4c). After that only the core's table counts: what the core changes the server does not see, and the server's
 * table stays as it was.
 */

export type MappingEnvironment = {
    database: () => Promise<CoreDatabase>
    place: ExtensionPlace
    now: () => number
}

/** Takes the server's mappings over, once; returns how many were taken (0 when it ran before) */
export async function moveServerMappings(environment: MappingEnvironment): Promise<number> {
    const database = await environment.database()
    if ((await database.select().from(mangaMappingMove)).length > 0) return 0
    const rows = (await environment.place.serverMangaMappings?.()) ?? []
    const now = environment.now()
    const taken = rows.filter(row => row.provider !== "" && Number.isInteger(row.mediaId) && row.mediaId > 0 && row.mangaId !== "")
    return inOrder(database, () => database.transaction(async writer => {
        // a second request may have moved them in the meantime
        if ((await writer.select().from(mangaMappingMove)).length > 0) return 0
        for (const row of taken) {
            await writer.insert(mangaMappings)
                .values({ provider: row.provider, mediaId: row.mediaId, mangaId: row.mangaId, origin: "server", changedAt: now })
                .onConflictDoNothing()
        }
        await writer.insert(mangaMappingMove).values({ id: 1, count: taken.length, movedAt: now })
        return taken.length
    }))
}

/** The entry the user chose for a manga at a provider, or null */
export async function mappingOf(environment: MappingEnvironment, provider: string, mediaId: number): Promise<string | null> {
    await moveServerMappings(environment)
    const database = await environment.database()
    const row = (await database.select().from(mangaMappings)
        .where(and(eq(mangaMappings.provider, provider), eq(mangaMappings.mediaId, mediaId))))[0]
    return row?.mangaId ?? null
}

export async function setMapping(environment: MappingEnvironment, provider: string, mediaId: number, mangaId: string): Promise<void> {
    await moveServerMappings(environment)
    const database = await environment.database()
    const now = environment.now()
    await inOrder(database, () => database.insert(mangaMappings)
        .values({ provider, mediaId, mangaId, origin: "core", changedAt: now })
        .onConflictDoUpdate({ target: [mangaMappings.provider, mangaMappings.mediaId], set: { mangaId, origin: "core", changedAt: now } }))
}

export async function removeMapping(environment: MappingEnvironment, provider: string, mediaId: number): Promise<void> {
    await moveServerMappings(environment)
    const database = await environment.database()
    await inOrder(database, () => database.delete(mangaMappings)
        .where(and(eq(mangaMappings.provider, provider), eq(mangaMappings.mediaId, mediaId))))
}
