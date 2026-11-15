// geschrieben nach: Aufzeichnung api und api-schreibend vom 13.11.2026 (ANIME_ENTRIES.GetAnimeEntrySilenceStatus/ToggleAnimeEntrySilenceStatus, METADATA.GetMediaMetadataParent/SaveMediaMetadataParent/DeleteMediaMetadataParent: Antworten vor und nach dem Ändern), den App-Typen der Anfragen (src/api/generated/endpoint.types.ts) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext

import { eq } from "drizzle-orm"
import { inOrder } from "../database/database"
import { metadataParents, silencedAnime } from "../database/schema"
import { CoreError } from "../errors"
import type { CoreEnvironment, CoreRequest } from "../registry"

/*
 * Two small marks the user sets on an anime's page (area `library`, phase 5a-3, docs/EIGENER-KERN.md §4p), kept in
 * `core.db`:
 *
 * - Silenced: the anime's missing episodes are not reported. Silenced, the answer is the mark (`id` = the anime,
 *   times as text); not silenced, `false` (recorded both ways). Toggling answers `true`.
 * - Parent of the metadata: the anime takes its episode metadata from another anime, its specials shifted. Without a
 *   parent the answer is the empty mark (all numbers 0, times "0001-01-01T00:00:00Z", as recorded). Saving answers the
 *   saved mark, deleting `true`.
 */

type Environment = Pick<CoreEnvironment, "database" | "now">

const NO_TIME = "0001-01-01T00:00:00Z"

function wholeNumber(value: unknown, name: string, positive = true): number {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value
    if (typeof number !== "number" || !Number.isInteger(number) || (positive ? number <= 0 : number < 0)) throw new CoreError(`invalid ${name}`, 400)
    return number
}

function field(body: unknown, name: string): unknown {
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined
}

const timeText = (milliseconds: number) => new Date(milliseconds).toISOString()

/** GET /api/v1/library/anime-entry/silence/{id} */
export async function silenceStatus(request: CoreRequest, environment: Environment): Promise<unknown> {
    const id = wholeNumber(request.path.id, "id")
    const database = await environment.database()
    const [row] = await inOrder(database, () => database.select().from(silencedAnime).where(eq(silencedAnime.anilistId, id)))
    return row ? { id: row.anilistId, createdAt: timeText(row.createdAt), updatedAt: timeText(row.updatedAt) } : false
}

/** POST /api/v1/library/anime-entry/silence: `{ mediaId }`, silenced ↔ not silenced */
export async function toggleSilence(request: CoreRequest, environment: Environment): Promise<boolean> {
    const id = wholeNumber(field(request.body, "mediaId"), "mediaId")
    const database = await environment.database()
    const now = environment.now()
    await inOrder(database, async () => {
        const deleted = await database.delete(silencedAnime).where(eq(silencedAnime.anilistId, id)).returning({ id: silencedAnime.anilistId })
        if (deleted.length === 0) await database.insert(silencedAnime).values({ anilistId: id, createdAt: now, updatedAt: now })
    })
    return true
}

type ParentRow = typeof metadataParents.$inferSelect

function parentOf(row: ParentRow | undefined) {
    if (!row) return { id: 0, createdAt: NO_TIME, updatedAt: NO_TIME, mediaId: 0, parentId: 0, specialOffset: 0 }
    return { id: row.id, createdAt: timeText(row.createdAt), updatedAt: timeText(row.updatedAt), mediaId: row.mediaId, parentId: row.parentId, specialOffset: row.specialOffset }
}

/** GET /api/v1/metadata/parent/{id} */
export async function metadataParent(request: CoreRequest, environment: Environment): Promise<unknown> {
    const id = wholeNumber(request.path.id, "id")
    const database = await environment.database()
    const [row] = await inOrder(database, () => database.select().from(metadataParents).where(eq(metadataParents.mediaId, id)))
    return parentOf(row)
}

/** POST /api/v1/metadata/parent: `{ mediaId, parentId, specialOffset }`; a second save replaces the first */
export async function saveMetadataParent(request: CoreRequest, environment: Environment): Promise<unknown> {
    const mediaId = wholeNumber(field(request.body, "mediaId"), "mediaId")
    const parentId = wholeNumber(field(request.body, "parentId"), "parentId")
    const specialOffset = field(request.body, "specialOffset") === undefined ? 0 : wholeNumber(field(request.body, "specialOffset"), "specialOffset", false)
    if (parentId === mediaId) throw new CoreError("an anime cannot be its own parent", 400)
    const database = await environment.database()
    const now = environment.now()
    const [row] = await inOrder(database, () => database.insert(metadataParents)
        .values({ mediaId, parentId, specialOffset, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: metadataParents.mediaId, set: { parentId, specialOffset, updatedAt: now } })
        .returning())
    return parentOf(row)
}

/** DELETE /api/v1/metadata/parent: `{ mediaId }` */
export async function deleteMetadataParent(request: CoreRequest, environment: Environment): Promise<boolean> {
    const mediaId = wholeNumber(field(request.body, "mediaId"), "mediaId")
    const database = await environment.database()
    await inOrder(database, () => database.delete(metadataParents).where(eq(metadataParents.mediaId, mediaId)))
    return true
}
