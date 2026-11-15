// geschrieben nach: docs/EIGENER-KERN.md §4m/§4n (Vergleich Kern gegen Server am Gerät, nur lesend), §4o Phase 4b-C2 (Manga-Downloads am Gerät) und dem Muster core-streams-check.ts; kein Server-Quelltext
import { takeLongestPieces } from "@/api/client/core-switch"
import { buildSeaQuery } from "@/api/client/requests"
import { mangaFolderName } from "@/core"
import { deviceLoader } from "@/api/client/core-download"
import { logger } from "@/lib/helpers/debug"
import { Directory, Paths } from "expo-file-system"
import { AppState } from "react-native"

/*
 * Test and scratch app only (link `core?manga=check&media=<id>&provider=<id>[&query=<words>]`): reads one manga through
 * the same door the hooks use, so that the area's switch decides who answers, and logs numbers only: the manga page
 * (whether it has the user's entry), the details (characters, recommendations), the mapping (set or not), the chapter
 * list (count, first and last index), the pages of the first chapter (count, whether headers came, how many pictures
 * would go through the server's picture proxy) and, with `query`, the manual search (count). Nothing is changed: no
 * mapping, no cache, no progress, no reader. Titles and addresses are not logged.
 */

const log = (text: string) => logger("CoreManga").info(text)

async function timed<T>(work: () => Promise<T>): Promise<{ value: T | null, error: string | null, ms: number }> {
    const started = Date.now()
    try {
        return { value: (await work()) ?? null, error: null, ms: Date.now() - started }
    }
    catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        return { value: null, error: text.replace(/https?:\/\/\S+/g, "<address>").slice(0, 160), ms: Date.now() - started }
    }
}

type Chapter = { id: string, index: number }
type Page = { index: number, headers?: Record<string, string> }

export async function runCoreMangaCheck(mediaId: number, provider: string, query: string): Promise<void> {
    const side = "core"
    takeLongestPieces(0)
    log(`check start, answered by: ${side}, provider ${provider}`)
    const entry = await timed(() => buildSeaQuery<{ media?: unknown, listData?: Record<string, unknown> }>({ endpoint: `/api/v1/manga/entry/${mediaId}`, method: "GET" }))
    log(`${side} entry: ${entry.error ?? `media ${entry.value?.media ? "yes" : "no"}, listData ${entry.value?.listData ? Object.keys(entry.value.listData).sort().join("/") : "none"}`} (${entry.ms} ms)`)
    const details = await timed(() => buildSeaQuery<{ characters?: { edges?: unknown[] }, recommendations?: { edges?: unknown[] } }>({ endpoint: `/api/v1/manga/entry/${mediaId}/details`, method: "GET" }))
    log(`${side} details: ${details.error ?? `characters ${details.value?.characters?.edges?.length ?? 0}, recommendations ${details.value?.recommendations?.edges?.length ?? 0}`} (${details.ms} ms)`)
    const mapping = await timed(() => buildSeaQuery<{ mangaId?: string | null }>({ endpoint: "/api/v1/manga/get-mapping", method: "POST", data: { provider, mediaId } }))
    log(`${side} mapping: ${mapping.error ?? (mapping.value?.mangaId ? "set" : "none")} (${mapping.ms} ms)`)
    const chapters = await timed(() => buildSeaQuery<{ chapters?: Chapter[] }>({ endpoint: "/api/v1/manga/chapters", method: "POST", data: { mediaId, provider } }))
    const list = chapters.value?.chapters ?? []
    log(`${side} chapters: ${chapters.error ?? `${list.length} chapters, index ${list[0]?.index ?? "-"}..${list[list.length - 1]?.index ?? "-"}`} (${chapters.ms} ms)`)
    if (list[0]) {
        const pages = await timed(() => buildSeaQuery<{ pages?: Page[], isDownloaded?: boolean }>({ endpoint: "/api/v1/manga/pages", method: "POST", data: { mediaId, provider, chapterId: list[0].id, doublePage: false } }))
        const found = pages.value?.pages ?? []
        const withHeaders = found.filter(page => page.headers && Object.keys(page.headers).length > 0).length
        log(`${side} pages of the first chapter: ${pages.error ?? `${found.length} pages, index ${found[0]?.index ?? "-"}..${found[found.length - 1]?.index ?? "-"}, headers ${withHeaders > 0 ? Object.keys(found.find(page => page.headers && Object.keys(page.headers).length > 0)!.headers!).join("/") : "none"}, through the picture proxy ${withHeaders}, downloaded ${pages.value?.isDownloaded === true ? "yes" : "no"}`} (${pages.ms} ms)`)
    }
    if (query !== "") {
        const found = await timed(() => buildSeaQuery<unknown[]>({ endpoint: "/api/v1/manga/search", method: "POST", data: { provider, query } }))
        log(`${side} search: ${found.error ?? `${found.value?.length ?? 0} results`} (${found.ms} ms)`)
    }
    // the longest piece of the screens' thread per request during the check, with its waits and sections
    for (const line of takeLongestPieces(8)) log(`longest piece: ${line}`)
    log("check done")
}

