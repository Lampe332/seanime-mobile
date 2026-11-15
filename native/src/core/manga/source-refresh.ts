// geschrieben nach: den generierten Typen Manga_MangaSourceRefreshJob/-Result/-Issue/-Mode (src/api/generated/types.ts), App-Code src/api/hooks/manga.hooks.ts, src/main/manga/_components/manga-source-refresh-sheet.tsx, chapter-list.tsx und _lib/manga-preferences-sync.tsx (Ereignis "manga-source-refresh-job-updated") und docs/EIGENER-KERN.md §4r (Phase 7f); eigene Regel, kein Server-Quelltext
import { mangaPreferences } from "../database/schema"
import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import type { StreamEnvironment } from "../streams/onlinestream"
import { chapterListOf, forgetMangaCache, mangaEntry } from "./manga"
import { NOT_WITHOUT_THE_SERVER } from "../removed/removed"

/*
 * The manga source refresh without the server (phase 7f), an own simple rule: for each manga with a chosen source the
 * core forgets what it kept and asks that source for the chapter list again, which also keeps the latest chapter number
 * for the library (library.ts). Only the mode "refresh_selected" is built; finding or replacing sources follows rules
 * no recording names, so those modes say they are not available without the server. With the server it is its job.
 */

type Json = Record<string, unknown>

type Issue = { mediaId: number, title: string, kind: string, providers?: string[] }

type Job = {
    id: string
    mode: string
    status: "running" | "stopping" | "completed" | "cancelled" | "failed"
    stage: "refreshing" | "discovering" | "done"
    current: number
    total: number
    result: { refreshed: number, found: number, replaced: number, notFound: number, failed: number, changes: Json[], issues: Issue[] }
    error?: string
}

const JOB_UPDATED = "manga-source-refresh-job-updated"

let job: Job | null = null
let jobs = 0

function told(): Job | null {
    if (job) emitCoreEvent(JOB_UPDATED, job)
    return job
}

/** GET /api/v1/manga/source-refresh: the last job, or null */
export async function sourceRefreshJob(): Promise<Job | null> {
    return job
}

async function titleOf(environment: StreamEnvironment, mediaId: number): Promise<string> {
    try {
        const entry = await mangaEntry(environment, { path: { id: String(mediaId) }, query: {}, body: undefined })
        const title = (entry.media as { title?: { userPreferred?: string } } | undefined)?.title?.userPreferred
        return title || String(mediaId)
    }
    catch {
        return String(mediaId)
    }
}

async function run(environment: StreamEnvironment, running: Job, chosen: { mediaId: number, provider: string }[]): Promise<void> {
    for (const { mediaId, provider } of chosen) {
        if (running.status === "stopping") break
        forgetMangaCache(mediaId)
        try {
            const chapters = await chapterListOf(environment, provider, mediaId)
            if (chapters.length > 0) running.result.refreshed++
            else {
                running.result.notFound++
                running.result.issues.push({ mediaId, title: await titleOf(environment, mediaId), kind: "no_chapters", providers: [provider] })
            }
        }
        catch {
            running.result.failed++
            running.result.issues.push({ mediaId, title: await titleOf(environment, mediaId), kind: "provider_error", providers: [provider] })
        }
        running.current++
        if (job === running) told()
    }
    running.status = running.status === "stopping" ? "cancelled" : "completed"
    running.stage = "done"
    if (job === running) told()
}

/** POST /api/v1/manga/source-refresh `{ mode, mediaIds? }`: starts the job and answers it as it starts */
export async function startSourceRefresh(environment: StreamEnvironment, body: unknown): Promise<Job> {
    const request = typeof body === "object" && body !== null ? body as Json : {}
    const mode = typeof request.mode === "string" ? request.mode : "refresh_selected"
    if (mode !== "refresh_selected") throw new CoreError(`Finding other manga sources is ${NOT_WITHOUT_THE_SERVER}`, 503)
    if (job && (job.status === "running" || job.status === "stopping")) throw new CoreError("a source refresh is already running", 409)
    const wanted = Array.isArray(request.mediaIds) ? new Set(request.mediaIds.map(Number).filter(id => Number.isInteger(id) && id > 0)) : null
    const database = await environment.core.database()
    const rows = await database.select().from(mangaPreferences)
    const chosen = rows
        .filter(row => row.provider !== "" && (!wanted || wanted.has(row.mediaId)))
        .sort((a, b) => a.mediaId - b.mediaId)
        .map(row => ({ mediaId: row.mediaId, provider: row.provider }))
    jobs++
    const running: Job = {
        id: `core-${environment.core.now()}-${jobs}`,
        mode,
        status: "running",
        stage: "refreshing",
        current: 0,
        total: chosen.length,
        result: { refreshed: 0, found: 0, replaced: 0, notFound: 0, failed: 0, changes: [], issues: [] },
    }
    job = running
    const answer = JSON.parse(JSON.stringify(running)) as Job
    void run(environment, running, chosen).catch(error => {
        running.status = "failed"
        running.stage = "done"
        running.error = error instanceof Error ? error.message : String(error)
        if (job === running) told()
    })
    return answer
}

/** DELETE /api/v1/manga/source-refresh: a running job stops after the manga it is at; an ended one is forgotten */
export async function stopSourceRefresh(): Promise<Job | null> {
    if (job && job.status === "running") {
        job.status = "stopping"
        return told()
    }
    if (job && job.status === "stopping") return job
    job = null
    return null
}

/** For the tests: forget the job */
export function forgetSourceRefresh(): void {
    job = null
}
