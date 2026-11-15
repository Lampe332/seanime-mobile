// geschrieben nach: Aufzeichnung api vom 13.11.2026 (ANILIST.AnilistListMissedSequels: Felder und Arten der Antwort, welche Arten und Zustände die Titel haben), dem App-Code home-screen.tsx und discover-phone.tsx (Liste „verpasste Fortsetzungen“) und der öffentlichen AniList-Doku (Media.relations, MediaRelation); kein Server-Quelltext

import { readThrough } from "./anilist"
import { askAnilist, clientFor } from "./client"
import { RELATED_ANIME } from "./queries"
import { keepAnswer, storedAnswer, storedCollection, withoutEmpty } from "./store"
import type { CoreEnvironment, CoreRequest } from "../registry"

/*
 * GET /api/v1/anilist/list-missed-sequels (area `anilist`, phase 5a-3, docs/EIGENER-KERN.md §4p). Own rule: the sequels
 * (AniList's relation `SEQUEL`) of the anime the user completed that are in none of the user's lists and are out or
 * airing (not "not yet released", not cancelled), each once, the newest (start date) first, at most ten. The relations are
 * asked of AniList 25 anime at a time (a page of 50 held the screens' thread 12 ms while read); the answer is kept and given when AniList fails.
 */

type Json = Record<string, unknown>

const QUESTION = "missed-sequels"
const MOST = 10

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function missedSequels(_request: CoreRequest, environment: CoreEnvironment): Promise<Json[]> {
    const database = await environment.database()
    const lists = await storedCollection(database, "ANIME")
    const inLists = new Set<number>()
    const completed: number[] = []
    for (const list of lists?.MediaListCollection.lists ?? []) {
        for (const entry of list.entries ?? []) {
            const id = isRecord(entry.media) ? entry.media.id : undefined
            if (typeof id !== "number") continue
            inLists.add(id)
            if (entry.status === "COMPLETED" && !completed.includes(id)) completed.push(id)
        }
    }
    return readThrough<Json[]>(
        environment,
        async () => {
            const related = new Map<number, Json[]>()
            for (let start = 0; start < completed.length; start += 25) {
                let page = 1
                for (;;) {
                    const data = await askAnilist(clientFor(environment), RELATED_ANIME, { ids: completed.slice(start, start + 25), page })
                    const pageData = isRecord(data.Page) ? data.Page : {}
                    for (const item of (Array.isArray(pageData.media) ? pageData.media : []) as Json[]) {
                        const edges = isRecord(item.relations) && Array.isArray(item.relations.edges) ? item.relations.edges as Json[] : []
                        related.set(item.id as number, edges.filter(edge => edge.relationType === "SEQUEL" && isRecord(edge.node)).map(edge => edge.node as Json))
                    }
                    await environment.pause("missed sequels")
                    if (!(isRecord(pageData.pageInfo) && pageData.pageInfo.hasNextPage === true)) break
                    page++
                }
            }
            const found: Json[] = []
            const taken = new Set<number>()
            for (const id of completed) {
                for (const node of related.get(id) ?? []) {
                    const nodeId = node.id as number
                    if (node.type !== "ANIME" || inLists.has(nodeId) || taken.has(nodeId)) continue
                    if (node.status !== "FINISHED" && node.status !== "RELEASING") continue
                    taken.add(nodeId)
                    found.push(withoutEmpty(node) as Json)
                }
            }
            // the newest first, ten of them (as the server answered on the device: sorted by start, 10)
            const start = (item: Json) => {
                const date = isRecord(item.startDate) ? item.startDate : {}
                return (Number(date.year) || 0) * 10000 + (Number(date.month) || 0) * 100 + (Number(date.day) || 0)
            }
            return found.sort((a, b) => start(b) - start(a)).slice(0, MOST)
        },
        answer => keepAnswer(database, QUESTION, answer, environment.now()),
        async () => (await storedAnswer(database, QUESTION)) as Json[] | null,
    )
}
