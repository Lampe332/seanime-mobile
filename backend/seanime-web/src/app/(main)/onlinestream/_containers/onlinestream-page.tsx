import { tr } from "@/lib/app-language"
import { getServerBaseUrl } from "@/api/client/server-url"
import { downloadOnAndroid, openAndroidDownloads } from "@/lib/android-offline"
import { EpisodeDownloadPicker } from "./episode-download-picker"
import { Anime_Entry } from "@/api/generated/types"
import {
    useGetOnlineStreamEpisodeList,
    useGetOnlineStreamEpisodeSource,
    useOnlineStreamEmptyCache,
    useRefreshOnlineStreamEpisodeSource,
} from "@/api/hooks/onlinestream.hooks"
import { usePlayNext } from "@/app/(main)/_atoms/playback.atoms"
import { serverStatusAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { EpisodeGridItem } from "@/app/(main)/_features/anime/_components/episode-grid-item"
import { MediaEpisodeInfoModal } from "@/app/(main)/_features/media/_components/media-episode-info-modal"
import { useNakamaStatus, useNakamaWatchParty } from "@/app/(main)/_features/nakama/nakama-manager"
import { usePlaylistManager } from "@/app/(main)/_features/playlists/_containers/global-playlist-manager"
import { EpisodePillsGrid } from "@/app/(main)/_features/video-core/_components/episode-pills-grid"
import { useSkipData } from "@/app/(main)/_features/video-core/_lib/aniskip"
import { vc_mediaCaptionsManager, vc_subtitleManager, VideoCore, VideoCoreProvider } from "@/app/(main)/_features/video-core/video-core"
import {
    HlsAudioTrack,
    isHLSSrc,
    isNativeVideoExtension,
    isProbablyHls,
    vc_hlsAudioTracks,
    vc_hlsCurrentAudioTrack,
    vc_hlsSetAudioTrack,
} from "@/app/(main)/_features/video-core/video-core-hls"
import {
    VideoCoreInlineHelpers,
    VideoCoreInlineHelperUpdateProgressButton,
    VideoCoreInlineLayout,
} from "@/app/(main)/_features/video-core/video-core-inline-helpers"
import { vc_useLibassRendererAtom, VideoCore_VideoPlaybackInfo, VideoCore_VideoSource } from "@/app/(main)/_features/video-core/video-core.atoms"
import { useServerHMACAuth } from "@/app/(main)/_hooks/use-server-status"
import { OnlinestreamManualMappingModal } from "@/app/(main)/onlinestream/_containers/onlinestream-manual-matching"
import { useNakamaOnlineStreamWatchParty } from "@/app/(main)/onlinestream/_lib/handle-onlinestream"
import { useHandleOnlinestreamProviderExtensions } from "@/app/(main)/onlinestream/_lib/handle-onlinestream-providers"
import { getProxyUrl } from "@/app/(main)/onlinestream/_lib/onlinestream-proxy"
import { findPreferredSubtitleTrack, isDefaultSubtitleTrack } from "@/app/(main)/onlinestream/_lib/onlinestream-subtitle-preference"
import {
    __onlinestream_audioTrackPreferenceByMediaAtom,
    __onlinestream_dubbedPreferenceByMediaAtom,
    __onlinestream_qualityAtom,
    __onlinestream_selectedEpisodeNumberAtom,
    __onlinestream_selectedProviderAtom,
    __onlinestream_selectedServerAtom,
    __onlinestream_subtitlePreferenceByMediaAtom,
    OnlinestreamAudioTrackPreference,
} from "@/app/(main)/onlinestream/_lib/onlinestream.atoms"
import { useOnlinestreamAutoProviderCycler } from "@/app/(main)/onlinestream/_lib/use-onlinestream-auto-provider-cycler"
import { LuffyError } from "@/components/shared/luffy-error"
import { Button, IconButton } from "@/components/ui/button"
import { Modal, ModalProps } from "@/components/ui/modal"
import { Popover, PopoverProps } from "@/components/ui/popover"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { logger, useLatestFunction } from "@/lib/helpers/debug"
import { usePathname, useRouter, useSearchParams } from "@/lib/navigation"
import { useWindowSize } from "@uidotdev/usehooks"
import { AxiosError } from "axios"
import { useAtom, useAtomValue } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import uniq from "lodash/uniq"
import uniqBy from "lodash/uniqBy"
import { AnimatePresence, motion } from "motion/react"
import React from "react"
import { BsFillGrid3X3GapFill } from "react-icons/bs"
import { CgMediaPodcast } from "react-icons/cg"
import { FaSearch } from "react-icons/fa"
import { HiOutlineCog6Tooth } from "react-icons/hi2"
import { LuRefreshCw, LuSpeech } from "react-icons/lu"
import { MdOutlineSubtitles } from "react-icons/md"
import { toast } from "sonner"
import { PluginEpisodeGridItemMenuItems } from "../../_features/plugin/actions/plugin-actions"
import { getMobileInitialEpisode, rememberMobileEpisode } from "../_lib/mobile-episode-selection"

const IS_ANDROID_APP = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile"

function getPlayerContainer() {
    return document.querySelector<HTMLElement>("[data-onlinestream-video-container] [data-vc-element=\"container\"]")
}

type OnlinestreamPageProps = {
    animeEntry?: Anime_Entry
    animeEntryLoading?: boolean
    hideBackButton?: boolean
}

const log = logger("ONLINESTREAM")

// Episode view mode atom
export const __onlineStream_episodeViewModeAtom = atomWithStorage<"list" | "grid">("sea-onlinestream-episode-view-mode", "list")

function isValidVideoSourceType(type: string | null | undefined) {
    if (!type) return false
    return ["unknown", "mp4", "m3u8"].includes(type)
}

function _normalizeLabel(value: string | null | undefined) {
    return value?.trim().toLowerCase() ?? null
}

function getQualityResolution(value: string | null | undefined) {
    const normalized = _normalizeLabel(value)
    if (!normalized) return null

    return normalized.match(/\b(\d{3,4}p|auto|default)\b/i)?.[1]?.toLowerCase() ?? null
}

function normalizeAudioTrackValue(value: string | null | undefined) {
    return value?.trim().toLowerCase() ?? ""
}

function normalizeAudioTrackLanguage(value: string | null | undefined) {
    const normalized = normalizeAudioTrackValue(value).split("-")[0]
    const aliases: Record<string, string> = {
        en: "eng",
        eng: "eng",
        english: "eng",
        ja: "jpn",
        jp: "jpn",
        jap: "jpn",
        jpn: "jpn",
        japanese: "jpn",
        fr: "fra",
        fra: "fra",
        fre: "fra",
        french: "fra",
        es: "spa",
        spa: "spa",
        spanish: "spa",
        pt: "por",
        por: "por",
        portuguese: "por",
        de: "deu",
        deu: "deu",
        ger: "deu",
        german: "deu",
        it: "ita",
        ita: "ita",
        italian: "ita",
        ru: "rus",
        rus: "rus",
        russian: "rus",
        ko: "kor",
        kor: "kor",
        korean: "kor",
        zh: "zho",
        zho: "zho",
        chi: "zho",
        chinese: "zho",
    }
    return aliases[normalized] ?? normalized
}

function findPreferredAudioTrack(audioTracks: HlsAudioTrack[], preference: OnlinestreamAudioTrackPreference | undefined) {
    if (!preference) return null

    const language = normalizeAudioTrackLanguage(preference.language)
    const name = normalizeAudioTrackValue(preference.name)

    const byNameAndLanguage = audioTracks.find(track => {
        if (!name || normalizeAudioTrackValue(track.name) !== name) return false
        if (!language) return true
        return normalizeAudioTrackLanguage(track.language) === language
    })
    if (byNameAndLanguage) return byNameAndLanguage

    if (language) {
        const byLanguage = audioTracks.find(track => normalizeAudioTrackLanguage(track.language) === language)
        if (byLanguage) return byLanguage
    }

    if (name) {
        const byName = audioTracks.find(track => normalizeAudioTrackValue(track.name) === name)
        if (byName) return byName
    }

    if (preference.trackId !== undefined) {
        return audioTracks.find(track => track.id === preference.trackId) ?? null
    }

    return null
}

function OnlinestreamAudioTrackPreferenceSync(props: { mediaId?: number, playbackId?: string | null }) {
    const { mediaId, playbackId } = props
    const audioTracks = useAtomValue(vc_hlsAudioTracks)
    const currentAudioTrack = useAtomValue(vc_hlsCurrentAudioTrack)
    const setHlsAudioTrack = useAtomValue(vc_hlsSetAudioTrack)
    const [preferenceByMedia, setPreferenceByMedia] = useAtom(__onlinestream_audioTrackPreferenceByMediaAtom)
    const preferenceKey = mediaId ? String(mediaId) : null
    const preference = preferenceKey ? preferenceByMedia[preferenceKey] : undefined
    const hasAppliedPreferenceRef = React.useRef(false)
    const applyingTrackIdRef = React.useRef<number | null>(null)
    const lastAudioTrackRef = React.useRef<number | null>(null)

    React.useEffect(() => {
        hasAppliedPreferenceRef.current = false
        applyingTrackIdRef.current = null
        lastAudioTrackRef.current = null
    }, [playbackId, mediaId])

    React.useEffect(() => {
        if (!preferenceKey || !audioTracks.length || !setHlsAudioTrack || hasAppliedPreferenceRef.current) return

        hasAppliedPreferenceRef.current = true
        const preferredTrack = findPreferredAudioTrack(audioTracks, preference)
        if (!preferredTrack) return

        if (preferredTrack.id === currentAudioTrack) {
            lastAudioTrackRef.current = currentAudioTrack
            return
        }

        applyingTrackIdRef.current = preferredTrack.id
        setHlsAudioTrack(preferredTrack.id)
    }, [audioTracks, currentAudioTrack, preference, preferenceKey, setHlsAudioTrack])

    React.useEffect(() => {
        if (!preferenceKey || !audioTracks.length || currentAudioTrack === -1 || !hasAppliedPreferenceRef.current) return

        if (applyingTrackIdRef.current !== null) {
            if (applyingTrackIdRef.current === currentAudioTrack) {
                lastAudioTrackRef.current = currentAudioTrack
                applyingTrackIdRef.current = null
            }
            return
        }

        if (lastAudioTrackRef.current === null) {
            lastAudioTrackRef.current = currentAudioTrack
            return
        }

        if (lastAudioTrackRef.current === currentAudioTrack) return

        lastAudioTrackRef.current = currentAudioTrack

        const currentTrack = audioTracks.find(track => track.id === currentAudioTrack)
        if (!currentTrack) return

        const nextPreference: OnlinestreamAudioTrackPreference = {
            trackId: currentTrack.id,
            language: currentTrack.language,
            name: currentTrack.name,
        }

        setPreferenceByMedia(prev => {
            const current = prev[preferenceKey]
            if (
                current?.trackId === nextPreference.trackId &&
                current?.language === nextPreference.language &&
                current?.name === nextPreference.name
            ) {
                return prev
            }

            return {
                ...prev,
                [preferenceKey]: nextPreference,
            }
        })
    }, [audioTracks, currentAudioTrack, preferenceKey, setPreferenceByMedia])

    return null
}

function OnlinestreamSubtitlePreferenceSync(props: { mediaId?: number, playbackId?: string | null }) {
    const { mediaId, playbackId } = props
    const subtitleManager = useAtomValue(vc_subtitleManager)
    const mediaCaptionsManager = useAtomValue(vc_mediaCaptionsManager)
    const preferenceByMedia = useAtomValue(__onlinestream_subtitlePreferenceByMediaAtom)
    const preference = mediaId ? preferenceByMedia[String(mediaId)] : undefined
    const appliedRef = React.useRef(false)

    React.useEffect(() => {
        appliedRef.current = false
    }, [mediaId, playbackId])

    React.useEffect(() => {
        const manager = subtitleManager ?? mediaCaptionsManager
        if (!manager || !preference || appliedRef.current) return

        const applyPreference = () => {
            if (appliedRef.current) return
            if (preference.off) {
                appliedRef.current = true
                manager.setNoTrack()
                return
            }

            const tracks = manager.getTracks().map(track => ({
                number: track.number,
                language: track.language,
                label: track.label,
            }))
            if (!tracks.length) return

            appliedRef.current = true
            const preferredTrack = findPreferredSubtitleTrack(tracks, preference)
            if (!preferredTrack) return

            if (subtitleManager) {
                void subtitleManager.selectTrack(preferredTrack.number)
            } else {
                void mediaCaptionsManager?.selectTrack(preferredTrack.number)
            }
        }

        manager.addEventListener("tracksloaded", applyPreference)
        const timeout = window.setTimeout(applyPreference, 0)

        return () => {
            window.clearTimeout(timeout)
            manager.removeEventListener("tracksloaded", applyPreference)
        }
    }, [subtitleManager, mediaCaptionsManager, preference, playbackId])

    return null
}

export function OnlinestreamPage({ animeEntry, animeEntryLoading, hideBackButton }: OnlinestreamPageProps) {
    const serverStatus = useAtomValue(serverStatusAtom)
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const urlMediaId = searchParams.get("id")
    const urlEpNumber = searchParams.get("episode")
    const media = animeEntry?.media!
    const mediaId = media?.id!
    const progress = animeEntry?.listData?.progress ?? 0

    const [episodeViewMode, setEpisodeViewMode] = useAtom(__onlineStream_episodeViewModeAtom)

    const playerRef = React.useRef<HTMLVideoElement | null>(null)

    const [currentEpisodeNumber, setSelectedEpisodeNumber] = useAtom(__onlinestream_selectedEpisodeNumberAtom)
    const [initializedMobileMedia, setInitializedMobileMedia] = React.useState<number | null>(null)
    const [preferredServer, setPreferredServer] = useAtom(__onlinestream_selectedServerAtom)
    const [server, setServer] = React.useState(preferredServer)
    const [quality, setQuality] = useAtom(__onlinestream_qualityAtom)
    const [dubbedPreferenceByMedia, setDubbedPreferenceByMedia] = useAtom(__onlinestream_dubbedPreferenceByMediaAtom)
    const [preferredProvider, setPreferredProvider] = useAtom(__onlinestream_selectedProviderAtom)
    const [provider, setProvider] = React.useState(preferredProvider)
    const [, setSubtitlePreferenceByMedia] = useAtom(__onlinestream_subtitlePreferenceByMediaAtom)
    const isLoadingFromWatchPartyRef = React.useRef(false)
    const dubbedPreferenceKey = mediaId ? String(mediaId) : null
    const dubbed = dubbedPreferenceKey ? dubbedPreferenceByMedia[dubbedPreferenceKey] ?? false : false
    const setDubbed = React.useCallback((update: boolean | ((prev: boolean) => boolean)) => {
        if (!dubbedPreferenceKey) return

        setDubbedPreferenceByMedia(prev => {
            const current = prev[dubbedPreferenceKey] ?? false
            const next = typeof update === "function" ? update(current) : update
            if (current === next && Object.prototype.hasOwnProperty.call(prev, dubbedPreferenceKey)) return prev

            return {
                ...prev,
                [dubbedPreferenceKey]: next,
            }
        })
    }, [dubbedPreferenceKey, setDubbedPreferenceByMedia])

    const previousPreferredProviderRef = React.useRef(preferredProvider)
    const previousPreferredServerRef = React.useRef(preferredServer)
    const previousMediaIdRef = React.useRef(mediaId)

    React.useEffect(() => {
        if (previousPreferredProviderRef.current === preferredProvider) return
        previousPreferredProviderRef.current = preferredProvider
        setProvider(preferredProvider)
    }, [preferredProvider])

    React.useEffect(() => {
        if (previousPreferredServerRef.current === preferredServer) return
        previousPreferredServerRef.current = preferredServer
        setServer(preferredServer)
    }, [preferredServer])

    React.useEffect(() => {
        if (previousMediaIdRef.current === mediaId) return
        previousMediaIdRef.current = mediaId
        if (isLoadingFromWatchPartyRef.current) return
        setProvider(preferredProvider)
        setServer(preferredServer)
    }, [mediaId, preferredProvider, preferredServer])

    const [overrideStreamType, setOverrideStreamType] = React.useState<VideoCore_VideoPlaybackInfo["streamType"] | null>(null)

    const [playbackError, setPlaybackError] = React.useState<string | null>(null)

    const { mutate: emptyCache, isPending: isEmptyingCache } = useOnlineStreamEmptyCache()

    // get extensions
    const { providerExtensions, providerExtensionOptions } = useHandleOnlinestreamProviderExtensions()
    const extension = React.useMemo(() => providerExtensions.find(p => p.id === provider), [providerExtensions, provider])
    const sourceDubbed = !!extension?.supportsDub && dubbed

    // Nakama Watch Party
    const nakamaStatus = useNakamaStatus()
    const { isPeer: isWatchPartyPeer } = useNakamaWatchParty()
    const { streamToLoad, onLoadedStream, removeParamsFromUrl, redirectToStream } = useNakamaOnlineStreamWatchParty()


    // Stream URL
    const [url, setUrl] = React.useState<string | null>(null)
    const [subtitleTracks, setSubtitleTracks] = React.useState<VideoCore_VideoPlaybackInfo["subtitleTracks"]>()

    React.useEffect(() => {
        return () => {
            setUrl(null)
        }
    }, [])

    React.useLayoutEffect(() => {
        if (!streamToLoad || !providerExtensionOptions?.length) return
        log.info("Watch party stream to load", { streamToLoad })
        if (streamToLoad.mediaId !== mediaId) {
            // redirectToStream(streamToLoad)
            return
        }

        // Check if we have the provider
        if (!providerExtensionOptions.some(p => p.value === streamToLoad.provider)) {
            log.warning("Provider not found in options", { providerExtensionOptions, provider: streamToLoad.provider })
            toast.error("Watch Party: The provider used by the host is not installed.")
            return
        }

        // Set flag to prevent other effects from overriding
        isLoadingFromWatchPartyRef.current = true

        setUrl(null)

        // Remove query params from the URL
        removeParamsFromUrl()

        setProvider(streamToLoad.provider)
        setDubbed(streamToLoad.dubbed)
        setServer(streamToLoad.server)
        setQuality(streamToLoad.quality)
        setSelectedEpisodeNumber(streamToLoad.episodeNumber)

        onLoadedStream()

        const t = setTimeout(() => {
            isLoadingFromWatchPartyRef.current = false
        }, 1000)
        return () => clearTimeout(t)
    }, [streamToLoad, providerExtensionOptions])

    // get the list of episodes from the provider
    const {
        data: episodeListResponse,
        isFetching: isFetchingEpisodeList,
        isLoading: isLoadingEpisodeList,
        isSuccess: isEpisodeListFetched,
        isError: isEpisodeListError,
        refetch: retryEpisodeList,
    } = useGetOnlineStreamEpisodeList(mediaId, provider, dubbed)

    const episodes = episodeListResponse?.episodes
    const currentEpisode = episodes?.find(e => e.number === currentEpisodeNumber)

    // AniSkip
    const { data: aniSkipData } = useSkipData(media.idMal, currentEpisode?.number)

    // get the current episode source from the provider
    const {
        data: episodeSource,
        isLoading: isLoadingEpisodeSource,
        isFetching: isFetchingEpisodeSource,
        isError: isErrorEpisodeSource,
        error: errorEpisodeSource,
        refetch: retryEpisodeSource,
    } = useGetOnlineStreamEpisodeSource(
        mediaId,
        provider,
        currentEpisodeNumber,
        sourceDubbed,
        !!mediaId && currentEpisodeNumber !== null && isEpisodeListFetched
            && (!IS_ANDROID_APP || initializedMobileMedia === mediaId && !!episodes?.some(e => e.number === currentEpisodeNumber)),
    )
    const { mutateAsync: refreshEpisodeSource } = useRefreshOnlineStreamEpisodeSource()

    const episodeListLoading = isFetchingEpisodeList || isLoadingEpisodeList
    const episodeLoading = isLoadingEpisodeSource || isFetchingEpisodeSource
    const selectionLock = React.useRef<number | null>(null)
    React.useEffect(() => { if (!episodeLoading) selectionLock.current = null }, [episodeLoading])
    const selectMobileEpisode = (number: number) => {
        if (episodeLoading || selectionLock.current === number || currentEpisodeNumber === number) return
        selectionLock.current = number
        rememberMobileEpisode(mediaId, number)
        setSelectedEpisodeNumber(number)
    }

    const autoProviderCycler = useOnlinestreamAutoProviderCycler({
        mediaId,
        provider,
        server,
        url,
        providerExtensions,
        dubbed,
        sourceDubbed,
        currentEpisodeNumber,
        episodeListResponse,
        episodeListLoading,
        isEpisodeListFetched,
        isEpisodeListError,
        episodeSource,
        episodeSourceLoading: episodeLoading,
        isEpisodeSourceError: isErrorEpisodeSource,
        playbackError,
        setProvider,
        setServer,
        setSelectedEpisodeNumber,
        setUrl,
        setPlaybackError,
        refreshEpisodeSource,
    })

    const serverStatuses = React.useMemo(() => episodeSource?.servers ?? [], [episodeSource?.servers])
    const selectedServerStatus = React.useMemo(() => serverStatuses.find(status => status.server === server), [serverStatuses, server])

    // Only real URLs may reach the player. Status-only entries are kept in the
    // separate server list so a discovered hoster remains selectable.
    const videoSources = React.useMemo(() => uniqBy(episodeSource?.videoSources?.filter(n =>
        n.server === server && !!n.url?.trim()),
        n => `${n.url}|${n.quality}|${n.server}`), [episodeSource?.videoSources, server])
    const hasMultipleVideoSources = React.useMemo(() => !!videoSources?.length && videoSources?.length > 1, [videoSources])

    // list of servers
    const servers = React.useMemo(() => {
        if (!episodeSource) {
            log.info("Updating servers, no episode source", [])
            return []
        }
        const servers = [
            ...serverStatuses.map((status) => status.server),
            ...(episodeSource?.videoSources ?? []).map((source) => source.server),
        ].filter((value): value is string => !!value?.trim())
        log.info("Updating servers", servers)
        return uniq(servers)
    }, [episodeSource?.videoSources, serverStatuses])

    // If the sources don't have the stored server, set it to the first one
    React.useLayoutEffect(() => {
        if (!!servers?.length && (!server || !servers.includes(server))) {
            setServer(servers[0])
        }
    }, [servers, server])

    // get the video source from the episode source
    // devnote: use videoSources instead of episodeSource.videoSources
    const videoSource = React.useMemo(() => {
        if (!episodeSource || !videoSources) return undefined

        let filtered = [...videoSources]
        console.log("Filtering video sources", { videoSources, server, quality })
        const normalizedQuality = _normalizeLabel(quality) // e.g. '720P - Group' -> '720p - group'
        const preferredResolution = getQualityResolution(quality) // e.g. '720p - group' -> '720p'

        log.info("Selecting video source", { normalizedQuality, preferredResolution, server })
        // If server is set, filter sources by server
        if (server && filtered.some(n => n.server === server)) {
            filtered = filtered.filter(s => s.server === server)
        }

        const hasExactQuality = normalizedQuality && filtered.some(n => _normalizeLabel(n.quality) === normalizedQuality)
        const hasPreferredResolution = preferredResolution && filtered.some(n => getQualityResolution(n.quality) === preferredResolution)
        const hasAuto = filtered.some(n => n.quality === "auto")

        log.info("Filtering video sources by quality", {
            hasExactQuality,
            hasAuto,
            hasPreferredResolution,
        })

        // If quality is set, filter sources by quality
        // Only filter by quality if the quality is present in the sources
        if (normalizedQuality && hasExactQuality) {
            filtered = filtered.filter(n => _normalizeLabel(n.quality) === normalizedQuality)
        } else if (preferredResolution && hasPreferredResolution) {
            filtered = filtered.filter(n => getQualityResolution(n.quality) === preferredResolution)
        } else if (hasAuto) {
            filtered = filtered.filter(n => n.quality.toLowerCase() === "auto" || n.quality.toLowerCase().includes("default"))
        } else {
            log.info("Choosing a quality")
            if (filtered.some(n => n.quality.includes("1080p"))) {
                filtered = filtered.filter(n => n.quality.includes("1080p"))
            } else if (filtered.some(n => n.quality.includes("720p"))) {
                filtered = filtered.filter(n => n.quality.includes("720p"))
            } else if (filtered.some(n => n.quality.includes("480p"))) {
                filtered = filtered.filter(n => n.quality.includes("480p"))
            } else if (filtered.some(n => n.quality.includes("360p"))) {
                filtered = filtered.filter(n => n.quality.includes("360p"))
            }

            if (filtered.some(n => n.quality.includes("default"))) {
                filtered = filtered.filter(n => n.quality.includes("default"))
            }
        }

        log.info("Selected video source", filtered[0])

        return filtered[0]
    }, [episodeSource, videoSources, server, quality])

    const [previousState, setPreviousState] = React.useState<{ currentTime: number, paused: boolean } | null>(null)

    React.useEffect(() => {
        setPreviousState(null)
        React.startTransition(() => {
            setPreviousState(null)
        })
    }, [currentEpisodeNumber, media])

    const { getHMACTokenQueryParam } = useServerHMACAuth()

    // update the stream URL when the video source changes
    React.useEffect(() => {
        (async () => {
            setPlaybackError(null)
            log.info("Changing stream URL using videoSource", { videoSource })
            setUrl(null)
            setSubtitleTracks(undefined)
            log.info("Setting stream URL to undefined")
            if (selectedServerStatus?.status === "unavailable") {
                setPlaybackError(selectedServerStatus.error || `${selectedServerStatus.server} is listed for this episode, but Seanime cannot play it directly.`)
                return
            }
            if (videoSource?.url) {
                setServer(videoSource.server)
                const headers = videoSource.headers
                const shouldProxy = !!headers && Object.keys(headers).length > 0
                const tokenQuery = shouldProxy ? await getHMACTokenQueryParam("/api/v1/proxy", "&") : ""
                const getUrl = (url: string) => shouldProxy ? getProxyUrl(getServerBaseUrl(), url, headers, tokenQuery) : url
                const _url = getUrl(videoSource.url)
                const _subtitleTracks = videoSource.subtitles?.map((sub, index) => ({
                    index: index,
                    label: sub.language,
                    src: getUrl(sub.url),
                    language: sub.language,
                    default: isDefaultSubtitleTrack(videoSource.subtitles ?? [], index),
                }))
                React.startTransition(() => {
                    (async () => {
                        // If the video source is unknown or we can't determine if it's a native video from the url,
                        // send a HEAD request to determine the content type
                        if (videoSource.type === "unknown" || !isValidVideoSourceType(videoSource.type) || (videoSource.type === "mp4" && !isNativeVideoExtension(
                            _url)) || (videoSource.type === "m3u8" && !isHLSSrc(_url))) {
                            log.warning("Verifying original video source type", videoSource)
                            if (await isProbablyHls(_url) === "hls") {
                                log.info("Detected HLS source type")
                                setOverrideStreamType("hls")
                            } else {
                                setOverrideStreamType(!isValidVideoSourceType(videoSource.type) ? "native" : null)
                            }
                        }
                        React.startTransition(() => {
                            log.info("Setting stream URL", { url: _url, quality, server, dubbed, provider })
                            setSubtitleTracks(_subtitleTracks)
                            setUrl(_url)
                        })
                    })()
                })
            }
        })()
    }, [videoSource, server, dubbed, provider, selectedServerStatus])

    const { currentPlaylist, playEpisode: playPlaylistEpisode, nextPlaylistEpisode, prevPlaylistEpisode } = usePlaylistManager()

    function savePreviousStateThen(cb: () => void) {
        setPreviousState({
            currentTime: playerRef.current?.currentTime ?? 0,
            paused: playerRef.current?.paused ?? true,
        })
        React.startTransition(() => {
            cb()
        })
    }

    const changeQuality = React.useCallback((source: VideoCore_VideoSource) => {
        savePreviousStateThen(() => {
            setQuality(source.resolution)
        })
    }, [videoSource])

    // Provider
    const changeProvider = React.useCallback((provider: string) => {
        savePreviousStateThen(() => {
            setPreferredProvider(provider)
            setProvider(provider)
        })
    }, [videoSource, setPreferredProvider])

    // Server
    const changeServer = React.useCallback((server: string) => {
        savePreviousStateThen(() => {
            setPreferredServer(server)
            setServer(server)
        })
    }, [videoSource, setPreferredServer])

    // Dubbed
    const toggleDubbed = React.useCallback(() => {
        savePreviousStateThen(() => {
            setDubbed((prev) => !prev)
        })
    }, [videoSource])

    /*
     * Set episode number on mount
     */
    const firstRenderRef = React.useRef(true)
    React.useEffect(() => {
        // Do not auto set the episode number if the user is in a watch party and is not the host
        if (isWatchPartyPeer) return

        // Do not auto set if we're loading from watch party
        if (isLoadingFromWatchPartyRef.current) {
            return
        }

        if (!!media && !!episodes?.length && (firstRenderRef.current || IS_ANDROID_APP && !episodes.some(e => e.number === currentEpisodeNumber))) {
            const episodeNumberFromURL = urlEpNumber ? Number(urlEpNumber) : undefined
            const progress = animeEntry?.listData?.progress ?? 0
            let episodeNumber = 1
            const episodeToWatch = episodes.find(e => e.number === progress + 1)
            if (episodeToWatch) {
                episodeNumber = episodeToWatch.number
            }
            const initialEpisode = IS_ANDROID_APP
                ? getMobileInitialEpisode(mediaId, episodes.map(e => e.number), progress, episodeNumberFromURL)
                : episodeNumberFromURL || episodeNumber || 1
            setSelectedEpisodeNumber(initialEpisode ?? null)
            setInitializedMobileMedia(mediaId)
            log.info("Setting episode number to", episodeNumberFromURL || episodeNumber || 1)
            firstRenderRef.current = false
        }
    }, [episodes, media, animeEntry?.listData, urlEpNumber, currentPlaylist, isWatchPartyPeer, currentEpisodeNumber])


    // Home "Continue" requests playback; consume it once the stream is ready.
    const { playNext, resetPlayNext } = usePlayNext()
    const resumeRequestedRef = React.useRef(false)
    const resumeFullscreenTimer = React.useRef<number | undefined>(undefined)
    React.useEffect(() => () => window.clearInterval(resumeFullscreenTimer.current), [])
    React.useEffect(() => {
        if (!IS_ANDROID_APP || !mediaId || playNext !== mediaId) return
        resetPlayNext()
        resumeRequestedRef.current = true
        // Fullscreen needs the tap's user activation, which expires after a few seconds:
        // request it on the player container (scoped player state is not readable here) as soon as it mounts.
        let tries = 0
        window.clearInterval(resumeFullscreenTimer.current)
        resumeFullscreenTimer.current = window.setInterval(() => {
            const container = getPlayerContainer()
            if (container && !document.fullscreenElement) void container.requestFullscreen().catch(() => {})
            if (container || ++tries > 40) window.clearInterval(resumeFullscreenTimer.current)
        }, 100)
    }, [playNext, mediaId])

    function onCanPlay() {
        if (IS_ANDROID_APP && currentEpisodeNumber !== null) rememberMobileEpisode(mediaId, currentEpisodeNumber)
        autoProviderCycler.onLoadedMetadata()
        if (resumeRequestedRef.current) {
            resumeRequestedRef.current = false
            const video = playerRef.current
            if (video?.paused) void video.play().catch(() => {})
            // Without fullscreen (activation expired) keep playing inline, in view.
            if (!document.fullscreenElement) video?.scrollIntoView({ block: "center" })
        }
        if (urlEpNumber) {
            const params = new URLSearchParams(searchParams.toString())
            params.delete("episode")
            router.replace(pathname + `?${params.toString()}`)
        }
    }

    const goToNextEpisode = useLatestFunction(() => {
        if (currentEpisodeNumber === null) return
        if (currentPlaylist) {
            playPlaylistEpisode("next", true)
            return
        }
        // check if the episode exists
        if (episodes?.find(e => e.number === currentEpisodeNumber + 1)) {
            setSelectedEpisodeNumber(currentEpisodeNumber + 1)
        }
    })

    const goToPreviousEpisode = useLatestFunction(() => {
        if (currentEpisodeNumber === null) return
        if (currentPlaylist) {
            playPlaylistEpisode("previous", true)
            return
        }
        if (currentEpisodeNumber > 1) {
            // check if the episode exists
            if (episodes?.find(e => e.number === currentEpisodeNumber - 1)) {
                setSelectedEpisodeNumber(currentEpisodeNumber - 1)
            }
        }
    })

    const handlePlayEpisode = useLatestFunction((which: "next" | "previous") => {
        if (IS_ANDROID_APP && (episodeLoading || selectionLock.current !== null)) return
        if (IS_ANDROID_APP && currentEpisodeNumber !== null && !currentPlaylist) {
            const target = currentEpisodeNumber + (which === "next" ? 1 : -1)
            if (!episodes?.some(e => e.number === target)) return
            selectionLock.current = target
            rememberMobileEpisode(mediaId, target)
        }
        setUrl(null)
        React.startTransition(() => {
            if (which === "next") {
                goToNextEpisode()
            } else {
                goToPreviousEpisode()
            }
        })
    })

    const useLibassRenderer = useAtomValue(vc_useLibassRendererAtom)

    const handleSubtitlePreferenceChange = React.useCallback((selection: { language?: string, label?: string } | null) => {
        if (!mediaId) return

        setSubtitlePreferenceByMedia(prev => ({
            ...prev,
            [String(mediaId)]: selection ? {
                language: selection.language,
                label: selection.label,
            } : {
                off: true,
            },
        }))
    }, [mediaId, setSubtitlePreferenceByMedia])

    /*
     * Handle fatal errors
     * This function is called when the player encounters a fatal error
     */
    const onFatalError = (reason: string) => {
        log.error("onFatalError", {
            reason: reason,
        })
        autoProviderCycler.onPlaybackError(reason)
    }

    const tryAllProvidersButton = autoProviderCycler.showButton ? <Button
        size="sm"
        rounded
        intent="warning-subtle"
        leftIcon={<LuRefreshCw className={autoProviderCycler.isTrying ? "text-xl animate-spin" : "text-xl"} />}
        onClick={() => autoProviderCycler.isTrying ? autoProviderCycler.cancel() : autoProviderCycler.tryAllProviders()}
    >
        {autoProviderCycler.isTrying ? "Cancel trying" : "Try all available providers"}
    </Button> : null

    const parameters = (
        <>
            {(IS_ANDROID_APP) && <>
                <EpisodeDownloadPicker media={media} episodes={episodes} provider={provider} server={server} quality={quality} dubbed={dubbed} currentEpisode={currentEpisodeNumber} />
                <Button size="sm" rounded intent="primary" disabled={!url || !videoSource || episodeLoading}
                    data-android-download-episode
                    onClick={() => {
                        if (!url || !videoSource) return
                        const queued = downloadOnAndroid({
                            key: `${mediaId}:${currentEpisodeNumber}:${provider}:${dubbed}:${quality}`,
                            url, type: overrideStreamType === "hls" || videoSource.type === "m3u8" || isHLSSrc(url) ? "m3u8" : "mp4",
                            title: media?.title?.userPreferred || media?.title?.romaji || "Anime",
                            episode: currentEpisodeNumber, mediaId, provider, quality: quality || "Auto",
                            description: media?.description, genres: media?.genres, year: media?.seasonYear,
                            format: media?.format, totalEpisodes: media?.episodes, duration: media?.duration, score: media?.meanScore,
                            coverUrl: media?.coverImage?.extraLarge || media?.coverImage?.large,
                            bannerUrl: media?.bannerImage,
                            episodeTitle: currentEpisode?.title || currentEpisode?.metadata?.episodeTitle,
                            episodeImageUrl: currentEpisode?.image || currentEpisode?.metadata?.episodeMetadata?.image,
                            episodeDescription: currentEpisode?.description || currentEpisode?.metadata?.episodeMetadata?.summary,
                            airDate: currentEpisode?.metadata?.episodeMetadata?.airDate,
                            audioLanguage: dubbed ? "de" : "ja",
                            subtitles: (subtitleTracks ?? []).filter(sub => !!sub.src).map((sub, index) => ({
                                url: sub.src, label: sub.label, language: sub.language,
                                default: sub.default,
                                mime: /\.(ass|ssa)(?:\?|$)/i.test(videoSource.subtitles?.[index]?.url || sub.src || "") ? "text/x-ssa"
                                    : /\.srt(?:\?|$)/i.test(videoSource.subtitles?.[index]?.url || sub.src || "") ? "application/x-subrip" : "text/vtt",
                            })),
                        })
                        if (!queued) toast.error(tr("Download feature is still loading. Please try again in a moment.", "Download-Funktion lädt noch. Bitte kurz erneut versuchen."))
                    }}
                >{tr("Download to phone", "Auf Handy herunterladen")}</Button>
                <Button size="sm" rounded intent="gray-basic" onClick={openAndroidDownloads}>Downloads</Button>
            </>}
            <Select
                aria-label={tr("Provider", "Provider")}
                contentClass={IS_ANDROID_APP ? "mobile-anime-select" : undefined}
                value={provider || ""}
                options={[
                    ...providerExtensionOptions,
                    {
                        value: "add-provider",
                        label: "Find other providers",
                    },
                ]}
                onValueChange={(v) => {
                    if (v === "add-provider") {
                        router.push(`/extensions?tab=marketplace&type=onlinestream-provider`)
                        return
                    }
                    changeProvider(v)
                }}
                placeholder="Select provider"
                size="sm"
                leftAddon={<CgMediaPodcast />}
                fieldClass="w-fit"
                className="rounded-full rounded-l-none w-fit"
                addonClass="rounded-full rounded-r-none"
            />
            {!!servers.length && <Select
                aria-label={tr("Server", "Server")}
                contentClass={IS_ANDROID_APP ? "mobile-anime-select" : undefined}
                size="sm"
                value={server}
                options={servers.map((server) => {
                    const status = serverStatuses.find(item => item.server === server)
                    return {
                        label: status?.status === "unavailable" ? `${server} (not directly playable)` : server,
                        value: server,
                    }
                })}
                onValueChange={(v) => {
                    changeServer(v)
                }}
                disabled={servers.length <= 1}
                fieldClass="w-fit"
                className="rounded-full w-fit !px-4"
                addonClass="rounded-full rounded-r-none"
            />}
            <IsomorphicPopover
                title="Stream"
                trigger={<Button
                    intent="gray-basic"
                    size="sm"
                    className="rounded-full"
                    leftIcon={<HiOutlineCog6Tooth className="text-xl" />}
                >
                    Cache
                </Button>}
            >
                <p className="text-sm text-[--muted]">
                    Empty the cache if you are experiencing issues with the stream.
                </p>
                <Button
                    size="sm"
                    intent="alert-subtle"
                    onClick={() => emptyCache({ mediaId: (mediaId!) })}
                    loading={isEmptyingCache}
                >
                    Empty stream cache
                </Button>
            </IsomorphicPopover>
        </>
    )

    if (!media || animeEntryLoading) return <div data-onlinestream-page-loading-container className="space-y-4">
        <div className="flex gap-4 items-center relative">
            <Skeleton className="h-12" />
        </div>
        <div
            className="grid 2xl:grid-cols-[1fr,450px] gap-4 xl:gap-4"
        >
            <div className="w-full min-h-[70dvh] relative">
                <Skeleton className="h-full w-full absolute" />
            </div>

            <Skeleton className="hidden 2xl:block relative h-[78dvh] overflow-y-auto pr-4 pt-0" />

        </div>
    </div>

    return (
        <>
            <VideoCoreInlineHelpers
                playerRef={playerRef}
                currentEpisodeNumber={currentEpisodeNumber}
                currentProgress={progress}
                media={media}
                url={url}
            />
            <VideoCoreInlineLayout
                mobileEntry={IS_ANDROID_APP}
                mediaId={mediaId ? Number(mediaId) : undefined}
                currentEpisodeNumber={currentEpisodeNumber}
                title={media?.title?.userPreferred}
                hideBackButton={hideBackButton}
                episodes={episodes}
                loadingEpisodeList={episodeListLoading}
                leftHeaderActions={IS_ANDROID_APP ? <details className="mobile-episode-options">
                    <summary>{tr("Sources & playback options", "Quellen & Wiedergabeoptionen")}{provider ? ` · ${providerExtensionOptions.find(p => p.value === provider)?.label || provider}` : ""}</summary>
                    <div>{parameters}{tryAllProvidersButton}
                        {animeEntry && provider && <OnlinestreamManualMappingModal entry={animeEntry} provider={provider}><Button intent="gray-basic">{tr("Manual match", "Manuell zuordnen")}</Button></OnlinestreamManualMappingModal>}
                        <Button intent="gray-basic" onClick={() => toggleDubbed()}>{dubbed ? tr("Switch to subs", "Zu Untertiteln wechseln") : tr("Switch to dub", "Zu Synchronfassung wechseln")}</Button>
                    </div>
                </details> : <>
                    {parameters}
                    {tryAllProvidersButton}
                    {(animeEntry && !!provider) && <OnlinestreamManualMappingModal entry={animeEntry} provider={provider}>
                        <Button
                            size="sm"
                            intent="gray-basic"
                            className="rounded-full"
                            leftIcon={<FaSearch className="" />}
                        >
                            Manual match
                        </Button>
                    </OnlinestreamManualMappingModal>}
                    <Button
                        className=""
                        rounded
                        intent="gray-basic"
                        size="sm"
                        leftIcon={!dubbed ? <LuSpeech className="text-xl" /> : <MdOutlineSubtitles className="text-xl" />}
                        onClick={() => toggleDubbed()}
                    >
                        {dubbed ? "Switch to subs" : "Switch to dub"}
                    </Button>
                    <div className="hidden lg:flex flex-1"></div>
                </>}
                rightHeaderActions={<>
                    <VideoCoreInlineHelperUpdateProgressButton />
                    <IconButton
                        size="sm"
                        intent={episodeViewMode === "list" ? "gray-basic" : "white-subtle"}
                        icon={<BsFillGrid3X3GapFill />}
                        onClick={() => setEpisodeViewMode(prev => prev === "list" ? "grid" : "list")}
                        title={episodeViewMode === "list" ? "Switch to grid view" : "Switch to list view"}
                    />
                </>}
                mediaPlayer={<>
                    {IS_ANDROID_APP && <div className="mobile-episode-heading">
                        <h2>{currentEpisodeNumber !== null ? `${tr("Episode", "Folge")} ${currentEpisodeNumber}` : tr("Episodes", "Episoden")}{currentEpisode?.title ? ` · ${currentEpisode.title}` : ""}</h2>
                        <p>{media.title?.userPreferred}</p>
                        <Button className="mobile-episode-play" loading={episodeLoading} disabled={!url || episodeLoading}
                            onClick={() => { if (playerRef.current?.paused) void playerRef.current.play().catch(() => toast.error(tr("Playback could not start. Try again.", "Wiedergabe konnte nicht starten. Erneut versuchen."))); playerRef.current?.scrollIntoView({ block: "center" }) }}>
                            {tr("Play / continue", "Abspielen / Fortsetzen")}
                        </Button>
                        <div className="mobile-episode-navigation">
                            <Button intent="gray-basic" disabled={episodeLoading || !episodes?.some(e => e.number === (currentEpisodeNumber ?? 0) - 1)} onClick={() => handlePlayEpisode("previous")}>{tr("Previous episode", "Vorherige Folge")}</Button>
                            <Button intent="gray-basic" disabled={episodeLoading || !episodes?.some(e => e.number === (currentEpisodeNumber ?? 0) + 1)} onClick={() => handlePlayEpisode("next")}>{tr("Next episode", "Nächste Folge")}</Button>
                        </div>
                    </div>}
                    {!provider ? (
                    <div className="flex items-center flex-col justify-center w-full h-full">
                        <LuffyError title="No provider selected" />
                        {!IS_ANDROID_APP && <div className="flex gap-2">{parameters}</div>}
                    </div>
                ) : isEpisodeListError ? <div role="alert"><LuffyError title="Provider error">Could not fetch episode list from provider.</LuffyError><Button onClick={() => retryEpisodeList()}>{tr("Retry", "Erneut versuchen")}</Button></div> : IS_ANDROID_APP && !episodeListLoading && !episodes?.length ? <p role="status">{tr("No episodes available from this provider. Choose another source above.", "Bei diesem Provider sind keine Folgen verfügbar. Wähle oben eine andere Quelle.")}</p> : (
                    <>
                        <VideoCoreProvider id="onlinestream">
                            <div data-onlinestream-video-container className="w-full aspect-video mx-auto border rounded-lg overflow-hidden">
                                <OnlinestreamAudioTrackPreferenceSync mediaId={mediaId} playbackId={url} />
                                <OnlinestreamSubtitlePreferenceSync mediaId={mediaId} playbackId={url} />
                                <VideoCore
                                    id="onlinestream"
                                    mRef={playerRef}
                                    state={{
                                        active: true,
                                        playbackInfo: !!url ? {
                                            id: url,
                                            playbackType: "onlinestream",
                                            streamUrl: url!,
                                            media: media,
                                            episode: currentEpisode?.metadata,
                                            playlistExternalEpisodeNumbers: episodes?.map(e => e.number),
                                            streamType: overrideStreamType
                                                ? overrideStreamType
                                                : ((url && isHLSSrc(url)) || videoSource?.type === "m3u8") ? "hls" : "native",
                                            subtitleTracks: subtitleTracks?.map(track => ({
                                                ...track,
                                                useLibassRenderer: useLibassRenderer,
                                            })),
                                            videoSources: hasMultipleVideoSources ? videoSources?.map((source, index) => ({
                                                index: index,
                                                label: source.label,
                                                src: source.url,
                                                resolution: source.quality,
                                            })) : undefined,
                                            selectedVideoSource: videoSources?.findIndex(source => source.quality === videoSource?.quality) ?? undefined,
                                            initialState: previousState ?? undefined,
                                            onlinestreamParams: {
                                                mediaId: mediaId!,
                                                episodeNumber: currentEpisodeNumber!,
                                                provider: provider,
                                                dubbed: dubbed,
                                                server: server || "",
                                                quality: quality || "",
                                            },
                                            disableRestoreFromContinuity: !!nakamaStatus?.currentWatchPartySession,
                                        } : null,
                                        playbackError: IS_ANDROID_APP && !episodeLoading && episodeSource && !videoSource
                                            ? tr("No playable source. Choose another server or provider.", "Keine abspielbare Quelle. Anderen Server oder Provider wählen.") : isErrorEpisodeSource
                                            ? (errorEpisodeSource as AxiosError<{ error: string }>)?.response?.data?.error ?? null
                                            : playbackError,
                                        loadingState: !url ? "Loading stream" : null,
                                    }}
                                    inline
                                    aniSkipData={aniSkipData}
                                    onLoadedMetadata={onCanPlay}
                                    onTimeUpdate={autoProviderCycler.onTimeUpdate}
                                    onError={v => onFatalError(v)}
                                    onStalled={v => autoProviderCycler.onPlaybackStalled(v)}
                                    onPlayEpisode={handlePlayEpisode}
                                    onVideoSourceChange={changeQuality}
                                    hlsPreferredQuality={quality}
                                    onHlsQualityChange={setQuality}
                                    onSubtitlePreferenceChange={handleSubtitlePreferenceChange}
                                    onHlsFatalError={(err) => onFatalError(`HLS error: ${err.error.message}`)}
                                    onTerminateStream={() => {
                                        setUrl(null)
                                        setPlaybackError("Stream terminated")
                                    }}
                                />
                            </div>
                        </VideoCoreProvider>
                    </>
                )}
                    {IS_ANDROID_APP && !episodeLoading && episodeSource && !videoSource && <p role="status">{tr("No playable source. Select a different server or provider.", "Keine abspielbare Quelle. Wähle einen anderen Server oder Provider.")}</p>}
                    {IS_ANDROID_APP && (isErrorEpisodeSource || playbackError || !episodeLoading && episodeSource && !videoSource) && <Button disabled={episodeLoading} onClick={() => retryEpisodeSource()}>{tr("Retry source", "Quelle erneut laden")}</Button>}
                </>}
                episodeList={<>
                    <AnimatePresence mode="wait" initial={false}>
                        {episodeViewMode === "list" ? (
                            <motion.div
                                key="list-view"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                transition={{ duration: 0.3 }}
                                className="space-y-3"
                            >
                                {episodes?.filter(Boolean)?.sort((a, b) => a!.number - b!.number)?.map((episode, idx) => {
                                    return (
                                        <EpisodeGridItem
                                            mobileEntry={IS_ANDROID_APP}
                                            key={idx + (episode.title || "") + episode.number}
                                            id={`episode-${String(episode.number)}`}
                                            onClick={() => IS_ANDROID_APP ? selectMobileEpisode(episode.number) : setSelectedEpisodeNumber(episode.number)}
                                            title={media.format === "MOVIE" ? "Complete movie" : `Episode ${episode.number}`}
                                            episodeTitle={episode.title}
                                            description={episode.description ?? undefined}
                                            image={episode.image}
                                            media={media}
                                            isSelected={episode.number === currentEpisodeNumber}
                                            disabled={episodeLoading}
                                            isWatched={progress ? episode.number <= progress : undefined}
                                            className="flex-none w-full"
                                            isFiller={episode.isFiller}
                                            episodeNumber={episode.number}
                                            watchedProgress={progress}
                                            progressNumber={episode.number}
                                            action={<>
                                                <MediaEpisodeInfoModal
                                                    mobileEntry={IS_ANDROID_APP}
                                                    title={media.format === "MOVIE" ? "Complete movie" : `Episode ${episode.number}`}
                                                    image={episode?.image}
                                                    episodeTitle={episode.title}
                                                    summary={episode?.description}
                                                />

                                                <PluginEpisodeGridItemMenuItems isDropdownMenu={true} type="onlinestream" episode={episode} />
                                            </>}
                                        />
                                    )
                                })}
                                {!!episodes?.length && <p className="text-center text-[--muted] py-2">End</p>}
                            </motion.div>
                        ) : (
                            <EpisodePillsGrid
                                key="grid-view"
                                episodes={episodes?.map(ep => ({
                                    id: String(ep.number),
                                    number: ep.number,
                                    title: ep.title,
                                    isFiller: ep.isFiller,
                                })) || []}
                                currentEpisodeNumber={currentEpisodeNumber}
                                onEpisodeSelect={IS_ANDROID_APP ? selectMobileEpisode : setSelectedEpisodeNumber}
                                progress={progress}
                                disabled={episodeLoading}
                                getEpisodeId={(ep) => `episode-${ep.number}`}
                            />
                        )}
                    </AnimatePresence>
                </>}
            />
        </>
    )
}


function IsomorphicPopover
(
    props: PopoverProps & ModalProps) {
    const { title, children, ...rest } = props
    const { width } = useWindowSize()

    if (width && width > 1024) {
        return <Popover
            {...rest}
            className="max-w-xl !w-full overflow-hidden space-y-2"
        >
            {children}
        </Popover>
    }

    return <Modal
        {...rest}
        title={title}
        contentClass={IS_ANDROID_APP ? "mobile-anime-dialog" : undefined}
    >
        {children}
    </Modal>
}
