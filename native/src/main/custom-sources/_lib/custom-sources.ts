/* Choices of the custom sources screen (web custom-sources-phone.tsx) without the screen. */

/** The type the source can show: the asked one, else the other one it supports */
export function customSourceType(asked: "anime" | "manga", supportsAnime: boolean, supportsManga: boolean): "anime" | "manga" {
    if (asked === "anime" && !supportsAnime && supportsManga) return "manga"
    if (asked === "manga" && !supportsManga && supportsAnime) return "anime"
    return asked
}

/** The source from the link, else the one used last, else the first */
export function pickCustomSource(sources: { id: string }[], fromLink: string | undefined, last: string | null) {
    return sources.find(s => s.id === fromLink)?.id ?? sources.find(s => s.id === last)?.id ?? sources[0]?.id ?? null
}
