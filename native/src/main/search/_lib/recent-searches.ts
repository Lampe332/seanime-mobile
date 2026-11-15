// geschrieben nach: Befund #9 des Komfort-Scans (15.11.2026, search-phone.tsx: Suchtext nur in useState); eigene Regeln, kein Server-Quelltext

/*
 * The last searches of the search screen (search-phone.tsx), shown as chips under the field while it is empty. One list
 * for anime and manga: a title is often looked up as both. Newest first; the same words (any case) are kept once.
 */

export const RECENT_SEARCHES_MAX = 8

/** The list with `term` in front; empty words leave it as it is */
export function withRecentSearch(list: string[], term: string, max = RECENT_SEARCHES_MAX): string[] {
    const words = term.trim().replace(/\s+/g, " ")
    if (!words) return list
    const key = words.toLocaleLowerCase()
    if (list[0] === words) return list
    return [words, ...list.filter(item => item.toLocaleLowerCase() !== key)].slice(0, max)
}

/** The list without `term` */
export function withoutRecentSearch(list: string[], term: string): string[] {
    return list.includes(term) ? list.filter(item => item !== term) : list
}
