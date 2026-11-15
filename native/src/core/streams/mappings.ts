// geschrieben nach: Aufzeichnungen ONLINESTREAM.GetOnlinestreamMapping/OnlinestreamManualMapping/RemoveOnlinestreamMapping (Form, Zustand davor/danach), dem Schema der Server-DB-Kopie (Tabelle `onlinestream_mappings`, nur Spaltennamen) und docs/EIGENER-KERN.md §4c/§4m; kein Server-Quelltext

import { and, eq } from "drizzle-orm"
import { type CoreDatabase, inOrder } from "../database/database"
import { onlinestreamMappingMove, onlinestreamMappings } from "../database/schema"
import type { ExtensionPlace } from "../extensions/manage/installed"

/*
 * Which entry of a provider an anime is, when the user chose it by hand (§4m). The core keeps its own table; the
 * server's mappings are taken over once, read only, the first time any mapping is needed (like the move of stage 1,
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
    if ((await database.select().from(onlinestreamMappingMove)).length > 0) return 0
    const rows = (await environment.place.serverMappings?.()) ?? []
    const now = environment.now()
    const taken = rows.filter(row => row.provider !== "" && Number.isInteger(row.mediaId) && row.mediaId > 0 && row.animeId !== "")
    return inOrder(database, () => database.transaction(async writer => {
        // a second request may have moved them in the meantime
        if ((await writer.select().from(onlinestreamMappingMove)).length > 0) return 0
        for (const row of taken) {
            await writer.insert(onlinestreamMappings)
                .values({ provider: row.provider, mediaId: row.mediaId, animeId: row.animeId, origin: "server", changedAt: now })
                .onConflictDoNothing()
        }
        await writer.insert(onlinestreamMappingMove).values({ id: 1, count: taken.length, movedAt: now })
        return taken.length
    }))
}

/** The entry the user chose for an anime at a provider, or null */
export async function mappingOf(environment: MappingEnvironment, provider: string, mediaId: number): Promise<string | null> {
    await moveServerMappings(environment)
    const database = await environment.database()
    const row = (await database.select().from(onlinestreamMappings)
        .where(and(eq(onlinestreamMappings.provider, provider), eq(onlinestreamMappings.mediaId, mediaId))))[0]
    return row?.animeId ?? null
}

export async function setMapping(environment: MappingEnvironment, provider: string, mediaId: number, animeId: string): Promise<void> {
    await moveServerMappings(environment)
    const database = await environment.database()
    const now = environment.now()
    await inOrder(database, () => database.insert(onlinestreamMappings)
        .values({ provider, mediaId, animeId, origin: "core", changedAt: now })
        .onConflictDoUpdate({ target: [onlinestreamMappings.provider, onlinestreamMappings.mediaId], set: { animeId, origin: "core", changedAt: now } }))
}

export async function removeMapping(environment: MappingEnvironment, provider: string, mediaId: number): Promise<void> {
    await moveServerMappings(environment)
    const database = await environment.database()
    await inOrder(database, () => database.delete(onlinestreamMappings)
        .where(and(eq(onlinestreamMappings.provider, provider), eq(onlinestreamMappings.mediaId, mediaId))))
}
