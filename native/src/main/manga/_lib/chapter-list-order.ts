/** Order and search helpers of the phone chapter list. The provider returns chapters oldest first. */

export type ChapterListOrder = "newest" | "oldest"

/**
 * Each view remembers its own order under the web app's keys: All starts with the newest chapter, Unread with the next one
 * to read (oldest first), so a changed All order never turns the reading queue around.
 */
export const CHAPTER_ORDER_STORAGE = {
    all: { key: "sea-manga-chapter-list-order", initial: "newest" },
    unread: { key: "sea-manga-unread-chapter-list-order", initial: "oldest" },
} as const satisfies Record<string, { key: string, initial: ChapterListOrder }>

/**
 * Whether a chapter is unread (chapter-list.tsx retainUnreadChapters): without a list entry, a progress or a known
 * number every chapter counts as unread, else those after the progress.
 */
export function isChapterUnread(chapterNumber: number | undefined, progress: number | null | undefined) {
    if (!progress || chapterNumber === undefined) return true
    return !!chapterNumber && chapterNumber > progress
}

export function orderChapters<T>(chapters: readonly T[], order: ChapterListOrder): T[] {
    return order === "newest" ? chapters.slice().reverse() /* Hermes has no toReversed */ : chapters.slice()
}

/** The number typed into "Go to chapter" (also 12,5 or Ch. 12). Null when there is no number. */
export function parseChapterQuery(text: string): number | null {
    const match = text.replace(",", ".").match(/\d+(\.\d+)?/)
    if (!match) return null
    const value = parseFloat(match[0])
    return Number.isFinite(value) ? value : null
}

/** The chapter number as a float ("12.5" -> 12.5); null when the label has no number. */
export function chapterLabelNumber(label: string): number | null {
    return parseChapterQuery(label)
}

/** Index of the chapter with exactly this number in the (ordered) list, or -1. The first match wins when sources repeat a number. */
export function findChapterIndex<T extends { chapter: string }>(chapters: readonly T[], target: number): number {
    return chapters.findIndex(chapter => chapterLabelNumber(chapter.chapter) === target)
}

/** How many rows the list must show to include the row at `index` when it grows in steps of `pageSize`. */
export function visibleCountFor(index: number, pageSize: number, current: number) {
    if (index < 0) return current
    return Math.max(current, (Math.floor(index / pageSize) + 1) * pageSize)
}
