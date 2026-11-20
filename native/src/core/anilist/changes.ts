// geschrieben nach: Aufzeichnung api-anilist-schreibend vom 13.11.2026 (scratch-App mit Test-Konto: Anfragen, Antwort „true“, Fehlertexte „missing parameters“ und „list entry not found“, AniLists Prüf-Texte, welcher Status nach einem Fortschritt steht, welche Ereignisse der Server danach sendet), App-Code src/api/hooks (anilist, anime_entries, manga: Adressen und Anfrage-Formen) und src/main/_listeners (was die Oberfläche auf die Ereignisse hin neu liest), der öffentlichen AniList-Doku (SaveMediaListEntry, DeleteMediaListEntry, Media.mediaListEntry, FuzzyDateInput) und Plan „Eigener Kern" Stufe 2b (Warteschlange, Konflikt-Regeln); kein Server-Quelltext

import { and, asc, eq } from "drizzle-orm"
import { type CoreDatabase, inOrder } from "../database/database"
import { account, anilistAnswers, anilistChanges } from "../database/schema"
import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { INCOGNITO_ERROR, incognitoOn } from "../settings/incognito"
import { anilistStateChanged, sharedCacheOnly } from "./cache-only"
import { AnilistFailure, askAnilist, changeAnilist, clientFor, sharedSignIn, signInAccepted } from "./client"
import { DELETE_ENTRY, ENTRY_MEDIA, VIEWER_ENTRY, VIEWER_ID, saveEntryMutation } from "./queries"
import { type ListCollection, type ListKind, keepAnswer, keepCollection, putEntry, removeEntry, storedAnswer, storedCollection, storedEntry, withoutEmpty } from "./store"

/*
 * Changing the user's AniList lists from the core (docs/EIGENER-KERN.md §4f): an entry's status, score, progress, dates
 * and rewatches, and removing an entry.
 *
 * Every change takes the same way. It is written into a queue in the core's database and shown in the core's own lists
 * at once; then the queue is sent. With AniList reachable that happens within the same request, and the lists take
 * what AniList answers. Without AniList the change waits, the app goes on with the lists as changed, and the queue is
 * sent later: before the lists are read again, with the next change, or by a timer.
 *
 * The rules when changes meet:
 * - One row per title. A later change of the same title is merged into its row, field by field, the later value wins;
 *   the row keeps its place in the order.
 * - Rows are sent in the order they were made. The first one AniList cannot be asked for stops the run: nothing
 *   overtakes it.
 * - Removing after changing leaves the removal only. Changing after removing sends the removal first, then the change,
 *   so nothing of the old entry stays.
 * - Progress never shrinks by accident. A change that waited is held against AniList's entry first: when AniList is
 *   further than the change and not where the change started from (watched on another device meanwhile), the progress
 *   is not sent, nor a status that only followed from it. A change sent at once is the user's wish as it is, as with
 *   the server (recorded: marking episode 2 of an entry at 7 sets 2).
 * - AniList refuses a change (a status of 400 to 499, but not 429 or 401): the change is dropped, the entry is read again
 *   from AniList and the user is told. AniList cannot be asked (network, 5xx, rate limit): the change stays and is tried
 *   again. AniList turns the sign-in away (401, an expired or revoked token, client.ts): the change stays, nothing is
 *   retried by the timer, and the app offers to sign in again (anilist-sync.tsx); the new sign-in sends the queue.
 * - A change belongs to the account it was made with. Signed in as someone else, it is dropped, never sent.
 * - A change made while its row is being sent is not lost: the row is taken out only when it still holds what was sent,
 *   otherwise it stays and goes out in the next run.
 * - Without an AniList account (the local account: no name, no token) a change is the app's own: it is written into the
 *   core's lists and nothing is queued, since there is nobody to send it to.
 */

type Json = Record<string, unknown>
type FuzzyDate = { year?: number | null, month?: number | null, day?: number | null }

/** What a change sets on the entry. A date that is null is taken away. */
type Fields = { status?: string, score?: number, progress?: number, repeat?: number, startedAt?: FuzzyDate | null, completedAt?: FuzzyDate | null }

