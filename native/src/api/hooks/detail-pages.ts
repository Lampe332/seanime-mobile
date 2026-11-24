/*
 * The titles of a studio or a person come page by page (core/anilist/anilist.ts studioDetails/staffDetails, "?page=n",
 * 25 a page). Here the pages read so far become one answer of the old form: the head (name, image, …) of the first page
 * and the items of all pages in their order, with the pageInfo of the last page.
 */

type Json = Record<string, unknown>

/** At most 5000 titles (200 pages of 25): only a guard against a page that claims a next one for ever */
export const DETAIL_PAGE_LIMIT = 200

const asJson = (value: unknown): Json | undefined => (typeof value === "object" && value !== null ? value as Json : undefined)

/** `field`: "Studio" or "Staff"; `connection`: "media" or "staffMedia"; `list`: "nodes" or "edges" */
export function joinDetailPages<T>(pages: readonly (T | undefined)[] | undefined, field: string, connection: string, list: string): T | undefined {
    const first = asJson(pages?.[0])
    const head = asJson(first?.[field])
    if (!pages || !first || !head) return pages?.[0]
    const items: unknown[] = []
    let pageInfo: unknown
    for (const page of pages) {
        const part = asJson(asJson(asJson(page)?.[field])?.[connection])
        const found = part?.[list]
        if (Array.isArray(found)) items.push(...found)
        pageInfo = part?.pageInfo
    }
    const joined: Json = { ...asJson(head[connection]), [list]: items }
    if (pageInfo !== undefined) joined.pageInfo = pageInfo
    else delete joined.pageInfo
    return { ...first, [field]: { ...head, [connection]: joined } } as T
}

/** The page after `pageParam`, or undefined when AniList said none follows (or the last page brought nothing) */
export function nextDetailPage(page: unknown, field: string, connection: string, list: string, pageParam: number): number | undefined {
    const part = asJson(asJson(asJson(page)?.[field])?.[connection])
    const items = part?.[list]
    const hasNext = asJson(part?.pageInfo)?.hasNextPage === true
    if (!hasNext || !Array.isArray(items) || !items.length || pageParam >= DETAIL_PAGE_LIMIT) return undefined
    return pageParam + 1
}
