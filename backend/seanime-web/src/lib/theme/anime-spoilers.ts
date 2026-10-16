import { AL_BaseAnime } from "@/api/generated/types"
import type { ThemeSettingsHook } from "@/lib/theme/theme-hooks"
import { atom } from "jotai"
import { useAtomValue, useSetAtom } from "jotai/react"
import { atomWithStorage, selectAtom } from "jotai/utils"
import React from "react"

type AnimeSpoilerSettings = Pick<ThemeSettingsHook,
    | "hideAnimeSpoilers"
    | "hideAnimeSpoilerThumbnails"
    | "hideAnimeSpoilerTitles"
    | "hideAnimeSpoilerDescriptions"
    | "hideAnimeSpoilerSkipNextEpisode"
>

type EpisodeSpoilerStateOptions = {
    mediaId?: number | null
    episodeNumber?: number | null
    watchedProgress?: number | null
    spoilerMode?: "blur" | "replace"
    spoilerActive?: boolean
}

export const __animeSpoilers_unhiddenMediaAtom = atomWithStorage<Record<string, true>>("sea-anime-spoilers-unhidden-media",
    {},
    undefined,
    { getOnInit: true })

const emptyAnimeSpoilerOverrideAtom = atom(false)

function getMediaKey(mediaId?: number | null) {
    if (mediaId == null || Number.isNaN(mediaId) || mediaId <= 0) {
        return null
    }

    return String(mediaId)
}

export function useAnimeSpoilerOverride(mediaId?: number | null) {
    const mediaKey = getMediaKey(mediaId)

    const mediaOverrideAtom = React.useMemo(() => {
        if (!mediaKey) {
            return emptyAnimeSpoilerOverrideAtom
        }

        return selectAtom(__animeSpoilers_unhiddenMediaAtom, data => !!data[mediaKey])
    }, [mediaKey])

    return useAtomValue(mediaOverrideAtom)
}

export function useAnimeSpoilerActions() {
    const setUnhiddenMedia = useSetAtom(__animeSpoilers_unhiddenMediaAtom)

    const setSpoilersForMedia = React.useCallback((mediaId: number, enabled: boolean) => {
        const mediaKey = getMediaKey(mediaId)
        if (!mediaKey) {
            return
        }

        setUnhiddenMedia(prev => {
            if (enabled) {
                if (!prev[mediaKey]) {
                    return prev
                }

                const next = { ...prev }
                delete next[mediaKey]
                return next
            }

            if (prev[mediaKey]) {
                return prev
            }

            return {
                ...prev,
                [mediaKey]: true,
            }
        })
    }, [setUnhiddenMedia])

    return {
        setSpoilersForMedia,
    }
}

function isEpisodeSpoiler(settings: AnimeSpoilerSettings, episodeNumber?: number | null, watchedProgress?: number | null) {
    if (!settings.hideAnimeSpoilers || episodeNumber == null) {
        return false
    }

    const normalizedProgress = watchedProgress ?? 0
    const adjustedProgressNumber = normalizedProgress + (settings.hideAnimeSpoilerSkipNextEpisode ? 1 : 0)

    return episodeNumber > adjustedProgressNumber
}

export function useEpisodeSpoilerState(settings: AnimeSpoilerSettings, options: EpisodeSpoilerStateOptions) {
    const {
        mediaId,
        episodeNumber,
        watchedProgress,
        spoilerMode = "blur",
        spoilerActive,
    } = options

    const isUnhiddenMedia = useAnimeSpoilerOverride(mediaId)

    return React.useMemo(() => {
        const isSpoiler = !isUnhiddenMedia && (spoilerActive ?? isEpisodeSpoiler(settings, episodeNumber, watchedProgress))

        return {
            isSpoiler,
            blurImage: isSpoiler && settings.hideAnimeSpoilerThumbnails && spoilerMode === "blur",
            replaceImage: isSpoiler && settings.hideAnimeSpoilerThumbnails && spoilerMode === "replace",
            blurTitle: isSpoiler && settings.hideAnimeSpoilerTitles && spoilerMode === "blur",
            replaceTitle: isSpoiler && settings.hideAnimeSpoilerTitles && spoilerMode === "replace",
            blurDescription: isSpoiler && settings.hideAnimeSpoilerDescriptions,
            hideFileName: isSpoiler && settings.hideAnimeSpoilerTitles,
        }
    }, [
        episodeNumber,
        isUnhiddenMedia,
        settings.hideAnimeSpoilers,
        settings.hideAnimeSpoilerDescriptions,
        settings.hideAnimeSpoilerSkipNextEpisode,
        settings.hideAnimeSpoilerThumbnails,
        settings.hideAnimeSpoilerTitles,
        spoilerActive,
        spoilerMode,
        watchedProgress,
    ])
}

export function useContinueWatchingSpoilers(settings: AnimeSpoilerSettings) {
    return React.useMemo(() => {
        return settings.hideAnimeSpoilers && !settings.hideAnimeSpoilerSkipNextEpisode
    }, [settings.hideAnimeSpoilers, settings.hideAnimeSpoilerSkipNextEpisode])
}

export function useMissingEpisodeSpoilers(settings: AnimeSpoilerSettings) {
    return React.useMemo(() => {
        return settings.hideAnimeSpoilers
    }, [settings.hideAnimeSpoilers])
}

export function getSpoilerFreeAnimeImage(anime?: Pick<AL_BaseAnime, "bannerImage" | "coverImage"> | null) {
    return anime?.bannerImage || anime?.coverImage?.extraLarge || anime?.coverImage?.large || anime?.coverImage?.medium
}
