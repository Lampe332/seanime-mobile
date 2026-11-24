/*
 * What an anime or manga page shows of AniList's staff and tags (entry-credits.tsx): the few roles a reader looks for,
 * and the best-ranked tags with the spoilers apart. Pure, so the choice is tested (entry-credits.test.ts).
 */

export type CreditRole = "original" | "director" | "composition" | "characters" | "music" | "storyArt" | "story" | "art"
export type CreditPerson = { id: number, name: string }
/** One line: one role or several the same people share ("Story & art") */
export type CreditRow = { roles: CreditRole[], people: CreditPerson[] }
export type StaffEdgeInput = { role?: string | null, node?: { id?: number | null, name?: { full?: string | null } | null } | null } | null

const ANIME_ROLES: CreditRole[] = ["original", "director", "composition", "characters", "music"]
const MANGA_ROLES: CreditRole[] = ["storyArt", "story", "art", "original"]

const ROLE_NAMES: Record<string, CreditRole> = {
    "original creator": "original",
    "original story": "original",
    "original work": "original",
    "director": "director",
    "chief director": "director",
    "series director": "director",
    "series composition": "composition",
    "character design": "characters",
    "original character design": "characters",
    "music": "music",
    "story & art": "storyArt",
    "story": "story",
    "art": "art",
}

/** "Director (eps 1-12)" is a director; "Art (assistant)" is no author */
export function creditRole(role: string | null | undefined, kind: "anime" | "manga"): CreditRole | null {
    if (!role) return null
    const note = /\(([^)]*)\)\s*$/.exec(role)?.[1] ?? ""
    if (/assist/i.test(note)) return null
    const found = ROLE_NAMES[role.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase()]
    return found && (kind === "anime" ? ANIME_ROLES : MANGA_ROLES).includes(found) ? found : null
}

/** At most `max` lines in the page's order; a role keeps up to three people; people sharing all roles share a line */
export function pickCredits(edges: readonly StaffEdgeInput[] | null | undefined, kind: "anime" | "manga", max = 5): CreditRow[] {
    const byRole = new Map<CreditRole, CreditPerson[]>()
    for (const edge of edges ?? []) {
        const role = creditRole(edge?.role, kind)
        const id = edge?.node?.id
        const name = edge?.node?.name?.full?.trim()
        if (!role || !id || !name) continue
        const people = byRole.get(role) ?? []
        if (!people.some(person => person.id === id) && people.length < 3) people.push({ id, name })
        byRole.set(role, people)
    }
    const rows: CreditRow[] = []
    for (const role of kind === "anime" ? ANIME_ROLES : MANGA_ROLES) {
        const people = byRole.get(role)
        if (!people?.length) continue
        const same = rows.find(row => row.people.length === people.length && row.people.every((person, i) => person.id === people[i].id))
        if (same) same.roles.push(role)
        else rows.push({ roles: [role], people })
    }
    return rows.slice(0, max)
}

export type TagInput = { name?: string | null, rank?: number | null, isMediaSpoiler?: boolean | null, isGeneralSpoiler?: boolean | null } | null
export type EntryTag = { name: string, rank: number }

/** The best-ranked tags (at most `max`) and, apart, the best spoiler tags (at most 4), each by rank */
export function pickTags(tags: readonly TagInput[] | null | undefined, max = 8): { tags: EntryTag[], spoilers: EntryTag[] } {
    const seen = new Set<string>()
    const ranked = (tags ?? []).flatMap(tag => {
        const name = tag?.name?.trim()
        if (!name || seen.has(name)) return []
        seen.add(name)
        return [{ name, rank: tag?.rank ?? 0, spoiler: !!tag?.isMediaSpoiler || !!tag?.isGeneralSpoiler }]
    }).sort((a, b) => b.rank - a.rank)
    const plain = (spoiler: boolean, count: number) => ranked.filter(tag => tag.spoiler === spoiler).slice(0, count).map(({ name, rank }) => ({ name, rank }))
    return { tags: plain(false, max), spoilers: plain(true, 4) }
}

/**
 * Whether the role goes on its own line above the names: the side column (112 px) holds "Serienkomposition" or
 * "Charakterdesign" in one piece only at the normal text size on a phone of usual width.
 */
export function creditRoleAbove(fontScale: number, width: number): boolean {
    return fontScale >= 1.2 || width < 360
}
