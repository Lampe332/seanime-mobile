/*
 * Where every page's first block starts (Nick 10.11.: no empty area above the head, on purpose unlike 2.0.32): right under
 * what the top really needs – the safe-area inset (camera cutout, or the status bar while Android shows it) – plus one
 * small gap that is the same on every page, phone and tablet. No room is kept for a navbar, a plugin tray or a strip; the
 * head's own row (48dp icons) adds its breathing room under the cutout. Never less than the inset, so no head starts
 * under the camera.
 */
export const PAGE_TOP_GAP = 4

export function pageTop(insetTop: number): number {
    return (Number.isFinite(insetTop) && insetTop > 0 ? insetTop : 0) + PAGE_TOP_GAP
}
