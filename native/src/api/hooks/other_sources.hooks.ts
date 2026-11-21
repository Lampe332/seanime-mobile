import { useServerMutation, useServerQuery } from "@/api/client/requests"
import type { AL_BaseAnime, AL_ListAnime } from "@/api/generated/types"
import { useQueryClient } from "@tanstack/react-query"
import { API_ENDPOINTS } from "@/api/generated/endpoints"

// geschrieben nach: anilist.hooks.ts (useAnilistListAnime) und core/tvmaze/tvmaze.ts (searchOtherSources)

export type SearchOtherSources_Variables = { query: string }

/** The request of the search in the other sources (TVmaze): a trimmed query, asked only when there is one. */
export function otherSourcesSearchRequest(query: string, enabled: boolean = true) {
    const asked = query.trim()
    const route = API_ENDPOINTS.OTHER_SOURCES.SearchOtherSources
    return {
        endpoint: route.endpoint,
        method: route.methods[0],
        queryKey: [route.key, asked.toLowerCase()],
        data: { query: asked } satisfies SearchOtherSources_Variables,
        enabled: enabled && asked.length > 0,
        // a failed search only leaves the extra group out, without a toast
        muteError: true,
        staleTime: 10 * 60 * 1000,
    }
}

/** Titles of the other sources (TVmaze) for a search, in the form of AniList's search (negative ids). */
export function useSearchOtherSources(query: string, enabled: boolean = true) {
    return useServerQuery<AL_ListAnime, SearchOtherSources_Variables>(otherSourcesSearchRequest(query, enabled))
}

export type UpdateMyShows_Variables = { mediaId: number, listed: boolean }

/** "My shows": the titles of the other sources kept on the device (negative ids). */
export function useGetMyShows() {
    const route = API_ENDPOINTS.OTHER_SOURCES.GetMyShows
    return useServerQuery<AL_BaseAnime[]>({ endpoint: route.endpoint, method: route.methods[0], queryKey: [route.key], muteError: true })
}

/** Adds a title of the other sources to "My shows" or takes it out. */
export function useUpdateMyShows() {
    const queryClient = useQueryClient()
    const route = API_ENDPOINTS.OTHER_SOURCES.UpdateMyShows
    return useServerMutation<boolean, UpdateMyShows_Variables>({
        endpoint: route.endpoint,
        method: route.methods[0],
        mutationKey: [route.key],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.OTHER_SOURCES.GetMyShows.key] })
        },
    })
}
