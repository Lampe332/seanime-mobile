import { useSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { AL_ListRecentAnime } from "@/api/generated/types"
import { useQuery } from "@tanstack/react-query"
import { fetchGlobalScheduleDay } from "./global-schedule"

export function useGlobalScheduleDay(date: string, enabled: boolean) {
    const { seaFetch } = useSeaQuery()
    return useQuery({
        queryKey: ["schedule-global-day", date],
        enabled,
        staleTime: 5 * 60 * 1000,
        retry: false,
        queryFn: ({ signal }) => fetchGlobalScheduleDay(date, variables => seaFetch<AL_ListRecentAnime>(API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.endpoint, "POST", variables), signal),
    })
}
