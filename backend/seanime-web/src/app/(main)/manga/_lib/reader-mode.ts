import { MangaReadingMode } from "@/app/(main)/manga/_lib/manga-chapter-reader.atoms"

/** Reading mode value of the tablet option: double page when the window is wide landscape, else single page. Never part of MangaReadingMode (the "m" key cycles those). */
export const MANGA_READING_MODE_AUTO = "auto"

/** Window width from which a landscape window has room for two pages. */
export const AUTO_DOUBLE_PAGE_MIN_WIDTH = 700

/** The mode the reader lays out for the chosen one; "auto" follows the current window size. */
export function resolveReadingMode(mode: string, viewport: { width: number, height: number }) {
    if (mode !== MANGA_READING_MODE_AUTO) return mode
    return viewport.width > viewport.height && viewport.width >= AUTO_DOUBLE_PAGE_MIN_WIDTH
        ? MangaReadingMode.DOUBLE_PAGE
        : MangaReadingMode.PAGED
}

/** Whether opening the reader turns the phone to landscape: only for an explicit double page choice on a phone. */
export function shouldForceLandscape(mode: string, isTablet: boolean) {
    return !isTablet && mode === MangaReadingMode.DOUBLE_PAGE
}
