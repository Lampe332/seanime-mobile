// geschrieben nach: Befund S-scan #2/#11 (15.11.2026), list-entry-form.ts `entryButton`, anilist-media-entry-sheet.tsx (Zur-Liste-Knopf) und den App-Typen AL_BaseAnime/AL_BaseManga

/*
 * The list items of a cover's long-press menu (phone-cards.tsx): what the card can do with the user's AniList list
 * without opening the page.
 *
 * - No AniList user: nothing (as the page's add button, `entryButton`).
 * - Not on the list: "Add to list" (Planning, progress 0: the page's "+" button).
 * - On the list: "On your list" (opens the page; left out on My lists, where every card is), "+1 episode/chapter" while
 *   the title is not completed and the next one is out (anime: AniList's next airing episode is not out yet), and on My
 *   lists for manga "Continue reading" (the manga page opens its reading chapter, manga-continue.ts).
 */

export type CardListState = { status?: string | null, progress?: number | null } | null | undefined

export type CardListMedia = {
    episodes?: number | null
    chapters?: number | null
    nextAiringEpisode?: { episode?: number | null } | null
}

export type CardListAction =
    | { id: "add-to-list" }
    | { id: "on-list" }
    | { id: "increment", progress: number, total: number }
    | { id: "continue-reading" }

const whole = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0)

/** The highest number the progress can reach now: anime up to the last aired episode, else the known total (0 = unknown). */
export function reachableProgress(type: "anime" | "manga", media: CardListMedia): number {
    if (type === "manga") return whole(media.chapters)
    const next = whole(media.nextAiringEpisode?.episode)
    return next > 0 ? next - 1 : whole(media.episodes)
}

export function cardListActions({ type, signedIn, listData, media, onListScreen }: {
    type: "anime" | "manga"
    signedIn: boolean
    listData: CardListState
    media: CardListMedia
    /** My lists: every card is on the list, so "On your list" is left out and manga get "Continue reading" */
    onListScreen?: boolean
}): CardListAction[] {
    if (!signedIn) return []
    if (!listData || !listData.status) return onListScreen ? [] : [{ id: "add-to-list" }]
    const actions: CardListAction[] = onListScreen ? [] : [{ id: "on-list" }]
    const progress = whole(listData.progress)
    const reachable = reachableProgress(type, media)
    const open = listData.status !== "COMPLETED"
    if (open && (reachable === 0 || progress < reachable)) {
        actions.push({ id: "increment", progress: progress + 1, total: whole(type === "anime" ? media.episodes : media.chapters) })
    }
    if (onListScreen && type === "manga" && open) actions.push({ id: "continue-reading" })
    return actions
}
