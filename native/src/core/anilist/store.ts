// geschrieben nach: Plan „Eigener Kern" Stufe 2 (eigener Speicher statt AniList als einzige Grundlage), der Drizzle-Doku (Einfügen mit onConflictDoUpdate, Verbund-Abfragen, sql-Vorlagen) und der SQLite-Doku (json_each, json_extract, Upsert nach SELECT braucht WHERE); kein Server-Quelltext

import { and, asc, eq, sql } from "drizzle-orm"
import { type CoreDatabase, inOrder } from "../database/database"
import { anilistAnswers, anilistListEntries, anilistMedia } from "../database/schema"

/*
 * What the core keeps of AniList's answers, so that it can answer when AniList cannot be reached (anilist.ts).
 *
 * - Titles get a number of the core's own; AniList's number is a field beside it. A title read again is updated in place.
 * - A list collection is kept as a whole: every read of it replaces the entries of its kind, so an entry the user
 *   removed elsewhere does not stay. The names and states of the lists are kept with the collection's question.
 * - Every other answer (a search page, a studio, the statistics) is kept under its question, the newest one only.
 */

export type ListKind = "ANIME" | "MANGA"

type Json = Record<string, unknown>
type ListHead = { name?: unknown, status?: unknown, isCustomList?: unknown }
export type ListCollection = { MediaListCollection: { lists: (ListHead & { entries?: Json[] })[] } }

/**
 * Rows per statement of a list collection. The rows of one statement travel as one JSON text and SQLite takes them
 * apart on the database's thread (json_each). Putting the same statement together row by row and value by value
 * held the calling thread for 8 to 30 ms each, with 25 rows as with 100 (measured on the tablet, docs/EIGENER-KERN.md
 * §4d).
 */
const CHUNK = 40

function chunks<T>(items: T[]): T[][] {
    const result: T[][] = []
    for (let start = 0; start < items.length; start += CHUNK) result.push(items.slice(start, start + CHUNK))
    return result
}

const collectionQuestion = (kind: ListKind) => `collection/${kind}`

export async function keepAnswer(database: CoreDatabase, question: string, answer: unknown, now: number): Promise<void> {
    await inOrder(database, () => database.insert(anilistAnswers)
        .values({ question, answer, changedAt: now })
        .onConflictDoUpdate({ target: anilistAnswers.question, set: { answer, changedAt: now } }))
}

/** The answer kept for a question, or null when there is none */
export async function storedAnswer(database: CoreDatabase, question: string): Promise<unknown | null> {
    const rows = await inOrder(database, () => database.select({ answer: anilistAnswers.answer }).from(anilistAnswers).where(eq(anilistAnswers.question, question)))
    return rows.length > 0 ? rows[0].answer : null
}

/** The answer kept for a question with the time it was kept, or null when there is none */
export async function storedAnswerWithTime(database: CoreDatabase, question: string): Promise<{ answer: unknown, changedAt: number } | null> {
    const rows = await inOrder(database, () => database.select({ answer: anilistAnswers.answer, changedAt: anilistAnswers.changedAt })
        .from(anilistAnswers).where(eq(anilistAnswers.question, question)))
    return rows.length > 0 ? { answer: rows[0].answer, changedAt: Number(rows[0].changedAt) } : null
}

