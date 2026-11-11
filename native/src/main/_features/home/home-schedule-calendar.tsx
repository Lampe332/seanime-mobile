import { addDays } from "date-fns/addDays"
import { ScheduleCalendar, ScheduleMonthCalendar } from "@/main/schedule/_screens/schedule-phone"
import { useGlobalScheduleItems } from "@/main/schedule/_lib/use-global-schedule"
import React from "react"

/**
 * Home's "Schedule calendar" (home-screen.tsx AnimeScheduleCalendar / GlobalAnimeScheduleCalendar): with My AniList it is the
 * phone calendar itself, head included, as on Android 2.0.33; with All anime the month grid of AniList's episodes from two
 * weeks back to two weeks ahead.
 */
export function HomeScheduleCalendar({ global }: { global: boolean }) {
    return global ? <GlobalCalendar /> : <ScheduleCalendar />
}

function GlobalCalendar() {
    // fixed for the visit, so the query keeps its key
    const [range] = React.useState(() => ({ start: addDays(new Date(), -14), end: addDays(new Date(), 14) }))
    const query = useGlobalScheduleItems(range.start, range.end, true)
    return <ScheduleMonthCalendar items={query.data} loading={query.isLoading} error={query.isError && !query.data} onRetry={() => void query.refetch()} />
}
