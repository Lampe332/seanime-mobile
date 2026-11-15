// geschrieben nach: dem Vertrag onlinestream-provider.d.ts (SearchResult, Media, SearchOptions), den Aufzeichnungen OnlinestreamManualSearch/GetOnlineStreamEpisodeList (welcher Eintrag gewählt wurde) und docs/EIGENER-KERN.md §4m; eigene Auswahl, kein Server-Quelltext

/*
 * Which of a provider's search results is the anime (§4m). The provider only gives a title, an address and sub/dub;
 * the anime gives its titles (romaji, English, synonyms), its year and how many episodes it has. Rules, in order:
 *
 * 1. Results of the wrong language kind are dropped (dub wanted: "sub" goes; sub wanted: "dub" goes), unless nothing
 *    else is left.
 * 2. Each result gets the best likeness of its title to any of the anime's titles (synonyms count a little less).
 *    Likeness: the same after cleaning (case, accents, punctuation, "season 2" = "2nd season" = "2") is 1, otherwise
 *    the share of letter pairs both have (Dice).
 * 3. A number in the result's title the anime's titles do not have (a sequel: "2", "Season 3", a year that is not the
 *    anime's) takes 0.4 off; a year that is the anime's adds 0.05.
 * 4. The best result with at least 0.6 wins; on a tie the earlier one (providers list their best match first).
 */

export type SubOrDub = "sub" | "dub" | "both"

/** A search result as the contract declares it */
export type Found = { id: string, title: string, url: string, subOrDub: SubOrDub }

/** The anime as the contract's `Media` declares it */
export type StreamMedia = {
    id: number
    idMal?: number
    status?: string
    format?: string
    englishTitle?: string
    romajiTitle?: string
    episodeCount?: number
    absoluteSeasonOffset?: number
    synonyms: string[]
    isAdult: boolean
    startDate?: { year: number, month?: number, day?: number }
}

/** Below this likeness no result is taken: the user then chooses by hand */
export const LEAST_LIKENESS = 0.6

const ORDINAL = /\b(\d+)(?:st|nd|rd|th)\s+season\b/g
const SEASON = /\bseason\s+(\d+)\b/g
const PART = /\bpart\s+(\d+)\b/g

/** A title without what does not tell titles apart */
export function cleanTitle(title: string): string {
    return title
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(ORDINAL, "$1")
        .replace(SEASON, "$1")
        .replace(PART, "$1")
        .replace(/\s+/g, " ")
        .trim()
}

function pairsOf(text: string): Map<string, number> {
    const pairs = new Map<string, number>()
    const letters = text.replace(/ /g, "")
    for (let index = 0; index < letters.length - 1; index++) {
        const pair = letters.slice(index, index + 2)
        pairs.set(pair, (pairs.get(pair) ?? 0) + 1)
    }
    return pairs
}

/** 1 for the same title after cleaning, otherwise the share of shared letter pairs (0 to 1) */
export function likeness(a: string, b: string): number {
    const left = cleanTitle(a)
    const right = cleanTitle(b)
    if (left === "" || right === "") return 0
    if (left === right) return 1
    const leftPairs = pairsOf(left)
    const rightPairs = pairsOf(right)
    let shared = 0
    let total = 0
    for (const count of leftPairs.values()) total += count
    for (const count of rightPairs.values()) total += count
    for (const [pair, count] of leftPairs) shared += Math.min(count, rightPairs.get(pair) ?? 0)
    return total === 0 ? 0 : (2 * shared) / total
}

function numbersIn(title: string): string[] {
    return cleanTitle(title).match(/\b\d+\b/g) ?? []
}

/** The anime's titles, the main ones first */
export function titlesOf(media: StreamMedia): { title: string, weight: number }[] {
    const main = [media.romajiTitle, media.englishTitle].filter((title): title is string => !!title && title.trim() !== "")
    const synonyms = media.synonyms.filter(title => title.trim() !== "" && !main.includes(title))
    return [...main.map(title => ({ title, weight: 1 })), ...synonyms.map(title => ({ title, weight: 0.95 }))]
}

/** How well one result fits the anime (rules 2 and 3) */
export function scoreOf(media: StreamMedia, found: Found): number {
    const titles = titlesOf(media)
    let best = 0
    for (const { title, weight } of titles) best = Math.max(best, likeness(found.title, title) * weight)
    const known = new Set(titles.flatMap(({ title }) => numbersIn(title)))
    const year = media.startDate?.year
    for (const number of numbersIn(found.title)) {
        if (known.has(number)) continue
        if (year !== undefined && number === String(year)) best += 0.05
        else best -= 0.4
    }
    return best
}

/** The result that is the anime, or null when none fits well enough (rules 1 to 4) */
export function chooseEntry(media: StreamMedia, results: Found[], dub: boolean): Found | null {
    const wrongKind: SubOrDub = dub ? "sub" : "dub"
    const fitting = results.filter(result => result.subOrDub !== wrongKind)
    const candidates = fitting.length > 0 ? fitting : results
    let chosen: Found | null = null
    let chosenScore = LEAST_LIKENESS
    for (const result of candidates) {
        const score = scoreOf(media, result)
        if (score > chosenScore || (chosen === null && score >= chosenScore)) {
            chosen = result
            chosenScore = score
        }
    }
    return chosen
}
