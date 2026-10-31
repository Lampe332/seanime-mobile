/** Order and search helpers of the phone chapter list. The provider returns chapters oldest first. */

export type ChapterListOrder = "newest" | "oldest"

export function orderChapters<T>(chapters: readonly T[], order: ChapterListOrder): T[] {
    return order === "newest" ? chapters.toReversed() : chapters.slice()
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
