// geschrieben nach: docs/EIGENER-KERN.md §4t (B3) und dem Stil von playback/playback.ts (watch_positions); kein Server-Quelltext

import { type SQL, desc, eq, sql } from "drizzle-orm"
import { inOrder } from "../database/database"
import { ownShows } from "../database/schema"
import { CoreError } from "../errors"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { isTvmazeId, tvmazeMedia } from "./tvmaze"

/*
 * The titles of TVmaze (negative ids) on the device (§4t, B3): their progress, which AniList never sees, and "My shows".
 * The player's own progress (`auto`) never lowers what is kept; a mark the user sets does.
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "database" | "now">
export type OwnShow = { progress: number, listed: boolean }

export async function ownShowOf(environment: Pick<CoreEnvironment, "database">, id: number): Promise<OwnShow | null> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select().from(ownShows).where(eq(ownShows.mediaId, id)))
    return rows[0] ? { progress: rows[0].progress, listed: rows[0].listed === 1 } : null
}

/**
 * One statement that writes only the column that changes, so the player's progress and a "My shows" switch at the same
 * time cannot write over each other (a read first and a write after could).
 */
async function keep(environment: Environment, id: number, column: { progress: number | SQL } | { listed: number }, first: OwnShow): Promise<void> {
    const database = await environment.database()
    const changedAt = environment.now()
    await inOrder(database, () => database.insert(ownShows)
        .values({ mediaId: id, progress: first.progress, listed: first.listed ? 1 : 0, changedAt })
        .onConflictDoUpdate({ target: ownShows.mediaId, set: { ...column, changedAt } }))
}

/** The progress of a TVmaze title (anilist/changes.ts, update-progress) */
export async function setOwnProgress(environment: Environment, id: number, progress: number, auto: boolean): Promise<boolean> {
    const value = auto ? sql`max(${ownShows.progress}, ${progress})` : progress
    await keep(environment, id, { progress: value }, { progress, listed: false })
    return true
}

/** GET /api/v1/other-sources/my-shows: the titles in "My shows", the last changed first */
export async function myShows(_request: CoreRequest, environment: CoreEnvironment): Promise<Json[]> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select({ mediaId: ownShows.mediaId }).from(ownShows)
        .where(eq(ownShows.listed, 1)).orderBy(desc(ownShows.changedAt)))
    const shows = await Promise.all(rows.map(row => tvmazeMedia(environment, row.mediaId).catch(() => null)))
    return shows.filter((show): show is Json => show !== null)
}

/** POST /api/v1/other-sources/my-shows { mediaId, listed }: adds a TVmaze title to "My shows" or takes it out */
export async function changeMyShows(request: CoreRequest, environment: CoreEnvironment): Promise<boolean> {
    const body = (request.body ?? {}) as { mediaId?: unknown, listed?: unknown }
    const id = body.mediaId
    if (typeof id !== "number" || !isTvmazeId(id) || typeof body.listed !== "boolean") throw new CoreError("invalid id", 400)
    const listed = body.listed
    await keep(environment, id, { listed: listed ? 1 : 0 }, { progress: 0, listed })
    return true
}