type Preference = { provider: string, filters?: Record<string, unknown> }

/**
 * Test and scratch app only (link `core?manga=write&media=<id>&provider=<id>`, phase 4a-2): writes through the same door
 * as the hooks and puts everything back at once: mapping set → read → removed → read (an earlier mapping is set again),
 * the cache of the manga emptied, the manga's chapter filters changed → read → set back; then the library (lists,
 * entries, latest chapter numbers). Numbers only, no titles, no addresses, no identifiers of entries.
 */
export async function runCoreMangaWriteCheck(mediaId: number, provider: string): Promise<void> {
    const side = "core"
    takeLongestPieces(0)
    log(`write check start, answered by: ${side}`)
    const mapping = (data: Record<string, unknown>, endpoint: string) => timed(() => buildSeaQuery<unknown>({ endpoint: `/api/v1/manga/${endpoint}`, method: "POST", data }))
    const before = await mapping({ provider, mediaId }, "get-mapping")
    const earlier = (before.value as { mangaId?: string | null } | null)?.mangaId ?? null
    const set = await mapping({ provider, mediaId, mangaId: "core-write-check" }, "manual-mapping")
    const afterSet = await mapping({ provider, mediaId }, "get-mapping")
    const removed = await mapping({ provider, mediaId }, "remove-mapping")
    const afterRemove = await mapping({ provider, mediaId }, "get-mapping")
    if (earlier) await mapping({ provider, mediaId, mangaId: earlier }, "manual-mapping")
    const mappingOf = (answer: { value: unknown, error: string | null }) => answer.error ?? ((answer.value as { mangaId?: string | null } | null)?.mangaId === "core-write-check" ? "the check's" : (answer.value as { mangaId?: string | null } | null)?.mangaId ? "other" : "none")
    log(`${side} mapping: before ${earlier ? "set" : "none"}, set ${set.error ?? String(set.value)} (${set.ms} ms) → ${mappingOf(afterSet)}, removed ${removed.error ?? String(removed.value)} (${removed.ms} ms) → ${mappingOf(afterRemove)}, earlier set again ${earlier ? "yes" : "not needed"}`)
    const emptied = await timed(() => buildSeaQuery<unknown>({ endpoint: "/api/v1/manga/entry/cache", method: "DELETE", data: { mediaId } }))
    log(`${side} cache emptied: ${emptied.error ?? String(emptied.value)} (${emptied.ms} ms)`)

    const read = () => timed(() => buildSeaQuery<{ entries?: Record<string, Preference> }>({ endpoint: "/api/v1/manga/preferences", method: "GET" }))
    const patch = (data: Preference) => timed(() => buildSeaQuery<Preference>({ endpoint: `/api/v1/manga/preferences/${mediaId}`, method: "PATCH", data }))
    const first = await read()
    const own = first.value?.entries?.[String(mediaId)]
    const probe = { provider: own?.provider ?? provider, filters: { [own?.provider ?? provider]: { language: "core-write-check" } } }
    const changed = await patch(probe)
    const changedRead = (await read()).value?.entries?.[String(mediaId)]
    const back = await patch({ provider: own?.provider ?? provider, filters: own?.filters ?? {} })
    const backRead = (await read()).value?.entries?.[String(mediaId)]
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    log(`${side} preferences: ${first.error ?? `${Object.keys(first.value?.entries ?? {}).length} entries`} (${first.ms} ms), manga ${own ? "had one" : "had none"}, changed ${changed.error ?? (same(changedRead?.filters, probe.filters) ? "read back" : "not read back")} (${changed.ms} ms), set back ${back.error ?? (same(backRead?.filters ?? {}, own?.filters ?? {}) && backRead?.provider === (own?.provider ?? provider) ? "read back" : "differs")} (${back.ms} ms)${own ? "" : ", entry stays with the given source (no way to remove one)"}`)

    const collection = await timed(() => buildSeaQuery<{ lists?: { status?: string, entries?: unknown[] }[] }>({ endpoint: "/api/v1/manga/collection", method: "GET" }))
    log(`${side} collection: ${collection.error ?? (collection.value?.lists ?? []).map(list => `${list.status} ${list.entries?.length ?? 0}`).join(", ")} (${collection.ms} ms)`)
    const latest = await timed(() => buildSeaQuery<Record<string, unknown[]>>({ endpoint: "/api/v1/manga/latest-chapter-numbers", method: "GET" }))
    log(`${side} latest chapter numbers: ${latest.error ?? `${Object.keys(latest.value ?? {}).length} manga, ${Object.values(latest.value ?? {}).reduce((sum, items) => sum + items.length, 0)} items`} (${latest.ms} ms)`)
    for (const line of takeLongestPieces(8)) log(`longest piece: ${line}`)
    log("write check done")
}

