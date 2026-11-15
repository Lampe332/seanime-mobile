// geschrieben nach: lib/updates/updates-policy.ts, chapter-check.ts und den App-Hooks useGetAnimeCollectionSchedule/useGetAnimeCollection; eigene Regel

import { useGetAnimeCollectionSchedule } from "@/api/hooks/anime_collection.hooks"
import { useGetAnimeCollection } from "@/api/hooks/anilist.hooks"
import { atomWithStorage } from "@/lib/storage"
import { useAtomValue } from "jotai"
import React from "react"
import { readChapterFeed, subscribeChapterFeed } from "./chapter-check"
import { episodeUpdates, listStatuses, newCount, newestFirst, sinceOf, UPDATES_WINDOW_MS, type UpdateItem } from "./updates-policy"

/** When the Updates page was opened last, or "Mark all as seen" was pressed (epoch ms, local only; 0 = never) */
export const updatesLastVisitAtom = atomWithStorage<number>("seanime-mobile-updates-last-visit", 0)

/** A clock that moves every few minutes, so "aired by now" follows without a re-render each second */
function useNow(stepMs: number = 5 * 60 * 1000) {
    const [now, setNow] = React.useState(() => Date.now())
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), stepMs)
        return () => clearInterval(timer)
    }, [stepMs])
    return now
}

/** New episodes (list schedule) and found chapters of the window, newest first */
export function useUpdateItems(): { items: UpdateItem[], loading: boolean, now: number } {
    const { data: schedule, isLoading } = useGetAnimeCollectionSchedule()
    const { data: collection } = useGetAnimeCollection()
    const chapters = React.useSyncExternalStore(subscribeChapterFeed, readChapterFeed)
    const now = useNow()
    const items = React.useMemo(() => newestFirst([
        ...episodeUpdates(schedule ?? [], listStatuses(collection), now),
        ...chapters.filter(item => item.at > now - UPDATES_WINDOW_MS && item.at <= now + 60_000),
    ]), [schedule, collection, chapters, now])
    return { items, loading: isLoading, now }
}

/** The Menu's count: what is new since the last visit */
export function useUpdatesCount(): number {
    const { items, now } = useUpdateItems()
    const lastVisit = useAtomValue(updatesLastVisitAtom)
    return newCount(items, sinceOf(lastVisit, now))
}