/** Keeps a complete list collection of one kind: its titles, its entries and the heads of its lists. */
export async function keepCollection(database: CoreDatabase, kind: ListKind, collection: ListCollection, now: number): Promise<void> {
    const lists = collection.MediaListCollection.lists
    const titles = new Map<number, Json>()
    for (const list of lists) {
        for (const entry of list.entries ?? []) {
            const media = entry.media as Json | undefined
            if (typeof media?.id === "number") titles.set(media.id, media)
        }
    }
    // an entry without its title, with its places: l the list, p the place in it, m AniList's number of the title
    const entries = lists.flatMap((list, l) => (list.entries ?? []).map((entry, p) => ({ l, p, entry })))
    await inOrder(database, () => database.transaction(async transaction => {
        // table and column names as in schema.ts (anilistMedia, anilistListEntries)
        for (const part of chunks([...titles.values()])) {
            await transaction.run(sql`insert into anilist_media (anilist_id, kind, content, changed_at)
                select json_extract(value, '$.id'), ${kind}, value, ${now} from json_each(${JSON.stringify(part)}) where true
                on conflict (anilist_id) do update set kind = excluded.kind, content = excluded.content, changed_at = excluded.changed_at`)
        }
        await transaction.delete(anilistListEntries).where(eq(anilistListEntries.kind, kind))
        for (const part of chunks(entries)) {
            const rows = part.map(({ l, p, entry: { media, ...c } }) => ({ l, p, m: (media as Json | undefined)?.id, c }))
            // the title's own number comes from the join; an entry without a kept title or without a number is left out
            await transaction.run(sql`insert into anilist_list_entries (anilist_id, media, kind, list, position, content, changed_at)
                select json_extract(e.value, '$.c.id'), m.id, ${kind}, json_extract(e.value, '$.l'), json_extract(e.value, '$.p'), json_extract(e.value, '$.c'), ${now}
                from json_each(${JSON.stringify(rows)}) as e join anilist_media as m on m.anilist_id = json_extract(e.value, '$.m')
                where typeof(json_extract(e.value, '$.c.id')) = 'integer'`)
        }

        const heads = lists.map(({ entries: _entries, ...head }) => head)
        await transaction.insert(anilistAnswers)
            .values({ question: collectionQuestion(kind), answer: heads, changedAt: now })
            .onConflictDoUpdate({ target: anilistAnswers.question, set: { answer: heads, changedAt: now } })
    }))
}

/** Sets the studios of titles already kept (by AniList number), in place: their list entries stay as they are */
export async function keepStudios(database: CoreDatabase, studios: Map<number, unknown>, now: number): Promise<void> {
    if (studios.size === 0) return
    await inOrder(database, () => database.transaction(async transaction => {
        for (const [id, value] of studios) {
            await transaction.run(sql`update anilist_media set content = json_set(content, '$.studios', json(${JSON.stringify(value)})), changed_at = ${now}
                where anilist_id = ${id} and content is not null`)
        }
    }))
}

/** The list collection as it was last kept, or null when it was never read */
export async function storedCollection(database: CoreDatabase, kind: ListKind): Promise<ListCollection | null> {
    const heads = await storedAnswer(database, collectionQuestion(kind))
    if (!Array.isArray(heads)) return null
    const rows = await inOrder(database, () => database
        .select({ list: anilistListEntries.list, content: anilistListEntries.content, media: anilistMedia.content })
        .from(anilistListEntries)
        .innerJoin(anilistMedia, eq(anilistListEntries.media, anilistMedia.id))
        .where(eq(anilistListEntries.kind, kind))
        .orderBy(asc(anilistListEntries.list), asc(anilistListEntries.position)))
    const lists = (heads as ListHead[]).map(head => ({ ...head, entries: [] as Json[] }))
    for (const row of rows) lists[row.list]?.entries.push({ ...row.content, media: row.media ?? {} })
    // AniList sends no list without entries; one emptied by a change of the core (putEntry, removeEntry) is none either
    return { MediaListCollection: { lists: lists.filter(list => list.entries.length > 0) } }
}

/** The recorded answers leave out empty values: no null anywhere, no empty list. Empty objects stay ("startedAt": {}). */
export function withoutEmpty(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutEmpty)
    if (value === null || typeof value !== "object") return value
    const result: Json = {}
    for (const [key, field] of Object.entries(value)) {
        if (field === null || field === undefined || (Array.isArray(field) && field.length === 0)) continue
        result[key] = withoutEmpty(field)
    }
    return result
}

/* ---- One entry of the lists, for the changes the core makes itself (changes.ts) ---- */

/** The names AniList gives its lists, for a list the kept collection does not have yet (recorded: Planning, Watching, Completed, Reading) */
const LIST_NAMES: Record<ListKind, Record<string, string>> = {
    ANIME: { CURRENT: "Watching", PLANNING: "Planning", COMPLETED: "Completed", DROPPED: "Dropped", PAUSED: "Paused", REPEATING: "Rewatching" },
    MANGA: { CURRENT: "Reading", PLANNING: "Planning", COMPLETED: "Completed", DROPPED: "Dropped", PAUSED: "Paused", REPEATING: "Rereading" },
}

/** The user's entry for a title as the kept lists have it (without the title), or null */
export async function storedEntry(database: CoreDatabase, kind: ListKind, mediaAnilistId: number): Promise<Json | null> {
    const rows = await inOrder(database, () => database.select({ content: anilistListEntries.content }).from(anilistListEntries)
        .innerJoin(anilistMedia, eq(anilistListEntries.media, anilistMedia.id))
        .where(and(eq(anilistMedia.anilistId, mediaAnilistId), eq(anilistListEntries.kind, kind))))
    return rows[0]?.content ?? null
}

