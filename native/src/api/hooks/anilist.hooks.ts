import { buildSeaQuery, type SeaError, useServerMutation, useServerQuery } from "@/api/client/requests"
import {
    AnilistListAnime_Variables,
    AnilistListRecentAiringAnime_Variables,
    DeleteAnilistListEntry_Variables,
    EditAnilistListEntry_Variables,
} from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import {
    AL_AnimeCollection,
    AL_AnimeDetailsById_Media,
    AL_BaseAnime,
    AL_ListAnime,
    AL_ListRecentAnime,
    AL_Stats,
    AL_StudioDetails,
    Nullish,
} from "@/api/generated/types"
import { joinDetailPages, nextDetailPage } from "@/api/hooks/detail-pages"
import { getEntryPreloadStaleTime } from "@/lib/entry-preloader"
import { serverAuthTokenAtom } from "@/main/_atoms/server-status.atoms"
import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import * as React from "react"
import { toast } from "@/components/ui/toast/toast-store"
import { tr } from "@/lib/app-language"

/**
 * The AniList collection is read by many screens at once (Home, Discover, Search, My lists): a new one does not fetch it
 * again within 2 minutes. Every change invalidates it anyway (edit, delete, progress, refresh, the core's
 * "refreshed-anilist-anime-collection" event, an account change).
 */
const COLLECTION_STALE_TIME = 2 * 60_000

export function useGetAnimeCollection() {
    return useServerQuery<AL_AnimeCollection>({
        endpoint: API_ENDPOINTS.ANILIST.GetAnimeCollection.endpoint,
        method: API_ENDPOINTS.ANILIST.GetAnimeCollection.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key],
        enabled: true,
        staleTime: COLLECTION_STALE_TIME,
    })
}
export function useGetRawAnimeCollection() {
    return useServerQuery<AL_AnimeCollection>({
        endpoint: API_ENDPOINTS.ANILIST.GetRawAnimeCollection.endpoint,
        method: API_ENDPOINTS.ANILIST.GetRawAnimeCollection.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key],
        enabled: true,
        staleTime: COLLECTION_STALE_TIME,
    })
}
export function useGetRawAnimeCollectionTags() {
    return useServerQuery<Record<number, Array<string>>>({
        endpoint: API_ENDPOINTS.ANILIST.GetRawAnimeCollectionTags.endpoint,
        method: API_ENDPOINTS.ANILIST.GetRawAnimeCollectionTags.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollectionTags.key],
        enabled: true,
        staleTime: COLLECTION_STALE_TIME,
    })
}

export function useRefreshAnimeCollection() {
    const queryClient = useQueryClient()

    return useServerMutation<AL_AnimeCollection>({
        endpoint: API_ENDPOINTS.ANILIST.GetAnimeCollection.endpoint,
        method: API_ENDPOINTS.ANILIST.GetAnimeCollection.methods[1],
        mutationKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key],
        onSuccess: async () => {
            toast.success(tr("AniList is up-to-date", "AniList ist aktuell"))
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollectionTags.key] })
            // missed sequels are worked out from the lists (Home and Discover share the key)
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.AnilistListMissedSequels.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetRawAnilistMangaCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetRawAnilistMangaCollectionTags.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaEntry.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetAnimeCollectionSchedule.key] })
        },
    })
}

export function useEditAnilistListEntry(id: Nullish<string | number>, type: "anime" | "manga") {
    const queryClient = useQueryClient()

    return useServerMutation<boolean, EditAnilistListEntry_Variables>({
        endpoint: API_ENDPOINTS.ANILIST.EditAnilistListEntry.endpoint,
        method: API_ENDPOINTS.ANILIST.EditAnilistListEntry.methods[0],
        mutationKey: [API_ENDPOINTS.ANILIST.EditAnilistListEntry.key, String(id)],
        onSuccess: async () => {
            toast.success(tr("Entry updated", "Eintrag aktualisiert"))
            if (type === "anime") {
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, String(id)] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollectionTags.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.AnilistListMissedSequels.key] })
            } else if (type === "manga") {
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaEntry.key, String(id)] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetRawAnilistMangaCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetRawAnilistMangaCollectionTags.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaCollection.key] })
            }
        },
    })
}

export function useGetAnilistAnimeDetails(id: Nullish<number | string>) {
    return useServerQuery<AL_AnimeDetailsById_Media>({
        endpoint: API_ENDPOINTS.ANILIST.GetAnilistAnimeDetails.endpoint.replace("{id}", String(id)),
        method: API_ENDPOINTS.ANILIST.GetAnilistAnimeDetails.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetAnilistAnimeDetails.key, String(id)],
        enabled: !!id,
        staleTime: getEntryPreloadStaleTime("anime", id),
    })
}

