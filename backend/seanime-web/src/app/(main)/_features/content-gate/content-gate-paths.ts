/**
 * Pages that stay usable while no content source exists (no AniList token, no extension).
 * Everything else would show AniList anime/manga and is replaced by the content gate hint.
 */
export const CONTENT_GATE_ALLOWED_PATHS = [
    "/settings",
    "/extensions",
    "/auth",
    "/android-downloads",
    "/sync",
]

export function isContentGateAllowedPath(pathname: string) {
    return CONTENT_GATE_ALLOWED_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"))
}