/**
 * Puts one entry into the kept lists: changed in place, moved to the list of its status when that changed, added at the
 * end of that list when it is new. `title` is the title as AniList just sent it. Returns false when the lists cannot show
 * the entry: no collection was kept yet, or the title was never read (then the next read of the lists brings it).
 */
export async function putEntry(database: CoreDatabase, kind: ListKind, mediaAnilistId: number, entry: Json, now: number, title?: Json): Promise<boolean> {
    return inOrder(database, () => database.transaction(async transaction => {
        const kept = await transaction.select({ answer: anilistAnswers.answer }).from(anilistAnswers).where(eq(anilistAnswers.question, collectionQuestion(kind)))
        if (!Array.isArray(kept[0]?.answer)) return false
        const heads = kept[0].answer as ListHead[]
        if (title) {
            await transaction.insert(anilistMedia).values({ anilistId: mediaAnilistId, kind, content: title, changedAt: now })
                .onConflictDoUpdate({ target: anilistMedia.anilistId, set: { kind, content: title, changedAt: now } })
        }
        const media = (await transaction.select({ id: anilistMedia.id, content: anilistMedia.content }).from(anilistMedia).where(eq(anilistMedia.anilistId, mediaAnilistId)))[0]
        if (!media?.content) return false

        let target = heads.findIndex(head => head.status === entry.status && head.isCustomList !== true)
        if (target < 0) {
            target = heads.length
            const all = [...heads, { status: entry.status, name: LIST_NAMES[kind][String(entry.status)] ?? String(entry.status), isCustomList: false }]
            await transaction.update(anilistAnswers).set({ answer: all, changedAt: now }).where(eq(anilistAnswers.question, collectionQuestion(kind)))
        }
        // a title can stand in lists of the user's own as well; its entry is the same in all of them
        const places = await transaction.select({ id: anilistListEntries.id, list: anilistListEntries.list }).from(anilistListEntries)
            .where(and(eq(anilistListEntries.media, media.id), eq(anilistListEntries.kind, kind)))
        const number = typeof entry.id === "number" ? entry.id : 0
        await transaction.update(anilistListEntries).set({ content: entry, anilistId: number, changedAt: now })
            .where(and(eq(anilistListEntries.media, media.id), eq(anilistListEntries.kind, kind)))
        const home = places.find(place => heads[place.list]?.isCustomList !== true)
        if (home?.list === target) return true
        const last = await transaction.select({ position: sql<number | null>`max(${anilistListEntries.position})` }).from(anilistListEntries)
            .where(and(eq(anilistListEntries.kind, kind), eq(anilistListEntries.list, target)))
        const position = (last[0]?.position ?? -1) + 1
        if (home) await transaction.update(anilistListEntries).set({ list: target, position }).where(eq(anilistListEntries.id, home.id))
        else await transaction.insert(anilistListEntries).values({ anilistId: number, media: media.id, kind, list: target, position, content: entry, changedAt: now })
        return true
    }))
}

/** Takes a title's entry out of the kept lists */
export async function removeEntry(database: CoreDatabase, kind: ListKind, mediaAnilistId: number): Promise<void> {
    // table and column names as in schema.ts (anilistListEntries, anilistMedia)
    await inOrder(database, () => database.run(sql`delete from anilist_list_entries where kind = ${kind}
        and media in (select id from anilist_media where anilist_id = ${mediaAnilistId})`))
}

/** Keeps the long form of a title (its details page) beside what the lists know of it */
export async function keepDetails(database: CoreDatabase, kind: ListKind, anilistId: number, details: Json, now: number): Promise<void> {
    await inOrder(database, () => database.insert(anilistMedia)
        .values({ anilistId, kind, details, changedAt: now })
        .onConflictDoUpdate({ target: anilistMedia.anilistId, set: { details, changedAt: now } }))
}

export async function storedDetails(database: CoreDatabase, kind: ListKind, anilistId: number): Promise<Json | null> {
    const rows = await inOrder(database, () => database.select({ details: anilistMedia.details }).from(anilistMedia)
        .where(and(eq(anilistMedia.anilistId, anilistId), eq(anilistMedia.kind, kind))))
    return rows[0]?.details ?? null
}
