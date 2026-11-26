// geschrieben nach: der öffentlichen AniList-Doku (Page.media mit id_in, Studio.isAnimationStudio, Anfragen ohne Token); kein Server-Quelltext

import type { CoreEnvironment } from "../registry"
import { askAnilist, clientFor } from "./client"
import { MEDIA_STUDIOS } from "./queries"
import { type ListCollection, keepStudios } from "./store"

/*
 * The local account's lists hold no studios that tell an animation studio from a publisher (titles kept before the
 * lists asked for isAnimationStudio, or kept from the anime page). The yearly review counts only animation studios, so
 * the finished titles get them from AniList: public, without a token, up to 50 titles a question. Each title is asked
 * once a session at most, so that a list read offline or a title AniList knows no studio of does not ask again and again.
 * A failure leaves the lists as they are.
 */

type Json = Record<string, unknown>

/** AniList's most for one page */
const PER_QUESTION = 50
/** At most this many questions a list read; the rest follow with the next read */
const MOST_QUESTIONS = 4

const askedThisSession = new Set<number>()

/** A new session: every title may be asked again (the tests start each case this way) */
export function forgetStudioQuestions(): void {
    askedThisSession.clear()
}

/** A finished anime whose studios do not say which of them animated it */
function lacksStudios(entry: Json): number | null {
    if (entry.status !== "COMPLETED" && entry.status !== "REPEATING") return null
    const media = entry.media as Json | undefined
    if (typeof media?.id !== "number" || media.id <= 0) return null
    const nodes = (media.studios as { nodes?: unknown } | undefined)?.nodes
    const known = Array.isArray(nodes) && nodes.length > 0 && nodes.every(node => typeof (node as Json | null)?.isAnimationStudio === "boolean")
    return known ? null : media.id
}

/** The local account's anime lists with the studios of their finished titles, asked of AniList where missing */
export async function withStudios(environment: CoreEnvironment, collection: ListCollection, asked: Set<number> = askedThisSession): Promise<ListCollection> {
    const lists = collection.MediaListCollection.lists
    const missing = [...new Set(lists.flatMap(list => (list.entries ?? []).map(lacksStudios)))]
        .filter((id): id is number => id !== null && !asked.has(id))
        .slice(0, PER_QUESTION * MOST_QUESTIONS)
    if (missing.length === 0) return collection

    const found = new Map<number, unknown>()
    for (let start = 0; start < missing.length; start += PER_QUESTION) {
        const ids = missing.slice(start, start + PER_QUESTION)
        for (const id of ids) asked.add(id)
        try {
            const page = (await askAnilist(clientFor(environment), MEDIA_STUDIOS, { ids })).Page as { media?: unknown } | null | undefined
            for (const media of Array.isArray(page?.media) ? page.media as Json[] : []) {
                if (typeof media?.id === "number") found.set(media.id, media.studios ?? { nodes: [] })
            }
        }
        catch {
            // offline, refused or rate limited: the lists stay as they are, the rest is not asked this time either
            break
        }
    }
    if (found.size === 0) return collection

    try {
        await keepStudios(await environment.database(), found, environment.now())
    }
    catch {
        // not kept: shown this time all the same
    }
    return {
        MediaListCollection: {
            lists: lists.map(list => list.entries ? {
                ...list,
                entries: list.entries.map(entry => {
                    const media = entry.media as Json | undefined
                    const studios = typeof media?.id === "number" ? found.get(media.id) : undefined
                    return studios === undefined ? entry : { ...entry, media: { ...media, studios } }
                }),
            } : list),
        },
    }
}