export function useDeleteAnilistListEntry(id: Nullish<string | number>, type: "anime" | "manga", onSuccess: () => void) {
    const queryClient = useQueryClient()

    return useServerMutation<boolean, DeleteAnilistListEntry_Variables>({
        endpoint: API_ENDPOINTS.ANILIST.DeleteAnilistListEntry.endpoint,
        method: API_ENDPOINTS.ANILIST.DeleteAnilistListEntry.methods[0],
        mutationKey: [API_ENDPOINTS.ANILIST.DeleteAnilistListEntry.key],
        onSuccess: async () => {
            toast.success(tr("Entry deleted", "Eintrag gelöscht"))
            if (type === "anime") {
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, String(id)] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollectionTags.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.AnilistListMissedSequels.key] })
            } else if (type === "manga") {
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaEntry.key, String(id)] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetRawAnilistMangaCollection.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetRawAnilistMangaCollectionTags.key] })
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaCollection.key] })
            }
            onSuccess()
        },
    })
}

export function useAnilistListAnime(variables: AnilistListAnime_Variables, enabled: boolean) {
    return useServerQuery<AL_ListAnime, AnilistListAnime_Variables>({
        endpoint: API_ENDPOINTS.ANILIST.AnilistListAnime.endpoint,
        method: API_ENDPOINTS.ANILIST.AnilistListAnime.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.AnilistListAnime.key, variables],
        data: variables,
        enabled: enabled ?? true,
    })
}

export function useAnilistListRecentAiringAnime(variables: AnilistListRecentAiringAnime_Variables, enabled: boolean = true) {
    return useServerQuery<AL_ListRecentAnime, AnilistListRecentAiringAnime_Variables>({
        endpoint: API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.endpoint,
        method: API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.key, JSON.stringify(variables)],
        data: variables,
        enabled: enabled,
    })
}

/**
 * A studio's or person's titles page by page (core/anilist/anilist.ts, "?page=n", 25 a page): the first page shows at
 * once, `loadMore` reads the next one (the screen calls it when the list nears its end). `data` is all pages read so far
 * joined into one answer (api/hooks/detail-pages.ts); `loadingMore` while a next page is on its way.
 */
function useDetailPages<T>(entry: { key: string, endpoint: string }, id: number, field: string, connection: string, list: string) {
    const password = useAtomValue(serverAuthTokenAtom)
    const query = useInfiniteQuery<T | undefined, SeaError, InfiniteData<T | undefined, number>, string[], number>({
        queryKey: [entry.key, String(id), "pages"],
        queryFn: ({ pageParam }) => buildSeaQuery<T>({
            endpoint: `${entry.endpoint.replace("{id}", String(id))}?page=${pageParam}`,
            method: "GET",
            password,
        }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, _pages, pageParam) => nextDetailPage(lastPage, field, connection, list, pageParam),
        enabled: Number.isFinite(id) && id > 0,
    })
    const { data: pages, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query
    const data = React.useMemo(() => joinDetailPages(pages?.pages, field, connection, list), [pages, field, connection, list])
    const loadMore = React.useCallback(() => {
        if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
    }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
    const retryMore = React.useCallback(() => void fetchNextPage(), [fetchNextPage])
    return { ...query, data, loadMore, retryMore, loadingMore: isFetchingNextPage }
}

export function useGetAnilistStudioDetails(id: number) {
    return useDetailPages<AL_StudioDetails>(API_ENDPOINTS.ANILIST.GetAnilistStudioDetails, id, "Studio", "media", "nodes")
}

/** GET /api/v1/anilist/staff-details/{id}?page=n (core/anilist/anilist.ts staffDetails; not in the generated types) */
export type AL_StaffDetails = {
    Staff?: {
        id: number
        name?: { full?: string, native?: string }
        image?: { large?: string }
        primaryOccupations?: string[]
        siteUrl?: string
        staffMedia?: {
            pageInfo?: { hasNextPage?: boolean }
            edges?: ({ staffRole?: string, node?: AL_BaseAnime & { chapters?: number } } | null)[]
        }
    }
}

export function useGetAnilistStaffDetails(id: number) {
    return useDetailPages<AL_StaffDetails>(API_ENDPOINTS.ANILIST.GetAnilistStaffDetails, id, "Staff", "staffMedia", "edges")
}

export function useGetAniListStats(enabled: boolean = true) {
    return useServerQuery<AL_Stats>({
        endpoint: API_ENDPOINTS.ANILIST.GetAniListStats.endpoint,
        method: API_ENDPOINTS.ANILIST.GetAniListStats.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.GetAniListStats.key],
        enabled: enabled,
    })
}

export function useAnilistListMissedSequels(enabled: boolean) {
    return useServerQuery<Array<AL_BaseAnime>>({
        endpoint: API_ENDPOINTS.ANILIST.AnilistListMissedSequels.endpoint,
        method: API_ENDPOINTS.ANILIST.AnilistListMissedSequels.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.AnilistListMissedSequels.key],
        enabled: enabled,
    })
}
