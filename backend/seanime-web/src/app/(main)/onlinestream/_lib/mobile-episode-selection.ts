// Session-only state: returning to a series keeps its selected episode without
// writing progress or overriding a deliberate Home continuation URL.
const selectedEpisodes = new Map<number, number>()
export function rememberMobileEpisode(mediaId: number, episode: number) {
    selectedEpisodes.set(mediaId, episode)
}
export function getMobileInitialEpisode(mediaId: number, numbers: number[], progress: number, urlEpisode?: number) {
    return [urlEpisode, selectedEpisodes.get(mediaId), progress + 1, numbers[0]].find(n => n !== undefined && numbers.includes(n))
}
