import type { Summary_ScanSummaryFile, Summary_ScanSummaryGroup, Summary_ScanSummaryItem } from "@/api/generated/types"
import type { Translate } from "@/lib/app-language"

/* Logic of the scan summaries screen (web scan-summaries-phone.tsx) without the screen. */

export type FileLevel = "error" | "warning" | undefined

/** The worst note the scanner left on a file */
export function levelOf(file: Summary_ScanSummaryFile): FileLevel {
    return file.logs?.some(log => log.level === "error") ? "error"
        : file.logs?.some(log => log.level === "warning") ? "warning" : undefined
}

/** A filename search (lower-case query; empty matches all) */
export function matchesQuery(file: Summary_ScanSummaryFile, query: string) {
    return !query || !!file.localFile?.path?.toLowerCase().includes(query)
}

/** Scans with a summary, newest first (web `.toReversed()`; Hermes has none, so a copy is reversed) */
export function newestScans(items: Summary_ScanSummaryItem[] | undefined) {
    return (items ?? []).filter(item => !!item.scanSummary?.id && !!item.createdAt).slice().reverse()
}

/** Anime with at least one matching file, by title with numbers in order (Season 2 before Season 10) */
export function visibleGroups(groups: Summary_ScanSummaryGroup[] | undefined, query: string) {
    return (groups ?? []).filter(group => group.files?.some(file => matchesQuery(file, query)))
        .sort((a, b) => a.mediaTitle.localeCompare(b.mediaTitle, undefined, { numeric: true }))
}

/** What the scanner read from the file name and its folders (title, episode, season, part, episode title) */
export function readFromName(file: Summary_ScanSummaryFile, t: Translate): [string, string][] {
    const lf = file.localFile
    const folders = lf?.parsedFolderInfo ?? []
    const join = (values: (string | undefined)[]) => values.filter(Boolean).join(" · ")
    return [
        [t("Title", "Titel"), join([lf?.parsedInfo?.title, ...folders.map(f => f.title)])],
        [t("Episode", "Folge"), lf?.parsedInfo?.episode ?? ""],
        [t("Season", "Staffel"), join([lf?.parsedInfo?.season, ...folders.map(f => f.season)])],
        [t("Part", "Teil"), join([lf?.parsedInfo?.part, ...folders.map(f => f.part)])],
        [t("Episode title", "Folgentitel"), lf?.parsedInfo?.episodeTitle ?? ""],
    ]
}

/** A scanner note, the crash of the scanner in words a user can act on */
export function logText(message: string, t: Translate) {
    return message.startsWith("PANIC") ? t("The scanner crashed on this file. Please report it on GitHub.", "Der Scanner ist an dieser Datei abgestürzt. Bitte melde das auf GitHub.") : message
}

export function plural(t: Translate, n: number, en: [string, string], de: [string, string]) {
    return `${n} ${n === 1 ? t(en[0], de[0]) : t(en[1], de[1])}`
}
