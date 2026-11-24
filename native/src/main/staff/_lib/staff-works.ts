import type { AL_BaseAnime } from "@/api/generated/types"

/*
 * A person's titles (staff-phone.tsx): AniList sends one edge per role, so a title with two roles comes twice. Here each
 * title is one item with its roles, in AniList's order (most popular first), split into anime and manga.
 */

export type StaffWorkInput = { staffRole?: string | null, node?: (AL_BaseAnime & { chapters?: number }) | null } | null
export type StaffWork = { media: AL_BaseAnime, roles: string[] }

export function staffWorks(edges: readonly StaffWorkInput[] | null | undefined, adultAllowed: boolean): { anime: StaffWork[], manga: StaffWork[] } {
    const byId = new Map<number, StaffWork & { kind: "anime" | "manga" }>()
    for (const edge of edges ?? []) {
        const media = edge?.node
        if (!media?.id || (media.isAdult && !adultAllowed)) continue
        const work = byId.get(media.id) ?? { media, roles: [], kind: media.type === "MANGA" ? "manga" as const : "anime" as const }
        const role = edge?.staffRole?.trim()
        if (role && !work.roles.includes(role)) work.roles.push(role)
        byId.set(media.id, work)
    }
    const all = [...byId.values()]
    const plain = (kind: "anime" | "manga") => all.filter(work => work.kind === kind).map(({ media, roles }) => ({ media, roles }))
    return { anime: plain("anime"), manga: plain("manga") }
}