type Change = {
    fields: Fields
    /** The status follows from the progress (an episode was marked as watched); nobody chose it */
    statusByProgress?: boolean
    /** The entry was removed before and that is not sent yet: AniList's entry goes first */
    afterDelete?: boolean
    /** The entry's progress before the first unsent change, null: there was no entry */
    base: { progress: number } | null
}

type Row = typeof anilistChanges.$inferSelect
type Environment = Pick<CoreEnvironment, "fetch" | "secret" | "database" | "now" | "pause" | "onlyAccount" | "unasked">

/** What became of a row in one run of the queue; "signin": kept until the user signs in to AniList again */
export type Outcome = "sent" | "kept" | "signin" | { refused: string }

/** Recorded: DELETE without `mediaId` or `type` */
export const MISSING_PARAMETERS = "missing parameters"
/** Recorded: DELETE for a title that is not in the lists */
export const ENTRY_NOT_FOUND = "list entry not found"
export const NOT_LOGGED_IN = "not logged in to AniList"
/** Told to the user when a change could not be sent now */
export const KEPT_FOR_LATER = "AniList cannot be reached. The change is kept on this device and sent later."
export const OTHER_ACCOUNT = "the change was made with another AniList account"
export const CHANGES_LOCKED = "this app may only change its test account on AniList, and another one is signed in"
export const CHANGES_UNCHECKED = "this app may only change its test account on AniList, and the account could not be checked"

const STATUSES = ["CURRENT", "PLANNING", "COMPLETED", "DROPPED", "PAUSED", "REPEATING"]
/** The address that makes the server read both list collections again (endpoints.ts, GetAnimeCollection with POST) */
const FIRST_RETRY_MS = 30_000
const LONGEST_RETRY_MS = 300_000

function record(value: unknown): Json {
    return typeof value === "object" && value !== null ? value as Json : {}
}

function wholeNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value)
}

function dateOf(value: unknown): FuzzyDate | null {
    const { year, month, day } = record(value) as FuzzyDate
    if (!wholeNumber(year)) return null
    return { year, month: wholeNumber(month) ? month : null, day: wholeNumber(day) ? day : null }
}

function today(now: number): FuzzyDate {
    const date = new Date(now)
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}

const kindOf = (type: unknown): ListKind => (type === "manga" ? "MANGA" : "ANIME")

/**
 * The entry as it will stand once AniList took the change, as far as that can be known without asking: the fields set,
 * and the two dates AniList fills in by itself (recorded: a first progress starts the entry today, reaching the end
 * completes it today; an edit sets or clears both dates itself).
 */
export function entryAfter(current: Json | null, mediaId: number, change: Pick<Change, "fields" | "statusByProgress" | "afterDelete">, now: number): Json {
    const { fields } = change
    const seconds = Math.floor(now / 1000)
    const before = change.afterDelete ? null : current
    // AniList's number of a new entry is not known before it answers; until then one of the core's own, below zero
    const entry: Json = before ? { ...before } : { id: -mediaId, score: 0, progress: 0, status: "CURRENT", repeat: 0, private: false, startedAt: {}, completedAt: {}, updatedAt: seconds, createdAt: seconds }
    if (fields.status !== undefined) entry.status = fields.status
    if (fields.score !== undefined) entry.score = fields.score
    if (fields.progress !== undefined) entry.progress = fields.progress
    if (fields.repeat !== undefined) entry.repeat = fields.repeat
    if ("startedAt" in fields) entry.startedAt = fields.startedAt ?? {}
    else if (!before && change.statusByProgress && entry.status === "CURRENT") entry.startedAt = today(now)
    if ("completedAt" in fields) entry.completedAt = fields.completedAt ?? {}
    else if (entry.status === "COMPLETED" && before?.status !== "COMPLETED" && !wholeNumber(record(entry.completedAt).year)) entry.completedAt = today(now)
    entry.updatedAt = seconds
    return withoutEmpty(entry) as Json
}

/* ---- The queue ---- */

async function accountName(database: CoreDatabase): Promise<string> {
    const rows = await inOrder(database, () => database.select({ username: account.username }).from(account).where(eq(account.id, 1)))
    if (!rows[0]?.username) throw new CoreError(NOT_LOGGED_IN, 500)
    return rows[0].username
}

function waitingRows(database: CoreDatabase): Promise<Row[]> {
    return inOrder(database, () => database.select().from(anilistChanges).orderBy(asc(anilistChanges.id)))
}

