// geschrieben nach: docs/EIGENER-KERN.md §4o (Phase 4c-2: alte Manga-Kapitel des Servers), Form der Ablage am Gerät beobachtet (Ordner `files/manga/<Anbieter>_<mediaId>_<Kapitel-ID>_<Kapitel-Nummer>/` mit `registry.json` und Seiten-Dateien); kein Server-Quelltext

/** The server's folder of saved chapters under the app's files (its setting `manga.downloaddir`, seen on the device) */
export const OLD_MANGA_FOLDER = "manga"

/** One folder of the server's saved chapters as the device read it: its name, the names of its files, the text of its registry */
export type OldChapterFolder = { folder: string, files: string[], registry: string | null }

/** A chapter the server saved completely, in the core's words; `folder` is the folder's name under the server's manga folder */
export type OldChapter = {
    provider: string
    mediaId: number
    chapterId: string
    chapterNumber: string
    folder: string
    pages: { index: number, file: string }[]
}

const SAFE = /^[A-Za-z0-9._-]+$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * `<provider>_<mediaId>_<chapterId>_<chapterNumber>`: the provider is everything before the first `_<digits>_`, the
 * number everything after the last `_`, the chapter's id what lies between (it may hold `_` itself).
 */
export function oldFolderParts(folder: string): Omit<OldChapter, "folder" | "pages"> | null {
    const match = /^(.+?)_(\d+)_(.+)_([^_]+)$/.exec(folder)
    if (!match) return null
    const mediaId = Number(match[2])
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0) return null
    return { provider: match[1], mediaId, chapterId: match[3], chapterNumber: match[4] }
}

/**
 * The pages of one folder from its registry (`{ "<index>": { index, filename, … } }`); null when the registry is
 * missing or unreadable, a page's file is not there or its name is not safe: such a chapter stays with the server
 * (the registry is written when the chapter is complete, a folder without it is still on its way).
 */
function pagesOf(entry: OldChapterFolder): OldChapter["pages"] | null {
    if (entry.registry === null) return null
    let registry: unknown
    try {
        registry = JSON.parse(entry.registry)
    }
    catch {
        return null
    }
    if (!isRecord(registry)) return null
    const files = new Set(entry.files)
    const pages: OldChapter["pages"] = []
    for (const page of Object.values(registry)) {
        if (!isRecord(page) || typeof page.filename !== "string" || typeof page.index !== "number" || !Number.isInteger(page.index)) return null
        if (!SAFE.test(page.filename) || !files.has(page.filename)) return null
        pages.push({ index: page.index, file: page.filename })
    }
    if (pages.length === 0) return null
    return pages.sort((a, b) => a.index - b.index)
}

/** The server's complete chapters among its folders, and how many folders stay with it */
export function oldChapters(folders: OldChapterFolder[]): { chapters: OldChapter[], left: number } {
    const chapters: OldChapter[] = []
    let left = 0
    for (const entry of folders) {
        const parts = SAFE.test(entry.folder) ? oldFolderParts(entry.folder) : null
        const pages = parts ? pagesOf(entry) : null
        if (!parts || !pages) {
            left++
            continue
        }
        chapters.push({ ...parts, folder: entry.folder, pages })
    }
    return { chapters, left }
}

/** The chapter as a provider's list would give it (Manga_ChapterDetails); the folder knows only id and number */
export function oldChapterDetails(chapter: OldChapter): Record<string, unknown> {
    const number = Number.parseFloat(chapter.chapterNumber)
    return {
        provider: chapter.provider,
        id: chapter.chapterId,
        url: "",
        title: `Chapter ${chapter.chapterNumber}`,
        chapter: chapter.chapterNumber,
        index: Number.isFinite(number) ? number : 0,
    }
}
