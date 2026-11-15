import type { Translate } from "@/lib/app-language"

// geschrieben nach: Android's build-number taps (Settings → About phone: "You are now N steps away…"), own design

/*
 * The secret in Settings → About: ten taps on the version row. From the seventh tap a short notice counts down
 * ("3 more taps…"); a pause of more than two seconds starts the count again. The tenth tap lets sakura petals fall over
 * the page with a line in the middle, and the count starts over, so it works again.
 */

export const SECRET_TAPS = 10
export const HINT_FROM_TAP = 7
export const TAP_RESET_MS = 2000

export type TapState = { count: number, lastAt: number }
export const NO_TAPS: TapState = { count: 0, lastAt: 0 }

/** `remaining`: taps still needed, only from the seventh tap on (3, 2, 1); `secret`: this was the tenth tap. */
export type TapResult = { state: TapState, remaining: number | null, secret: boolean }

export function versionTap(state: TapState, now: number): TapResult {
    const counting = state.count > 0 && now - state.lastAt <= TAP_RESET_MS
    const count = (counting ? state.count : 0) + 1
    if (count >= SECRET_TAPS) return { state: NO_TAPS, remaining: null, secret: true }
    return { state: { count, lastAt: now }, remaining: count >= HINT_FROM_TAP ? SECRET_TAPS - count : null, secret: false }
}

export function tapHint(remaining: number, t: Translate): string {
    return remaining === 1 ? t("1 more tap…", "Noch 1 Tipp…") : t(`${remaining} more taps…`, `Noch ${remaining} Tipps…`)
}

export function secretMessage(t: Translate): string {
    return t("You found the secret – enjoy your next episode 🌸", "Geheimnis gefunden – viel Spaß bei der nächsten Folge 🌸")
}

/** How long the petals fall, the line included (ms); after it the layer goes. */
export const SAKURA_MS = 4800

/** Pinks that stay soft on the dark surfaces (#141416 and up). */
export const PETAL_COLORS = ["#ffd1e1", "#f9b4cc", "#f29bbb", "#ffc2d6"] as const

export type Petal = {
    /** left edge where it starts (dp) */
    x: number
    /** width (dp); the petal is a little taller than wide */
    size: number
    /** start and fall time (ms); delay + duration stays within SAKURA_MS */
    delay: number
    duration: number
    /** sideways drift over the whole fall and the sway around it (dp), with how many sways */
    drift: number
    sway: number
    turns: number
    /** start angle and the turn over the fall (deg) */
    rotate: number
    spin: number
    color: string
}

/** 25 petals on a phone, up to 40 on a wide tablet. */
export function petalCount(width: number): number {
    return Math.min(40, Math.max(25, Math.round(width / 32)))
}

/** The petals for a page `width` wide; `random` (0 ≤ r < 1) is Math.random in the app, a fixed sequence in tests. */
export function sakuraPetals(width: number, random: () => number = Math.random): Petal[] {
    const between = (min: number, max: number) => min + random() * (max - min)
    return Array.from({ length: petalCount(width) }, () => {
        const delay = Math.round(between(0, 1300))
        const duration = Math.round(between(2600, SAKURA_MS - 400 - delay))
        return {
            x: Math.round(between(-12, width - 4)),
            size: Math.round(between(9, 19)),
            delay,
            duration,
            drift: Math.round(between(-40, 70)),
            sway: Math.round(between(10, 32)),
            turns: Math.round(between(1, 2.6) * 10) / 10,
            rotate: Math.round(between(0, 360)),
            spin: Math.round(between(160, 520)) * (random() < 0.5 ? -1 : 1),
            color: PETAL_COLORS[Math.floor(random() * PETAL_COLORS.length)] ?? PETAL_COLORS[0],
        }
    })
}
