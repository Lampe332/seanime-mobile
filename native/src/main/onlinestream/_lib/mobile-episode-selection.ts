// Session-only state: returning to a series keeps its selected episode without
// writing progress or overriding a deliberate Home continuation URL.
const selectedEpisodes = new Map<number, number>()
export function rememberMobileEpisode(mediaId: number, episode: number) {
    selectedEpisodes.set(mediaId, episode)
}
/**
 * Previous/next of the online page and player: the nearest episode the provider has, below or above the current one, so a
 * gap in the numbering (1, 2, 4 or a 12.5) is stepped over instead of ending at ±1; null when there is none.
 */
export function neighbourEpisode(numbers: number[], current: number | null, which: "next" | "previous"): number | null {
    if (current === null) return null
    let found: number | null = null
    for (const n of numbers) {
        if (which === "next" ? n > current && (found === null || n < found) : n < current && (found === null || n > found)) found = n
    }
    return found
}

export function getMobileInitialEpisode(mediaId: number, numbers: number[], progress: number, urlEpisode?: number) {
    return [urlEpisode, selectedEpisodes.get(mediaId), progress + 1, numbers[0]].find(n => n !== undefined && numbers.includes(n))
}