/** How many changes wait to be sent */
export async function waitingChanges(environment: Pick<CoreEnvironment, "database">): Promise<number> {
    return (await waitingRows(await environment.database())).length
}

function dropRow(database: CoreDatabase, id: number): Promise<unknown> {
    return inOrder(database, () => database.delete(anilistChanges).where(eq(anilistChanges.id, id)))
}

/** Takes a row out after it was sent or refused, unless a newer change was merged into it meanwhile. True: taken out. */
async function dropIfUnchanged(database: CoreDatabase, row: Row): Promise<boolean> {
    const now = (await inOrder(database, () => database.select().from(anilistChanges).where(eq(anilistChanges.id, row.id))))[0]
    if (now && (now.action !== row.action || JSON.stringify(now.change) !== JSON.stringify(row.change))) return false
    await dropRow(database, row.id)
    return true
}

/**
 * The short form of a title the lists do not know yet, so that a new entry shows at once: the one kept for its anime
 * page (library.ts, `library-media:<id>`), else, for the local account only, asked of AniList (public, no token; a queued
 * change gets its title from AniList's answer when it is sent). Null: not to be had now.
 */
async function titleFor(environment: Environment, database: CoreDatabase, kind: ListKind, mediaId: number, ask: boolean): Promise<Json | null> {
    if (kind !== "ANIME") return null
    const kept = await storedAnswer(database, `library-media:${mediaId}`)
    if (typeof kept === "object" && kept !== null) return kept as Json
    if (!ask) return null
    try {
        const media = (await askAnilist(clientFor(environment), ENTRY_MEDIA, { id: mediaId })).Media
        return typeof media === "object" && media !== null ? withoutEmpty(media) as Json : null
    }
    catch (error) {
        if (error instanceof AnilistFailure) return null
        throw error
    }
}

/** Puts an entry into the core's lists; a title they never held gets its short form along (titleFor) */
async function showEntry(environment: Environment, database: CoreDatabase, kind: ListKind, mediaId: number, entry: Json, known: boolean, ask = false): Promise<boolean> {
    const now = environment.now()
    if (await putEntry(database, kind, mediaId, entry, now)) return true
    if (known) return false
    const title = await titleFor(environment, database, kind, mediaId, ask)
    return title ? putEntry(database, kind, mediaId, entry, now, title) : false
}

/** Signed in with no AniList account at all: no name and no token (the app's "local account") */
export async function withoutAnilistAccount(environment: Pick<CoreEnvironment, "database" | "secret">): Promise<boolean> {
    if (await environment.secret(ACCOUNT_TOKEN_SECRET)) return false
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select({ username: account.username }).from(account).where(eq(account.id, 1)))
    return !rows[0]?.username
}

/** The local account's lists: the core's own, begun empty the first time */
export async function localCollection(database: CoreDatabase, kind: ListKind, now: number): Promise<ListCollection> {
    const kept = await storedCollection(database, kind)
    if (kept) return kept
    const empty: ListCollection = { MediaListCollection: { lists: [] } }
    await keepCollection(database, kind, empty, now)
    return empty
}

/**
 * Where the local account's lists are kept once the user signs in to AniList (auth.ts): the first read of AniList's
 * lists replaces the core's lists, so "Upload local lists" (POST /api/v1/local/sync-simulated-to-anilist) sends these.
 */
export const LOCAL_LISTS_QUESTION = (kind: ListKind) => `local-account-lists:${kind}`

/** At sign-in from the local account: its lists, put aside for the upload (nothing when they are empty) */
export async function keepLocalListsAside(database: CoreDatabase, now: number): Promise<void> {
    for (const kind of ["ANIME", "MANGA"] as ListKind[]) {
        const collection = await storedCollection(database, kind)
        if (collection?.MediaListCollection.lists.some(list => (list.entries?.length ?? 0) > 0)) await keepAnswer(database, LOCAL_LISTS_QUESTION(kind), collection, now)
    }
}

/**
 * POST /api/v1/local/sync-simulated-to-anilist: every entry of the local lists put aside at sign-in goes into the queue
 * as a change of the signed-in account (status, score, progress, rewatches, dates) and the queue is sent. What AniList
 * cannot take now waits in the queue like any change; the lists put aside are then forgotten.
 */
