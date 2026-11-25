/** Pure helpers of the "Your year" page (wrapped-phone.tsx); the numbers themselves come from lists/_lib/wrapped.ts. */

/** The shown year: the chosen one while it still has data, else the newest year with data (null: none) */
export function pickYear(years: number[], chosen: number | null): number | null {
    if (chosen !== null && years.includes(chosen)) return chosen
    return years[0] ?? null
}

/** Days are added from this many hours on; below that the hours say enough */
export const DAYS_FROM_HOURS = 48

/** Estimated watch time as whole hours, plus days (one decimal) from 48 hours on */
export function watchTime(minutes: number): { hours: number, days: number | null } {
    const hours = Math.round(Math.max(0, minutes) / 60)
    return { hours, days: hours >= DAYS_FROM_HOURS ? Math.round(minutes / 144) / 10 : null }
}

/** Height of each month's bar next to the busiest one (0..1); all 0 in a year without dated months */
export function monthRatios(months: number[]): number[] {
    const most = Math.max(0, ...months)
    return months.map(count => (most > 0 ? count / most : 0))
}

/** Bar width of a count: its share of the year's titles next to the largest share, so the top row fills the bar */
export function shareRatios(shares: number[]): number[] {
    const most = Math.max(0, ...shares)
    return shares.map(share => (most > 0 ? share / most : 0))
}

/** Cards dealt into columns left to right, so both columns start with the most important ones */
export function intoColumns<T>(items: T[], columns: number): T[][] {
    const count = Math.max(1, Math.floor(columns))
    const out: T[][] = Array.from({ length: count }, () => [])
    items.forEach((item, index) => out[index % count].push(item))
    return out
}

/** A date "YYYY-MM-DD" as a local Date (no time zone shift), or null */
export function parseDay(iso: string | undefined): Date | null {
    const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null
    if (!match) return null
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}