type QueueItem = { chapterId: string, status: string }
type PageAnswer = { pages?: { url: string }[], isDownloaded?: boolean }

const folderOf = (provider: string, mediaId: number, chapterId: string) => new Directory(Paths.document, "core-manga", mangaFolderName(provider), String(mediaId), mangaFolderName(chapterId))

/*
 * Test and scratch app only (link `core?manga=download&media=<id>&provider=<id>[&count=<n>]`): queues the first n
 * chapters of the provider's list through the same door the screens use (area manga on: the core's downloads), follows
 * the queue until it is empty, logs every end of a chapter the loader reports with whether the app was in front, then
 * reads each chapter's pages: count, isDownloaded, the address's scheme, files on disk. `core?manga=remove…` deletes
 * the saved chapters of that manga and provider again and checks that their folders are gone. Numbers only.
 */
export async function runCoreMangaDownloadCheck(mediaId: number, provider: string, count: number, remove: boolean): Promise<void> {
    const started = Date.now()
    takeLongestPieces(0)
    try {
        const data = await buildSeaQuery<{ downloaded: Record<string, { chapterId: string }[]> }>({ endpoint: "/api/v1/manga/download-data", method: "POST", data: { mediaId, cached: false } })
        const saved = (data?.downloaded?.[provider] ?? []).map(chapter => chapter.chapterId)
        if (remove) {
            await buildSeaQuery<boolean>({ endpoint: "/api/v1/manga/download-chapter", method: "DELETE", data: { downloadIds: saved.map(chapterId => ({ provider, mediaId, chapterId, chapterNumber: "" })) } })
            const left = saved.filter(chapterId => folderOf(provider, mediaId, chapterId).exists).length
            const list = await buildSeaQuery<unknown[]>({ endpoint: "/api/v1/manga/downloads", method: "GET" })
            return log(`remove: ${saved.length} chapters deleted, folders left ${left}, downloads list ${list?.length ?? 0} manga (${Date.now() - started} ms)`)
        }
        const chapters = (await buildSeaQuery<{ chapters?: Chapter[] }>({ endpoint: "/api/v1/manga/chapters", method: "POST", data: { mediaId, provider } }))?.chapters ?? []
        const wanted = chapters.slice(0, count).map(chapter => chapter.id)
        const loader = await deviceLoader()
        const unlisten = loader.listen(event => {
            if (event.id.startsWith("manga-") && event.type !== "progress") log(`loader ${event.type} ${event.id}${event.type === "done" ? ` ${event.bytes} bytes` : ` ${event.kind}`} (${Date.now() - started} ms, app ${AppState.currentState})`)
        })
        try {
            await buildSeaQuery<boolean>({ endpoint: "/api/v1/manga/download-chapters", method: "POST", data: { mediaId, provider, chapterIds: wanted, startNow: true } })
            log(`download: ${wanted.length} of ${chapters.length} chapters queued, ${saved.length} saved before`)
            let last = ""
            while (Date.now() - started < 10 * 60_000) {
                const queue = (await buildSeaQuery<QueueItem[]>({ endpoint: "/api/v1/manga/download-queue", method: "GET" })) ?? []
                const line = queue.map(item => item.status).join(",") || "empty"
                if (line !== last) log(`queue: ${line} (${Date.now() - started} ms, app ${AppState.currentState})`)
                last = line
                if (queue.length === 0 || queue.every(item => item.status === "errored")) break
                await new Promise(resolve => setTimeout(resolve, 1_000))
            }
        }
        finally {
            unlisten()
        }
        const list = await buildSeaQuery<{ mediaId: number, downloadData: Record<string, unknown[]> }[]>({ endpoint: "/api/v1/manga/downloads", method: "GET" })
        const entry = list?.find(item => item.mediaId === mediaId)
        log(`downloads list: ${list?.length ?? 0} manga, this one ${entry?.downloadData?.[provider]?.length ?? 0} chapters`)
        for (const chapterId of wanted) {
            const answer = await buildSeaQuery<PageAnswer>({ endpoint: "/api/v1/manga/pages", method: "POST", data: { mediaId, provider, chapterId, doublePage: false } })
            const pages = answer?.pages ?? []
            const folder = folderOf(provider, mediaId, chapterId)
            const files = folder.exists ? folder.list() : []
            const bytes = files.reduce((sum, item) => sum + ("size" in item && typeof item.size === "number" ? item.size : 0), 0)
            log(`chapter ${wanted.indexOf(chapterId) + 1}: ${pages.length} pages, isDownloaded ${answer?.isDownloaded}, scheme ${pages[0]?.url.split(":")[0] ?? "-"}://,${files.length} files ${bytes} bytes on disk`)
        }
        log(`longest pieces: ${takeLongestPieces(3).join("; ") || "none"}`)
    }
    catch (error) {
        log(`download check broke: ${(error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "<address>").slice(0, 160)}`)
    }
}