export async function uploadLocalLists(_request: CoreRequest, environment: Environment): Promise<boolean> {
    if (await withoutAnilistAccount(environment)) throw new CoreError(NOT_LOGGED_IN, 500)
    await mayChange(environment)
    const database = await environment.database()
    const kinds = new Set<ListKind>()
    for (const kind of ["ANIME", "MANGA"] as ListKind[]) {
        const kept = await storedAnswer(database, LOCAL_LISTS_QUESTION(kind)) as ListCollection | null
        for (const list of kept?.MediaListCollection?.lists ?? []) {
            for (const entry of list.entries ?? []) {
                const mediaId = record(entry.media).id
                if (!wholeNumber(mediaId)) continue
                const fields: Fields = {}
                if (typeof entry.status === "string" && STATUSES.includes(entry.status)) fields.status = entry.status
                if (typeof entry.score === "number") fields.score = entry.score
                if (wholeNumber(entry.progress)) fields.progress = entry.progress
                if (wholeNumber(entry.repeat)) fields.repeat = entry.repeat
                const startedAt = dateOf(entry.startedAt)
                if (startedAt) fields.startedAt = startedAt
                const completedAt = dateOf(entry.completedAt)
                if (completedAt) fields.completedAt = completedAt
                await enqueue(environment, kind, mediaId, "save", fields, false)
                kinds.add(kind)
            }
        }
    }
    if (kinds.size === 0) throw new CoreError("there are no local lists to upload", 400)
    await sendWaitingChanges(environment)
    for (const kind of kinds) await inOrder(database, () => database.delete(anilistAnswers).where(eq(anilistAnswers.question, LOCAL_LISTS_QUESTION(kind))))
    await tellEveryone(environment, kinds)
    return true
}

export type AnilistSyncState = { waiting: number, reachable: boolean, localAccount: boolean, signInExpired: boolean }

/** What the app's sync hint shows: changes waiting, whether AniList answers (cache-only.ts) and takes the sign-in (client.ts) */
export async function anilistSyncState(environment: Pick<CoreEnvironment, "database" | "secret">): Promise<AnilistSyncState> {
    const localAccount = await withoutAnilistAccount(environment)
    return { waiting: await waitingChanges(environment), reachable: !sharedCacheOnly.failed, localAccount, signInExpired: !localAccount && sharedSignIn.rejected }
}

/**
 * Writes a change into the queue, merged into the row of its title when one waits, and shows it in the core's lists.
 * Returns the row's number and whether the row is this change alone.
 */
async function enqueue(environment: Environment, kind: ListKind, mediaId: number, action: "save" | "delete", fields: Fields, statusByProgress: boolean): Promise<{ id: number, alone: boolean }> {
    const database = await environment.database()
    const user = await accountName(database)
    const now = environment.now()
    const current = await storedEntry(database, kind, mediaId)
    const found = (await waitingRows(database)).find(row => row.kind === kind && row.mediaId === mediaId)
    // a row another account left behind is not continued
    const waiting = found?.account === user ? found : undefined
    const was = waiting?.change as Change | undefined

    let change: Change
    if (!was) change = { fields, statusByProgress: statusByProgress || undefined, base: current ? { progress: Number(current.progress) || 0 } : null }
    else if (action === "delete") change = { fields: {}, base: was.base }
    else if (waiting?.action === "delete") change = { fields, statusByProgress: statusByProgress || undefined, afterDelete: true, base: was.base }
    else change = { ...was, fields: { ...was.fields, ...fields }, statusByProgress: fields.status !== undefined ? statusByProgress || undefined : was.statusByProgress }

    await inOrder(database, () => database.insert(anilistChanges)
        .values({ account: user, mediaId, kind, action, change, createdAt: now, changedAt: now })
        .onConflictDoUpdate({
            target: [anilistChanges.kind, anilistChanges.mediaId],
            set: { account: user, action, change, changedAt: now, ...(waiting ? {} : { attempts: 0, lastError: null, createdAt: now }) },
        }))
    if (action === "delete") await removeEntry(database, kind, mediaId)
    else await showEntry(environment, database, kind, mediaId, entryAfter(current, mediaId, { fields, statusByProgress }, now), current !== null)

    const rows = await inOrder(database, () => database.select({ id: anilistChanges.id }).from(anilistChanges)
        .where(and(eq(anilistChanges.kind, kind), eq(anilistChanges.mediaId, mediaId))))
    return { id: rows[0].id, alone: !waiting }
}

