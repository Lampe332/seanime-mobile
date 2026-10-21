import { useSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { AL_ListRecentAnime } from "@/api/generated/types"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fetchGlobalScheduleDay, fetchGlobalScheduleRange } from "./global-schedule"

/** Episodes per local day ("yyyy-MM-dd") between two local midnights, for the counts in the month grid and day strip. */
export function useGlobalScheduleCounts(start: Date, end: Date, enabled: boolean) {
    const { seaFetch } = useSeaQuery()
    const serverStatus = useServerStatus()
    const hideAdult = !serverStatus?.settings?.anilist?.enableAdultContent
    return useQuery({
        queryKey: ["schedule-global-counts", start.getTime(), end.getTime(), hideAdult],
        enabled,
        staleTime: 30 * 60 * 1000,
        // a month takes ~13 AniList pages; when AniList throttles, try again after its cool-down
        retry: 2,
        retryDelay: 20000,
        queryFn: async ({ signal }) => {
            const items = await fetchGlobalScheduleRange(start, end, variables => seaFetch<AL_ListRecentAnime>(API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.endpoint, "POST", variables), signal, hideAdult)
            const counts: Record<string, number> = {}
            for (const item of items) {
                const day = format(new Date(item.dateTime!), "yyyy-MM-dd")
                counts[day] = (counts[day] ?? 0) + 1
            }
            return counts
        },
    })
}

export function useGlobalScheduleDay(date: string, enabled: boolean) {
    const { seaFetch } = useSeaQuery()
    const serverStatus = useServerStatus()
    // Adult media is shown only when the user enabled it.
    const hideAdult = !serverStatus?.settings?.anilist?.enableAdultContent
    return useQuery({
        queryKey: ["schedule-global-day", date, hideAdult],
        enabled,
        staleTime: 5 * 60 * 1000,
        retry: false,
        queryFn: ({ signal }) => fetchGlobalScheduleDay(date, variables => seaFetch<AL_ListRecentAnime>(API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.endpoint, "POST", variables), signal, hideAdult),
    })
}
