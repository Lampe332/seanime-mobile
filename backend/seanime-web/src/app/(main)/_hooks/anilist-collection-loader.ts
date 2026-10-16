import { Anime_EntryListData, Nullish } from "@/api/generated/types"
import { useGetAnimeCollection } from "@/api/hooks/anilist.hooks"
import { __anilist_userAnimeListDataAtom, __anilist_userAnimeMediaAtom } from "@/app/(main)/_atoms/anilist.atoms"
import { atom } from "jotai"
import { useAtomValue, useSetAtom } from "jotai/react"
import { selectAtom } from "jotai/utils"
import React from "react"

const emptyAnimeListDataAtom = atom<Anime_EntryListData | undefined>(undefined)

/**
 * @description
 * - Fetches the Anilist collection
 */
export function useAnimeCollectionLoader() {
    const setAnilistUserMedia = useSetAtom(__anilist_userAnimeMediaAtom)

    const setAnilistUserMediaListData = useSetAtom(__anilist_userAnimeListDataAtom)

    const { data } = useGetAnimeCollection()

    // Store the user's media in `userMediaAtom`
    React.useEffect(() => {
        if (!!data) {
            const allMedia = data.MediaListCollection?.lists?.flatMap(n => n?.entries)?.filter(Boolean)?.map(n => n.media)?.filter(Boolean) ?? []
            setAnilistUserMedia(allMedia)

            const listData = data.MediaListCollection?.lists?.flatMap(n => n?.entries)?.filter(Boolean)?.reduce((acc, n) => {
                acc[String(n.media?.id!)] = {
                    status: n.status,
                    progress: n.progress || 0,
                    score: n.score || 0,
                    startedAt: (n.startedAt?.year && n.startedAt?.month) ? new Date(n.startedAt.year || 0,
                        (n.startedAt.month || 1) - 1,
                        n.startedAt.day || 1).toISOString() : undefined,
                    completedAt: (n.completedAt?.year && n.completedAt?.month) ? new Date(n.completedAt.year || 0,
                        (n.completedAt.month || 1) - 1,
                        n.completedAt.day || 1).toISOString() : undefined,
                }
                return acc
            }, {} as Record<string, Anime_EntryListData>)
            setAnilistUserMediaListData(listData || {})
        }
    }, [data])

    return null
}

export function useAnilistUserAnime() {
    return useAtomValue(__anilist_userAnimeMediaAtom)
}

export function useAnilistUserAnimeListData(mId: Nullish<number | string>, enabled: boolean = true): Anime_EntryListData | undefined {
    const mediaId = String(mId)
    const listDataAtom = React.useMemo(() => {
        if (!enabled) {
            return emptyAnimeListDataAtom
        }

        return selectAtom(__anilist_userAnimeListDataAtom, data => data[mediaId])
    }, [enabled, mediaId])

    return useAtomValue(listDataAtom)
}