/* ---- The guard ---- */

/** The account a token was last found to belong to. Kept in memory only, for as long as the token is the same. */
let checked: { token: string, id: number } | null = null

/**
 * The host can name the one account the core may change (`onlyAccount`: the throw-away app names its test account, so
 * that a wrong sign-in can never change a real one). Then the token's account is asked of AniList before anything is
 * sent, and anything but that account, or no answer, stops the change before it is queued.
 */
async function mayChange(environment: Environment): Promise<void> {
    const only = environment.onlyAccount?.() ?? null
    if (only === null) return
    const token = await environment.secret(ACCOUNT_TOKEN_SECRET)
    if (!token) throw new CoreError(NOT_LOGGED_IN, 500)
    if (checked?.token !== token) {
        let id: unknown
        try {
            id = record((await askAnilist(clientFor(environment), VIEWER_ID, {})).Viewer).id
        }
        catch (error) {
            if (!(error instanceof AnilistFailure)) throw error
        }
        if (!wholeNumber(id)) throw new CoreError(CHANGES_UNCHECKED, 403)
        checked = { token, id }
    }
    if (checked.id !== only) throw new CoreError(CHANGES_LOCKED, 403)
}

/* ---- Sending ---- */

async function entryOnAnilist(environment: Environment, mediaId: number): Promise<Json | null> {
    const media = record((await askAnilist(clientFor(environment), VIEWER_ENTRY, { id: mediaId })).Media)
    return typeof media.mediaListEntry === "object" && media.mediaListEntry !== null ? media.mediaListEntry as Json : null
}

/** Sends one row. `late`: the change waited, so it is held against AniList's entry first. Throws AnilistFailure. */
async function sendRow(environment: Environment, database: CoreDatabase, row: Row, late: boolean): Promise<void> {
    const client = clientFor(environment)
    const kind = row.kind as ListKind
    const change = row.change as Change
    if (row.action === "delete" || change.afterDelete) {
        // the entry's number is AniList's to say; removed elsewhere meanwhile, there is nothing left to remove
        const there = await entryOnAnilist(environment, row.mediaId)
        if (wholeNumber(there?.id)) await changeAnilist(client, DELETE_ENTRY, { id: there.id })
        if (row.action === "delete") {
            await removeEntry(database, kind, row.mediaId)
            return
        }
    }

    const fields = { ...change.fields }
    if (late && !change.afterDelete && wholeNumber(fields.progress)) {
        const there = await entryOnAnilist(environment, row.mediaId)
        const theirs = wholeNumber(there?.progress) ? there.progress : null
        if (there && theirs !== null && theirs > fields.progress && theirs !== (change.base?.progress ?? 0)) {
            delete fields.progress
            if (change.statusByProgress) delete fields.status
            if (Object.keys(fields).length === 0) {
                await putEntry(database, kind, row.mediaId, withoutEmpty(there) as Json, environment.now())
                return
            }
        }
    }

    const variables: Json = { mediaId: row.mediaId }
    if (fields.status !== undefined) variables.status = fields.status
    if (fields.score !== undefined) variables.scoreRaw = fields.score
    if (fields.progress !== undefined) variables.progress = fields.progress
    if (fields.repeat !== undefined) variables.repeat = fields.repeat
    // a date with nothing in it takes the date away; a variable that is not sent leaves the field as it is
    if ("startedAt" in fields) variables.startedAt = fields.startedAt ?? { year: null, month: null, day: null }
    if ("completedAt" in fields) variables.completedAt = fields.completedAt ?? { year: null, month: null, day: null }
    const saved = (await changeAnilist(client, saveEntryMutation(kind), variables)).SaveMediaListEntry
    if (typeof saved !== "object" || saved === null) return
    const { media, ...entry } = saved as Json
    await putEntry(database, kind, row.mediaId, withoutEmpty(entry) as Json, environment.now(), media ? withoutEmpty(media) as Json : undefined)
}

/** After a change AniList refused: the lists show AniList's entry again */
async function entryFromAnilist(environment: Environment, database: CoreDatabase, kind: ListKind, mediaId: number): Promise<void> {
    const there = await entryOnAnilist(environment, mediaId)
    if (there) await putEntry(database, kind, mediaId, withoutEmpty(there) as Json, environment.now())
    else await removeEntry(database, kind, mediaId)
}

