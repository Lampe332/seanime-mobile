// geschrieben nach: card-list-actions.ts, anilist-media-entry-sheet.tsx (Zur-Liste-Knopf), episode-section.tsx (Fortschritt +1), manga-library-phone.tsx ("Continue reading")

import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { useEditAnilistListEntry } from "@/api/hooks/anilist.hooks"
import { useUpdateAnimeEntryProgress } from "@/api/hooks/anime_entries.hooks"
import { useUpdateMangaProgress } from "@/api/hooks/manga.hooks"
import type { CardMenuItem } from "@/components/shared/card-menu"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { getMangaCollectionEntryAtom } from "@/main/_atoms/manga-collection.atoms"
import { useAnilistUserAnimeListData } from "@/main/_hooks/anilist-collection-loader"
import { useCurrentUser } from "@/main/_hooks/use-server-status"
import { cardListActions, type CardListState } from "@/main/_features/media/_lib/card-list-actions"
import { mediaEntryHref } from "@/main/_features/media/_lib/media-card"
import { __manga_continueIntentAtom } from "@/main/manga/_lib/manga-continue"
import { useQueryClient } from "@tanstack/react-query"
import { useAtomValue, useSetAtom } from "jotai"
import BookOpen from "lucide-react-native/icons/book-open"
import ListChecks from "lucide-react-native/icons/list-checks"
import ListPlus from "lucide-react-native/icons/list-plus"
import Plus from "lucide-react-native/icons/plus"
import React from "react"

/*
 * The list items of a cover's long-press menu (rules in card-list-actions.ts). The changes go through the same core
 * routes as the page (list entry edit, progress update), so offline they wait in the core's AniList queue. My lists reads
 * the raw collections, which the shared hooks do not refresh: they are refreshed here after a change.
 */
export function useCardListItems(media: AL_BaseAnime | AL_BaseManga, type: "anime" | "manga", open: (href: string) => void, listEntry?: CardListState): CardMenuItem[] {
    const t = useTr()
    const user = useCurrentUser()
    const queryClient = useQueryClient()
    const animeListData = useAnilistUserAnimeListData(media.id, type === "anime" && !listEntry)
    const mangaEntry = useAtomValue(getMangaCollectionEntryAtom(media.id))
    const listData = listEntry ?? (type === "anime" ? animeListData : mangaEntry?.listData)
    const { mutate: editEntry } = useEditAnilistListEntry(media.id, type)
    const { mutate: animeProgress } = useUpdateAnimeEntryProgress(media.id, 0, false)
    const { mutate: mangaProgress } = useUpdateMangaProgress(media.id)
    const setContinueIntent = useSetAtom(__manga_continueIntentAtom)

    const actions = cardListActions({ type, signedIn: !!user, listData, media: media as AL_BaseAnime & AL_BaseManga, onListScreen: !!listEntry })
    const key = actions.map(action => action.id === "increment" ? `${action.id}:${action.progress}` : action.id).join(",")

    return React.useMemo(() => {
        const refreshRaw = () => void queryClient.invalidateQueries({
            queryKey: [type === "anime" ? API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key : API_ENDPOINTS.MANGA.GetRawAnilistMangaCollection.key],
        })
        const progressDone = () => {
            toast.success(t("Progress updated", "Fortschritt aktualisiert"))
            refreshRaw()
        }
        return actions.map((action): CardMenuItem => {
            switch (action.id) {
                case "add-to-list":
                    return {
                        id: action.id, label: t("Add to list", "Zur Liste hinzufügen"), icon: ListPlus,
                        onPress: () => editEntry({ mediaId: media.id, status: "PLANNING", score: 0, progress: 0, startedAt: undefined, completedAt: undefined, type }, { onSuccess: refreshRaw }),
                    }
                case "on-list":
                    return { id: action.id, label: t("On your list", "Auf deiner Liste"), icon: ListChecks, onPress: () => open(mediaEntryHref(type, media.id)) }
                case "increment":
                    return type === "anime"
                        ? {
                            id: action.id, label: t(`+1 episode (${action.progress})`, `+1 Folge (${action.progress})`), icon: Plus,
                            onPress: () => animeProgress({ mediaId: media.id, malId: media.idMal || undefined, episodeNumber: action.progress, totalEpisodes: action.total }, { onSuccess: progressDone }),
                        }
                        : {
                            id: action.id, label: t(`+1 chapter (${action.progress})`, `+1 Kapitel (${action.progress})`), icon: Plus,
                            onPress: () => mangaProgress({ mediaId: media.id, malId: media.idMal || undefined, chapterNumber: action.progress, totalChapters: action.total }, { onSuccess: progressDone }),
                        }
                case "continue-reading":
                    return {
                        id: action.id, label: t("Continue reading", "Weiterlesen"), icon: BookOpen,
                        onPress: () => {
                            setContinueIntent({ mediaId: media.id, at: Date.now() })
                            open(mediaEntryHref("manga", media.id))
                        },
                    }
            }
        })
        // `key` stands for `actions`, which is new on every render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, media.id, media.idMal, type, t, open, editEntry, animeProgress, mangaProgress, setContinueIntent, queryClient])
}
