/**
 * One item of the list at random ("Random" on My lists), null for an empty list. `random` returns [0, 1) like
 * Math.random; with two or more items `previous` is not picked again, so a second tap always shows another title.
 */
export function pickRandom<T>(items: readonly T[], random: () => number = Math.random, previous?: T | null): T | null {
    const pool = items.length >= 2 && previous != null && items.includes(previous) ? items.filter(item => item !== previous) : items
    if (!pool.length) return null
    const at = Math.floor(random() * pool.length)
    return pool[Math.min(pool.length - 1, Math.max(0, at))]
}