/**
 * What the server does after a change (recorded): it reads its lists again and tells every client, which makes the
 * screens read theirs again. Here the server is asked to read again (its pages of single titles and the library come
 * from its own lists), then the same event goes out.
 */
async function tellEveryone(environment: Environment, kinds: Set<ListKind>): Promise<void> {
    if (kinds.has("ANIME")) emitCoreEvent("refreshed-anilist-anime-collection", null)
    if (kinds.has("MANGA")) emitCoreEvent("refreshed-anilist-manga-collection", null)
}

let running: Promise<unknown> = Promise.resolve()
let retry: ReturnType<typeof setTimeout> | null = null
let retryDelay = FIRST_RETRY_MS

function tryAgainLater(environment: Environment) {
    if (retry) return
    retry = setTimeout(() => {
        retry = null
        const send = () => sendWaitingChanges(environment).catch(() => undefined)
        void (environment.unasked ? environment.unasked("sending the changes that waited", send) : send())
    }, retryDelay)
    retryDelay = Math.min(retryDelay * 2, LONGEST_RETRY_MS)
}

function noRetryNeeded() {
    if (retry) clearTimeout(retry)
    retry = null
    retryDelay = FIRST_RETRY_MS
}

/** For tests: as after a new start of the app */
export function forgetChanges() {
    noRetryNeeded()
    checked = null
    running = Promise.resolve()
    sharedSignIn.rejected = false
}

async function sendAll(environment: Environment, direct: number | null): Promise<Map<number, Outcome>> {
    const outcomes = new Map<number, Outcome>()
    const database = await environment.database()
    const rows = await waitingRows(database)
    if (rows.length === 0) return outcomes
    for (const row of rows) outcomes.set(row.id, "kept")
    let user: string
    try {
        await mayChange(environment)
        user = await accountName(database)
    }
    catch (error) {
        // locked or signed out: nothing is sent and nothing is lost
        if (!(error instanceof CoreError)) throw error
        return outcomes
    }

    const told = new Set<ListKind>()
    let stopped = false
    for (const row of rows) {
        const kind = row.kind as ListKind
        if (row.account !== user) {
            await dropRow(database, row.id)
            outcomes.set(row.id, { refused: OTHER_ACCOUNT })
            continue
        }
        try {
            await sendRow(environment, database, row, row.id !== direct || row.attempts > 0)
            await dropIfUnchanged(database, row)
            outcomes.set(row.id, "sent")
            // recorded: the number of rewatches alone is followed by no event
            if (row.action === "delete" || Object.keys((row.change as Change).fields).join() !== "repeat") told.add(kind)
        }
        catch (error) {
            if (!(error instanceof AnilistFailure)) throw error
            if (error.status === 401) {
                // the sign-in is turned away (or no token is left): this row and all after it wait for the next sign-in
                signInAccepted(false)
                await inOrder(database, () => database.update(anilistChanges).set({ attempts: row.attempts + 1, lastError: error.message }).where(eq(anilistChanges.id, row.id)))
                outcomes.set(row.id, "signin")
                break
            }
            if (error.status >= 400 && error.status < 500 && error.status !== 429) {
                await dropIfUnchanged(database, row)
                await entryFromAnilist(environment, database, kind, row.mediaId).catch(() => undefined)
                outcomes.set(row.id, { refused: error.message })
                told.add(kind)
                if (row.id !== direct) emitCoreEvent("error-toast", `AniList did not take a change that waited: ${error.message}`)
                continue
            }
            await inOrder(database, () => database.update(anilistChanges).set({ attempts: row.attempts + 1, lastError: error.message }).where(eq(anilistChanges.id, row.id)))
            stopped = true
            break
        }
    }
    if (told.size > 0) await tellEveryone(environment, told)
    if (stopped) tryAgainLater(environment)
    else noRetryNeeded()
    const results = [...outcomes.values()]
    const sentCount = results.filter(outcome => outcome === "sent").length
    // counts only: which titles and what was changed is the user's
    console.log(`[Core] info changes for AniList: ${sentCount} sent, ${results.filter(outcome => typeof outcome === "object").length} dropped, ${results.filter(outcome => outcome === "kept" || outcome === "signin").length} waiting`)
    anilistStateChanged(sentCount)
    return outcomes
}

