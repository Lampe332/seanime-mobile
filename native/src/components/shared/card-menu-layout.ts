/**
 * Where a card's long-press action sheet sits (`[data-phone-menu]`, mobile-surface.css + tablet.css): at most 32rem wide,
 * centred in its room. Phone: 1rem sides, .75rem above the bottom bar. Tablet with the rail: from the rail + 1rem to
 * 1rem before the right edge, 1rem above the bottom edge.
 */
export function cardMenuFrame(screenWidth: number, rail: { width: number } | null, bottomInset: number, barHeight: number) {
    const areaLeft = rail ? rail.width + 16 : 16
    const areaWidth = screenWidth - areaLeft - 16
    const width = Math.min(areaWidth, 512)
    return { left: areaLeft + (areaWidth - width) / 2, width, bottom: rail ? bottomInset + 16 : barHeight + bottomInset + 12 }
}