/**
 * Sends what waits, in order, one run at a time. `direct` is the row of a change made just now: it goes out as it is.
 * Never fails because AniList does; what could not be sent stays and is tried again.
 */
export function sendWaitingChanges(environment: Environment, direct: number | null = null): Promise<Map<number, Outcome>> {
    const run = running.then(() => sendAll(environment, direct))
    running = run.catch(() => undefined)
    return run
}

/**
 * The lists just read, with the changes that still wait on top: reading the lists replaces what was kept, and a change
 * AniList has not seen must not disappear from the app by that.
 */
export async function listsWithWaitingChanges(environment: Environment, kind: ListKind, read: ListCollection): Promise<ListCollection> {
    const database = await environment.database()
    const rows = (await waitingRows(database)).filter(row => row.kind === kind)
    if (rows.length === 0) return read
    for (const row of rows) {
        if (row.action === "delete") await removeEntry(database, kind, row.mediaId)
        else {
            const current = await storedEntry(database, kind, row.mediaId)
            await showEntry(environment, database, kind, row.mediaId, entryAfter(current, row.mediaId, row.change as Change, row.changedAt), current !== null)
        }
    }
    return (await storedCollection(database, kind)) ?? read
}

/** A date of an entry as the server's page of a title carries it (recorded: "2026-11-01T00:00:00Z") */
function dayText(value: unknown): string | undefined {
    const { year, month, day } = record(value) as FuzzyDate
    if (!wholeNumber(year)) return undefined
    const two = (part: number | null | undefined) => String(part || 1).padStart(2, "0")
    return `${String(year).padStart(4, "0")}-${two(month)}-${two(day)}T00:00:00Z`
}

/**
 * The server's answer for one anime's page while a change of its entry waits: `listData` as the core's lists have it
 * (recorded form: no field for 0 or for no date), since the server cannot know the change yet.
 */
export async function entryWithWaitingChange(database: CoreDatabase, mediaId: number, answer: unknown): Promise<unknown> {
    if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return answer
    const rows = await inOrder(database, () => database.select({ id: anilistChanges.id }).from(anilistChanges)
        .where(and(eq(anilistChanges.kind, "ANIME"), eq(anilistChanges.mediaId, mediaId))))
    if (rows.length === 0) return answer
    const entry = await storedEntry(database, "ANIME", mediaId)
    const { listData: _served, ...rest } = answer as Json
    if (!entry) return rest
    return { ...rest, listData: listDataOf(entry) }
}

/** A list entry as an anime page carries it (recorded form: no field for 0 or for no date) */
export function listDataOf(entry: Json): Json {
    const listData = {
        progress: entry.progress || undefined,
        score: entry.score || undefined,
        status: entry.status,
        repeat: entry.repeat || undefined,
        startedAt: dayText(entry.startedAt),
        completedAt: dayText(entry.completedAt),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
    }
    return JSON.parse(JSON.stringify(listData)) as Json
}

/* ---- The interfaces ---- */

/** The local account's change: into the core's lists only, nothing to send */
async function changeLocally(environment: Environment, kind: ListKind, mediaId: number, action: "save" | "delete", fields: Fields, statusByProgress: boolean): Promise<boolean> {
    const database = await environment.database()
    await localCollection(database, kind, environment.now())
    if (action === "delete") await removeEntry(database, kind, mediaId)
    else {
        const current = await storedEntry(database, kind, mediaId)
        const shown = await showEntry(environment, database, kind, mediaId, entryAfter(current, mediaId, { fields, statusByProgress }, environment.now()), current !== null, true)
        if (!shown) throw new CoreError("this title is not known on this device yet; open it once with a network", 500)
    }
    await tellEveryone(environment, new Set([kind]))
    return true
}

async function change(environment: Environment, kind: ListKind, mediaId: number, action: "save" | "delete", fields: Fields, statusByProgress: boolean): Promise<boolean> {
    if (await withoutAnilistAccount(environment)) return changeLocally(environment, kind, mediaId, action, fields, statusByProgress)
    await mayChange(environment)
    const { id, alone } = await enqueue(environment, kind, mediaId, action, fields, statusByProgress)
    const outcome = (await sendWaitingChanges(environment, alone ? id : null)).get(id)
    if (typeof outcome === "object") throw new CoreError(outcome.refused, 500)
    // waiting for a new sign-in: the app's sync service says so, with a way to sign in (anilist-sync.tsx)
    if (outcome === "kept" && !sharedSignIn.rejected) emitCoreEvent("info-toast", KEPT_FOR_LATER)
    return true
}

/**
 * POST /api/v1/anilist/list-entry: the entry as the app's sheet has it. Status, score, progress and both dates are
 * set; a date the request leaves out is taken away (recorded). Score and progress must be there, in AniList's words.
 */
export async function editListEntry(request: CoreRequest, environment: Environment): Promise<boolean> {
    const body = record(request.body)
    const reasons: string[] = []
    if (!wholeNumber(body.score)) reasons.push("The score raw must be an integer.")
    if (!wholeNumber(body.progress)) reasons.push("The progress must be an integer.")
    if (!wholeNumber(body.mediaId) || body.mediaId <= 0) reasons.push("The selected media id is invalid.")
    if (body.status !== undefined && body.status !== null && !STATUSES.includes(body.status as string)) reasons.push("The selected status is invalid.")
    if (reasons.length > 0) throw new CoreError(reasons.join(" "), 500)
    const fields: Fields = {
        ...(typeof body.status === "string" ? { status: body.status } : {}),
        score: body.score as number,
        progress: body.progress as number,
        startedAt: dateOf(body.startedAt),
        completedAt: dateOf(body.completedAt),
    }
    return change(environment, kindOf(body.type), body.mediaId as number, "save", fields, false)
}

/** DELETE /api/v1/anilist/list-entry */
export async function deleteListEntry(request: CoreRequest, environment: Environment): Promise<boolean> {
    const body = record(request.body)
    if (!wholeNumber(body.mediaId) || body.mediaId <= 0 || typeof body.type !== "string" || !body.type) throw new CoreError(MISSING_PARAMETERS, 500)
    const kind = kindOf(body.type)
    if (!(await storedEntry(await environment.database(), kind, body.mediaId))) throw new CoreError(ENTRY_NOT_FOUND, 500)
    return change(environment, kind, body.mediaId, "delete", {}, false)
}

/**
 * POST /api/v1/library/anime-entry/update-progress and /api/v1/manga/update-progress: an episode or chapter was marked.
 * The progress is set to it, up or down. The status follows (recorded): the last one completes the entry, a rewatch
 * stays a rewatch, everything else becomes "current"; a title not in the lists gets an entry.
 */
export function updateProgressOf(kind: ListKind) {
    return async (request: CoreRequest, environment: Environment): Promise<boolean> => {
        const body = record(request.body)
        const progress = kind === "ANIME" ? body.episodeNumber : body.chapterNumber
        const total = kind === "ANIME" ? body.totalEpisodes : body.totalChapters
        if (!wholeNumber(body.mediaId) || body.mediaId <= 0 || !wholeNumber(progress) || progress < 0) throw new CoreError(MISSING_PARAMETERS, 500)
        // incognito mode: only what the app writes by itself stops (`auto: true`: the player's 80 %, a playlist, the manga
        // reader's auto progress); a mark the user sets ("mark as watched", "+1", the list editor) goes through (settings/incognito.ts)
        if (body.auto === true && await incognitoOn(environment)) throw new CoreError(INCOGNITO_ERROR, 409)
        const current = await storedEntry(await environment.database(), kind, body.mediaId)
        const status = wholeNumber(total) && total > 0 && progress >= total ? "COMPLETED" : current?.status === "REPEATING" ? "REPEATING" : "CURRENT"
        return change(environment, kind, body.mediaId, "save", { status, progress }, true)
    }
}

/** POST /api/v1/library/anime-entry/update-repeat: how often the anime was watched again */
export async function updateRepeat(request: CoreRequest, environment: Environment): Promise<boolean> {
    const body = record(request.body)
    if (!wholeNumber(body.mediaId) || body.mediaId <= 0 || !wholeNumber(body.repeat) || body.repeat < 0) throw new CoreError(MISSING_PARAMETERS, 500)
    return change(environment, "ANIME", body.mediaId, "save", { repeat: body.repeat }, false)
}
