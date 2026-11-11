import type { Anime_Entry, NativePlayer_PlaybackInfo, Onlinestream_Episode } from "@/api/generated/types"
import { CardMenu, type CardMenuAnchor } from "@/components/shared/card-menu"
import { forEpisodeType, usePluginActions, useRunPluginAction } from "@/main/_features/plugin/plugin-actions"
import { getServerBaseUrl } from "@/api/client/server-url"
import {
    useGetOnlineStreamEpisodeList,
    useGetOnlineStreamEpisodeSource,
    useOnlineStreamEmptyCache,
    useRefreshOnlineStreamEpisodeSource,
} from "@/api/hooks/onlinestream.hooks"
import { PhoneEmpty } from "@/components/shared/phone-cards"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Select } from "@/components/ui/select/select"
import { Dialog } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { useLatestFunction } from "@/lib/helpers/debug"
import { useRouter } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { atomWithStorage } from "@/lib/storage"
import { colors } from "@/lib/theme/tokens"
import { usePlayNext } from "@/main/_atoms/playback.atoms"
import { nativePlayer_initialState, nativePlayer_stateAtom } from "@/main/_features/native-player/native-player.atoms"
import { player_miniAtom, player_offlineItemAtom } from "@/main/_features/player/player.atoms"
import { PlayerBoxSlot } from "@/main/_features/player/player-box"
import { useServerHMACAuth } from "@/main/_hooks/use-server-status"
import { EpisodeRow, IconAction } from "@/main/entry/_containers/episode-list/episode-section"
import { WindowedRows } from "@/main/entry/_containers/episode-list/windowed-rows"
import { StreamPageSkeleton } from "@/main/entry/_containers/torrent-stream/_components/stream-page-skeleton"
import { EpisodeDownloadButton } from "@/main/onlinestream/_containers/episode-download-sheet"
import { OnlinestreamManualMappingSheet } from "@/main/onlinestream/_containers/onlinestream-manual-matching"
import { useHandleOnlinestreamProviderExtensions } from "@/main/onlinestream/_lib/handle-onlinestream-providers"
import { getMobileInitialEpisode, rememberMobileEpisode } from "@/main/onlinestream/_lib/mobile-episode-selection"
import { type OnlinePlayerEvents, player_onlineAtom } from "@/main/onlinestream/_lib/onlinestream-player.atoms"
import {
    buildOnlineStream,
    chooseVideoSource,
    episodeServers,
    needsProxy,
    onlineDownloadRequest,
    type OnlineStream,
    playableVideoSources,
} from "@/main/onlinestream/_lib/onlinestream-source"
import {
    __onlinestream_dubbedPreferenceByMediaAtom,
    __onlinestream_qualityAtom,
    __onlinestream_selectedProviderAtom,
    __onlinestream_selectedServerAtom,
    __onlinestream_subtitlePreferenceByMediaAtom,
} from "@/main/onlinestream/_lib/onlinestream.atoms"
import { useOnlinestreamAutoProviderCycler } from "@/main/onlinestream/_lib/use-onlinestream-auto-provider-cycler"
import { usePlaylistManager } from "@/main/_features/playlists/_containers/global-playlist-manager"
import { playlistNavigation } from "@/main/_features/playlists/lib/mobile-playlist-state"
import type { AxiosError } from "axios"
import { Image } from "expo-image"
import { useLocalSearchParams } from "expo-router"
import { useSetRouteParams } from "@/lib/route-params"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import ChevronLeft from "lucide-react-native/icons/chevron-left"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Ellipsis from "lucide-react-native/icons/ellipsis"
import Grid3x3 from "lucide-react-native/icons/grid-3x3"
import Play from "lucide-react-native/icons/play"
import Puzzle from "lucide-react-native/icons/puzzle"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import Settings from "lucide-react-native/icons/settings"
import React from "react"
import { ActivityIndicator, Pressable, View } from "react-native"

/*
 * The online streaming source of an anime page (web onlinestream-page.tsx, Android layout of mobile-anime.css): provider +
 * server as one joined pair, Sub/Dub and Download on one line, "Try all providers", Manual match, Cache and the list/grid
 * switch as quiet actions; the current episode with previous/next, then the provider's episodes.
 * The web page had an inline player; here the 16:9 card is the box the app's player (E3, one over every page) plays in
 * (r22, player-box.tsx): a tap on the card, an episode or previous/next plays in the box, its bottom-right button makes
 * it fullscreen and back; "Continue" from Home starts fullscreen (2.0.x too). Opening the page only picks the episode
 * (getMobileInitialEpisode). The auto provider cycler, the 15 s provider and 20 s playback limits and
 * the subtitle preference work as on the web; the player reports load, time and errors back (OnlinePlayerEvents).
 * The plugins' items for online episodes (type "onlinestream") open from a list row's ⋯ (2.17). Not here: the Nakama
 * watch party (2.13).
 */
const onlineEpisodeItems = forEpisodeType("onlinestream")

/** List or grid of episode numbers (web "sea-onlinestream-episode-view-mode") */
const __onlinestream_episodeViewModeAtom = atomWithStorage<"list" | "grid">("sea-onlinestream-episode-view-mode", "list")

const EXTENSIONS_MARKETPLACE = "/extensions?tab=marketplace&type=onlinestream-provider"

const onlineEpisodeKey = (episode: Onlinestream_Episode) => `${episode.number}-${episode.title ?? ""}`
/** EpisodeRow with a two-line title: 11 + 56 + 11 dp and the line below (only until the first rows were measured) */
const ONLINE_ROW_ESTIMATE = 80

export function OnlinestreamPage({ entry, bottomSection }: { entry: Anime_Entry, bottomSection?: React.ReactNode }) {
    const t = useTr()
    const router = useRouter()
    const media = entry.media!
    const mediaId = entry.mediaId
    const progress = entry.listData?.progress ?? 0

    const [viewMode, setViewMode] = useAtom(__onlinestream_episodeViewModeAtom)
    const pluginItems = usePluginActions("episodeGridItems", onlineEpisodeItems)
    const runPlugin = useRunPluginAction()
    const [pluginMenu, setPluginMenu] = React.useState<{ anchor: CardMenuAnchor, episode: Onlinestream_Episode, title: string } | null>(null)
    // The chosen episode belongs to its anime (web __onlinestream_selectedEpisodeNumberAtom + initializedMobileMedia)
    const [selection, setSelection] = React.useState<{ mediaId: number, episode: number | null } | null>(null)
    const currentEpisodeNumber = selection?.mediaId === mediaId ? selection.episode : null
    const initializedMedia = selection?.mediaId ?? null
    const setSelectedEpisodeNumber = React.useCallback((episode: number | null) => setSelection({ mediaId, episode }), [mediaId])
    // A running playlist opens its online episode with ?episode= (global-playlist-manager "play-episode", web urlEpNumber)
    const setRouteParams = useSetRouteParams()
    const { episode: urlEpisodeParam } = useLocalSearchParams<{ episode?: string }>()
    const urlEpisode = urlEpisodeParam ? Number(urlEpisodeParam) : undefined
    const { currentPlaylist, nextPlaylistEpisode, prevPlaylistEpisode, playEpisode: playPlaylistEpisode } = usePlaylistManager()
    const [preferredServer, setPreferredServer] = useAtom(__onlinestream_selectedServerAtom)
    const [server, setServer] = React.useState(preferredServer)
    const [quality, setQuality] = useAtom(__onlinestream_qualityAtom)
    const [dubbedByMedia, setDubbedByMedia] = useAtom(__onlinestream_dubbedPreferenceByMediaAtom)
    const [preferredProvider, setPreferredProvider] = useAtom(__onlinestream_selectedProviderAtom)
    const [provider, setProvider] = React.useState(preferredProvider)
    const [subtitlePreferences, setSubtitlePreferences] = useAtom(__onlinestream_subtitlePreferenceByMediaAtom)
    // The stream is built only while the player has (or wants) this page's stream
    const [active, setActive] = React.useState(false)
    const dubbed = dubbedByMedia[String(mediaId)] ?? false
    const setDubbed = React.useCallback((next: boolean) => {
        setDubbedByMedia(previous => (previous[String(mediaId)] ?? false) === next && Object.prototype.hasOwnProperty.call(previous, String(mediaId))
            ? previous : { ...previous, [String(mediaId)]: next })
    }, [mediaId, setDubbedByMedia])

    // The stored provider/server follow a change elsewhere; another anime starts from them again
    const [syncedProvider, setSyncedProvider] = React.useState(preferredProvider)
    if (syncedProvider !== preferredProvider) {
        setSyncedProvider(preferredProvider)
        setProvider(preferredProvider)
    }
    const [syncedServer, setSyncedServer] = React.useState(preferredServer)
    if (syncedServer !== preferredServer) {
        setSyncedServer(preferredServer)
        setServer(preferredServer)
    }
    // Another anime on the same page (relations): its stream is not playing yet; the player keeps the old one (detached below)
    const [syncedMedia, setSyncedMedia] = React.useState(mediaId)
    if (syncedMedia !== mediaId) {
        setSyncedMedia(mediaId)
        setProvider(preferredProvider)
        setServer(preferredServer)
        setActive(false)
    }

    const { mutate: emptyCache, isPending: emptyingCache } = useOnlineStreamEmptyCache()
    const [cacheOpen, setCacheOpen] = React.useState(false)
    const [matchOpen, setMatchOpen] = React.useState(false)

    const { providerExtensions, providerExtensionOptions } = useHandleOnlinestreamProviderExtensions()
    const extension = providerExtensions.find(p => p.id === provider)
    const sourceDubbed = !!extension?.supportsDub && dubbed
    // bumped to build the stream URL again from an unchanged source (after a source refresh)
    const [streamReload, setStreamReload] = React.useState(0)
    const [startSeconds, setStartSeconds] = React.useState<number | undefined>(undefined)
    const lastTimeRef = React.useRef(0)

    const {
        data: episodeListResponse,
        isFetching: fetchingEpisodeList,
        isLoading: loadingEpisodeList,
        isSuccess: episodeListFetched,
        isError: episodeListError,
        refetch: retryEpisodeList,
    } = useGetOnlineStreamEpisodeList(mediaId, provider, dubbed)
    const episodes = episodeListResponse?.episodes
    const sortedEpisodes = React.useMemo(() => [...(episodes ?? [])].filter(Boolean).sort((a, b) => a.number - b.number), [episodes])
    const currentEpisode = episodes?.find(e => e.number === currentEpisodeNumber)
    // Opening the page (or a list without the chosen episode) picks the episode only: the one in the link, the one chosen
    // this session, the next to watch, the first (getMobileInitialEpisode)
    if (episodes?.length && (initializedMedia !== mediaId || !currentEpisode)) {
        setSelection({ mediaId, episode: getMobileInitialEpisode(mediaId, episodes.map(e => e.number), progress, urlEpisode) ?? null })
    }

    const {
        data: episodeSource,
        isLoading: loadingEpisodeSource,
        isFetching: fetchingEpisodeSource,
        isError: episodeSourceError,
        error: episodeSourceErrorValue,
        refetch: retryEpisodeSource,
    } = useGetOnlineStreamEpisodeSource(
        mediaId,
        provider,
        currentEpisodeNumber,
        sourceDubbed,
        !!mediaId && currentEpisodeNumber !== null && episodeListFetched
            && initializedMedia === mediaId && !!episodes?.some(e => e.number === currentEpisodeNumber),
    )
    const { mutateAsync: refreshEpisodeSource } = useRefreshOnlineStreamEpisodeSource()

    const episodeListLoading = fetchingEpisodeList || loadingEpisodeList
    const episodeLoading = loadingEpisodeSource || fetchingEpisodeSource
    // one selection at a time while its source loads; a cached source frees it right away
    const selectionLock = React.useRef<number | null>(null)
    React.useEffect(() => {
        if (!episodeLoading) selectionLock.current = null
    }, [episodeLoading, currentEpisodeNumber])

    const serverStatuses = React.useMemo(() => episodeSource?.servers ?? [], [episodeSource?.servers])
    const selectedServerStatus = serverStatuses.find(status => status.server === server)
    const videoSources = React.useMemo(() => playableVideoSources(episodeSource, server), [episodeSource, server])
    const servers = React.useMemo(() => episodeServers(episodeSource), [episodeSource])
    const videoSource = React.useMemo(() => episodeSource ? chooseVideoSource(videoSources, server, quality) : undefined, [episodeSource, videoSources, server, quality])

    // A server the sources do not have gives way to the first one
    if (servers.length && (!server || !servers.includes(server))) setServer(servers[0])

    // The stream for the source (web: the stream URL effect), only while playing. Each playable source has a key; the
    // URL built for an older key is not used, so a new source starts at "Loading stream" like the web's setUrl(null).
    const unavailable = active && selectedServerStatus?.status === "unavailable"
    const streamKey = active && !unavailable && videoSource?.url
        ? `${provider}|${dubbed}|${videoSource.server}|${videoSource.quality}|${videoSource.url}|${streamReload}` : null
    const [built, setBuilt] = React.useState<{ key: string, stream: OnlineStream } | null>(null)
    const stream = built && built.key === streamKey ? built.stream : null
    const url = stream?.url ?? null
    const subtitleTracks = stream?.subtitles
    // the cycler clears the URL to show "Loading stream" until the next candidate is built
    const setUrl = React.useCallback((value: string | null) => {
        if (value === null) setBuilt(null)
    }, [])

    // A playback error belongs to the source it happened with (web: reset with every new source)
    const sourceKey = `${provider}|${server}|${dubbed}|${currentEpisodeNumber}|${videoSource?.url ?? ""}|${streamReload}`
    const sourceKeyRef = React.useRef(sourceKey)
    React.useLayoutEffect(() => {
        sourceKeyRef.current = sourceKey
    })
    const [errorState, setErrorState] = React.useState<{ key: string, message: string } | null>(null)
    const setPlaybackError = React.useCallback((message: string | null) => {
        setErrorState(message ? { key: sourceKeyRef.current, message } : null)
    }, [])
    const playbackError = unavailable
        ? selectedServerStatus?.error || t(`${selectedServerStatus?.server} is listed for this episode, but Seanime cannot play it directly.`,
            `${selectedServerStatus?.server} ist für diese Folge gelistet, Seanime kann den Server aber nicht direkt abspielen.`)
        : errorState?.key === sourceKey ? errorState.message : null

    // Through the server's proxy when the provider needs headers (the token goes into that URL only)
    const { getHMACTokenQueryParam } = useServerHMACAuth()
    const tokenQuery = useLatestFunction(getHMACTokenQueryParam)
    React.useEffect(() => {
        if (!streamKey || !videoSource) return
        let cancelled = false
        const source = videoSource
        void (async () => {
            const query = needsProxy(source) ? await tokenQuery("/api/v1/proxy", "&") : ""
            if (!cancelled) setBuilt({ key: streamKey, stream: buildOnlineStream(source, getServerBaseUrl(), query) })
        })()
        return () => {
            cancelled = true
        }
    }, [streamKey, videoSource, tokenQuery])

    const cycler = useOnlinestreamAutoProviderCycler({
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
        isEpisodeListFetched: episodeListFetched,
        isEpisodeListError: episodeListError,
        episodeSource,
        episodeSourceLoading: episodeLoading,
        isEpisodeSourceError: episodeSourceError,
        playbackError,
        setProvider,
        setServer,
        setSelectedEpisodeNumber,
        setUrl,
        reloadStream: () => setStreamReload(n => n + 1),
        setPlaybackError,
        refreshEpisodeSource,
    })

    // ── Starting playback: one player over all pages, so a saved episode or a server stream makes way ──
    const setNativePlayerState = useSetAtom(nativePlayer_stateAtom)
    const setOfflineItem = useSetAtom(player_offlineItemAtom)
    const setSmall = useSetAtom(player_miniAtom)
    // r22: a tap on the page plays in the box (small), "Continue" and a playlist start fullscreen, the player's own
    // previous/next keeps whatever size it has
    const start = useLatestFunction((resumeAt?: number, size: "box" | "full" | "keep" = "box") => {
        setOfflineItem(null)
        setNativePlayerState(nativePlayer_initialState)
        if (size !== "keep") setSmall(size === "box")
        setStartSeconds(resumeAt)
        setErrorState(null)
        lastTimeRef.current = 0
        setActive(true)
    })


    // Home "Continue" opened this anime: play once the episode is picked
    const { playNext, resetPlayNext } = usePlayNext()
    React.useEffect(() => {
        if (!mediaId || playNext !== mediaId || initializedMedia !== mediaId) return
        resetPlayNext()
        start(undefined, "full")
    }, [playNext, mediaId, initializedMedia, resetPlayNext, start])

    // set while a playlist's next episode waits for the player to close (below the player's events)
    const [startWhenClosed, setStartWhenClosed] = React.useState(false)

    const selectEpisode = (number: number) => {
        if (number === currentEpisodeNumber) {
            start()
            return
        }
        if (episodeLoading || selectionLock.current === number) return
        selectionLock.current = number
        rememberMobileEpisode(mediaId, number)
        setSelectedEpisodeNumber(number)
        start()
    }

    const handlePlayEpisode = useLatestFunction((which: "next" | "previous", fromPage = true) => {
        // a running playlist decides what comes next (web goToNextEpisode/goToPreviousEpisode)
        if (currentPlaylist) {
            playlistNavigation(nextPlaylistEpisode, prevPlaylistEpisode, playPlaylistEpisode).playEpisode(which)
            return
        }
        if (episodeLoading || selectionLock.current !== null || currentEpisodeNumber === null) return
        const target = currentEpisodeNumber + (which === "next" ? 1 : -1)
        if (!episodes?.some(e => e.number === target)) return
        selectionLock.current = target
        rememberMobileEpisode(mediaId, target)
        setUrl(null)
        setSelectedEpisodeNumber(target)
        start(undefined, fromPage ? "box" : "keep")
    })

    // A change of provider/server/audio while it plays carries on at the same place (web savePreviousStateThen)
    const resumeIfPlaying = () => (active ? lastTimeRef.current : undefined)
    const changeProvider = (value: string) => {
        if (value === "add-provider") {
            router.push(EXTENSIONS_MARKETPLACE)
            return
        }
        setStartSeconds(resumeIfPlaying())
        setPreferredProvider(value)
        setProvider(value)
    }
    const changeServer = (value: string) => {
        setStartSeconds(resumeIfPlaying())
        setPreferredServer(value)
        setServer(value)
    }
    const changeDubbed = (next: boolean) => {
        if (next === dubbed) return
        setStartSeconds(resumeIfPlaying())
        setDubbed(next)
    }

    // ── What the player reports back ──
    const eventsRef = React.useRef<OnlinePlayerEvents | null>(null)
    React.useLayoutEffect(() => {
        eventsRef.current = {
            loaded: () => {
                if (currentEpisodeNumber !== null) rememberMobileEpisode(mediaId, currentEpisodeNumber)
                setStartWhenClosed(false)
                cycler.onLoadedMetadata()
            },
            time: seconds => {
                lastTimeRef.current = seconds
                cycler.onTimeUpdate(seconds)
            },
            // a stream that played already shows its error; one that never started goes to the cycler (refresh, next)
            error: reason => {
                if (lastTimeRef.current >= 1) setPlaybackError(reason)
                else cycler.onPlaybackError(reason)
            },
            playEpisode: which => handlePlayEpisode(which, false),
            quality: value => {
                setStartSeconds(lastTimeRef.current)
                setQuality(value)
            },
            subtitle: choice => setSubtitlePreferences(previous => ({
                ...previous,
                [String(mediaId)]: choice ? { language: choice.language, label: choice.label } : { off: true },
            })),
            closed: () => {
                setActive(false)
                setUrl(null)
                setStartSeconds(undefined)
                if (cycler.isTrying) cycler.cancel()
            },
        }
    })

    // The playlist's episode from the link (also while this page is already open): pick it, play it while the playlist
    // runs, then drop the parameter so the same episode can be asked for again (web removed it onCanPlay).
    // Before a playlist's online episode the server ends the running player session (playlist/manager.go playEpisode →
    // Terminate) and the player closes asynchronously: an episode of this page that is still in the player starts again
    // once the player has closed, or plays on in the same player if no session was ended (then "loaded" clears the wait).
    const onlineInPlayer = useAtomValue(player_onlineAtom)
    const openLinkedEpisode = useLatestFunction((number: number) => {
        setRouteParams({ episode: undefined })
        if (!episodes?.some(e => e.number === number)) return
        rememberMobileEpisode(mediaId, number)
        setSelectedEpisodeNumber(number)
        if (!currentPlaylist) return
        if (active && onlineInPlayer?.events === eventsRef) setStartWhenClosed(true)
        else start(undefined, "full")
    })
    React.useEffect(() => {
        if (urlEpisode !== undefined && episodes?.length) openLinkedEpisode(urlEpisode)
    }, [urlEpisode, episodes, openLinkedEpisode])
    const startAfterClose = useLatestFunction(() => {
        setStartWhenClosed(false)
        start(undefined, "full")
    })
    React.useEffect(() => {
        if (startWhenClosed && !onlineInPlayer) startAfterClose()
    }, [startWhenClosed, onlineInPlayer, startAfterClose])
    // ── The player's view of this stream ──
    const sourceFailure = !episodeLoading && episodeSource && !videoSource
        ? t("No playable source. Choose another server or provider.", "Keine abspielbare Quelle. Anderen Server oder Provider wählen.")
        : episodeSourceError
            ? (episodeSourceErrorValue as AxiosError<{ error: string }> | null)?.response?.data?.error ?? null
            : playbackError
    const shownError = cycler.isTrying ? null : sourceFailure
    const info = React.useMemo<NativePlayer_PlaybackInfo>(() => ({
        id: url ? `${url}#${streamReload}` : `online:${mediaId}:${currentEpisodeNumber ?? ""}`,
        // the server files it as "onlinestream" (PlayerScreen online → usePlayerServer origin); "url" is the nearest stream kind
        streamType: "url",
        streamPath: "",
        mimeType: "",
        streamUrl: url ?? "",
        contentLength: 0,
        subtitleTracks: subtitleTracks?.map(sub => ({ index: sub.index, src: sub.src, label: sub.label, language: sub.language, default: sub.default })),
        entryListData: entry.listData,
        episode: currentEpisode?.metadata,
        media,
        isNakamaWatchParty: false,
    }), [url, streamReload, mediaId, currentEpisodeNumber, subtitleTracks, entry.listData, currentEpisode?.metadata, media])
    const qualities = React.useMemo(() => [...new Set(videoSources.map(source => source.quality))], [videoSources])
    // memoised: the player atom below is written whenever one of its values changes
    const download = React.useMemo(() => currentEpisode && videoSource ? onlineDownloadRequest({ media, episode: currentEpisode, source: videoSource, dubbed }) : null,
        [currentEpisode, videoSource, media, dubbed])
    const hasPrevious = currentEpisodeNumber !== null && !!episodes?.some(e => e.number === currentEpisodeNumber - 1)
    const hasNext = currentEpisodeNumber !== null && !!episodes?.some(e => e.number === currentEpisodeNumber + 1)
    const loadingState = url ? null : cycler.isTrying ? t("Trying providers …", "Provider werden probiert …") : t("Loading stream", "Stream wird geladen")

    const setOnline = useSetAtom(player_onlineAtom)
    React.useEffect(() => {
        if (!active || currentEpisodeNumber === null) return
        setOnline({
            info,
            params: { mediaId, episodeNumber: currentEpisodeNumber, provider: provider ?? "", server: server ?? "", quality: quality ?? "", dubbed },
            reload: streamReload,
            startSeconds,
            loadingState,
            playbackError: shownError,
            hasNext,
            hasPrevious,
            qualities,
            quality: videoSource?.quality,
            subtitlePreference: subtitlePreferences[String(mediaId)],
            download,
            events: eventsRef,
        })
    }, [active, info, mediaId, currentEpisodeNumber, provider, server, quality, dubbed, streamReload, startSeconds, loadingState, shownError, hasNext,
        hasPrevious, qualities, videoSource?.quality, subtitlePreferences, download, setOnline])

    // Another anime opened on this page: the stream of the one before keeps playing, without this page's controls
    const attachedMedia = React.useRef(mediaId)
    React.useEffect(() => {
        if (attachedMedia.current === mediaId) return
        attachedMedia.current = mediaId
        setOnline(current => current?.events === eventsRef ? { ...current, hasNext: false, hasPrevious: false, events: { current: null } } : current)
    }, [mediaId, setOnline])
    // Leaving the anime page: the same, the stream plays on (mini player) without previous/next
    React.useEffect(() => () => {
        eventsRef.current = null
        setOnline(current => current?.events === eventsRef ? { ...current, hasNext: false, hasPrevious: false } : current)
    }, [setOnline])

    // ── Page ──
    const playing = useAtomValue(player_onlineAtom)?.events === eventsRef && active

    const sourceOptions = <View accessibilityLabel={t("Sources & playback options", "Quellen & Wiedergabeoptionen")} className="gap-2 pb-3 pt-4">
            <View accessibilityLabel={t("Source", "Quelle")} className="flex-row flex-wrap overflow-hidden rounded-surface-sm" style={{ gap: 2 }}>
                <View className="min-w-[136px] flex-1">
                    <Select accessibilityLabel={t("Provider", "Provider")} value={provider || ""} placeholder={t("Select provider", "Provider wählen")}
                        options={[...providerExtensionOptions, { value: "add-provider", label: t("Find other providers", "Weitere Provider finden") }]}
                        onValueChange={changeProvider} className="rounded-none" />
                </View>
                {!!servers.length && <View className="min-w-[136px] flex-1">
                    <Select accessibilityLabel={t("Server", "Server")} value={server} placeholder={t("Server", "Server")} disabled={servers.length <= 1}
                        options={servers.map(name => {
                            const status = serverStatuses.find(item => item.server === name)
                            return { value: name, label: status?.status === "unavailable" ? t(`${name} (not directly playable)`, `${name} (nicht direkt abspielbar)`) : name }
                        })}
                        onValueChange={changeServer} />
                </View>}
            </View>
            <View className="flex-row flex-wrap gap-2">
                <View accessibilityRole="radiogroup" accessibilityLabel={t("Audio", "Audio")} className="min-w-[176px] flex-1 flex-row rounded-surface-sm bg-sm-surface-sunken">
                    {([false, true] as const).map(dub => {
                        const on = dub === dubbed
                        return <Pressable key={String(dub)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                            accessibilityLabel={dub ? t("Dub", "Synchro") : t("Subtitles", "Untertitel")} onPress={() => changeDubbed(dub)}
                            className="min-h-12 flex-1 p-1">
                            <View className={cn("flex-1 items-center justify-center rounded-surface-sm", on && "bg-sm-surface-control")}>
                                <Text className={cn("text-sm", on ? "font-semibold text-sm-text" : "font-medium text-sm-text-muted")}>{dub ? t("Dub", "Synchro") : "Sub"}</Text>
                            </View>
                        </Pressable>
                    })}
                </View>
                <EpisodeDownloadButton media={media} episodes={episodes} provider={provider} server={server} quality={quality} dubbed={dubbed}
                    currentEpisode={currentEpisodeNumber} />
            </View>
            <View className="-mx-2 flex-row flex-wrap items-center">
                {cycler.showButton && <QuietAction icon={RefreshCw} tone="warning" disabled={false}
                    label={cycler.isTrying ? t("Cancel trying", "Abbrechen") : t("Try all available providers", "Alle verfügbaren Provider probieren")}
                    onPress={() => {
                        if (cycler.isTrying) {
                            cycler.cancel()
                            return
                        }
                        cycler.tryAllProviders()
                        // the trial needs the player: a provider counts as working once its stream plays
                        start()
                    }} />}
                {!!provider && <QuietAction label={t("Manual match", "Manuell zuordnen")} onPress={() => setMatchOpen(true)} />}
                <QuietAction icon={Settings} label={t("Cache", "Cache")} onPress={() => setCacheOpen(true)} />
                <View className="flex-1" />
                <Pressable accessibilityRole="togglebutton" accessibilityState={{ checked: viewMode === "grid" }}
                    accessibilityLabel={viewMode === "list" ? t("Switch to grid view", "Zur Rasteransicht wechseln") : t("Switch to list view", "Zur Listenansicht wechseln")}
                    onPress={() => setViewMode(mode => mode === "list" ? "grid" : "list")}
                    className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-raised">
                    <Grid3x3 size={20} color={viewMode === "grid" ? colors.smAccent : colors.smTextMuted} />
                </Pressable>
            </View>
        </View>

    if (loadingEpisodeList && !episodes) return <View>
        {sourceOptions}
        <StreamPageSkeleton />
    </View>

    const heading = currentEpisodeNumber !== null ? `${t("Episode", "Folge")} ${currentEpisodeNumber}` : t("Episodes", "Episoden")
    const card = currentEpisode?.image || currentEpisode?.metadata?.episodeMetadata?.image || media.bannerImage || media.coverImage?.extraLarge || media.coverImage?.large

    return <View className="min-w-0">
        {sourceOptions}

        <View className="mb-2 mt-1 flex-row items-center gap-2">
            <Text numberOfLines={2} className="min-w-0 flex-1 text-[17px] font-bold leading-[23px]">{heading}{currentEpisode?.title ? ` · ${currentEpisode.title}` : ""}</Text>
            <View className="flex-row overflow-hidden rounded-surface-sm" style={{ gap: 2 }}>
                <NavButton label={t("Previous episode", "Vorherige Folge")} disabled={episodeLoading || !hasPrevious} onPress={() => handlePlayEpisode("previous")}>
                    <ChevronLeft size={20} color={colors.smText} />
                </NavButton>
                <NavButton label={t("Next episode", "Nächste Folge")} disabled={episodeLoading || !hasNext} onPress={() => handlePlayEpisode("next")}>
                    <ChevronRight size={20} color={colors.smText} />
                </NavButton>
            </View>
        </View>

        {!provider ? <PhoneEmpty title={t("No streaming provider", "Kein Streaming-Anbieter")}
            text={t("Install a streaming provider under Extensions to watch here.", "Installiere unter Erweiterungen einen Streaming-Anbieter, um hier zu schauen.")}>
            <Button leftIcon={<Puzzle size={18} color="#fff" />} onPress={() => router.push(EXTENSIONS_MARKETPLACE)}>{t("Open Extensions", "Erweiterungen öffnen")}</Button>
        </PhoneEmpty> : episodeListError ? <View accessibilityRole="alert"><PhoneEmpty title={t("Provider error", "Anbieter-Fehler")}
            text={t("Could not fetch the episode list from the provider.", "Die Folgenliste konnte nicht vom Anbieter geladen werden.")}>
            <Button leftIcon={<RefreshCw size={18} color="#fff" />} onPress={() => retryEpisodeList()}>{t("Try again", "Erneut versuchen")}</Button>
        </PhoneEmpty></View> : !episodeListLoading && !episodes?.length ? <View accessibilityRole="summary"><PhoneEmpty title={t("No episodes from this provider", "Keine Folgen bei diesem Anbieter")}
            text={t("Choose another source above.", "Wähle oben eine andere Quelle.")} /></View> : <>
            {/* The web's inline player (r22): the box the player lies over while this page's stream plays; before that the
                episode with a play button and what the source is doing */}
            <PlayerBoxSlot owner="online" active={playing} className="aspect-video w-full overflow-hidden rounded-surface bg-sm-surface-raised">
            <Pressable accessibilityRole="button" accessibilityLabel={`${t("Play", "Abspielen")}: ${heading}`} disabled={currentEpisodeNumber === null}
                onPress={() => currentEpisodeNumber !== null && selectEpisode(currentEpisodeNumber)}
                className="flex-1 active:opacity-90">
                {!!card && <Image source={getImageUrl(card)} contentFit="cover" style={{ position: "absolute", inset: 0, opacity: 0.55 }} accessibilityIgnoresInvertColors />}
                <View className="flex-1 items-center justify-center gap-3 px-6">
                    {episodeLoading || (playing && !url && !shownError) ? <>
                        <ActivityIndicator color="#fff" size="large" />
                        <Text className="text-center text-[15px] text-white/80">{cycler.isTrying ? t("Trying providers …", "Provider werden probiert …") : t("Loading stream", "Stream wird geladen")}</Text>
                    </> : <View className="h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-black/45">
                        <Play size={28} color="#fff" fill="#fff" />
                    </View>}
                </View>
            </Pressable>
            </PlayerBoxSlot>
            {!!sourceFailure && !cycler.isTrying && <Muted accessibilityLiveRegion="polite" className="mt-3 text-[13px]">{sourceFailure}</Muted>}
            {(episodeSourceError || !!playbackError || (!episodeLoading && !!episodeSource && !videoSource)) &&
                <Button intent="secondary" wrapperClassName="mt-3 self-start" disabled={episodeLoading} onPress={() => retryEpisodeSource()}>{t("Retry source", "Quelle erneut laden")}</Button>}

            <View className="mt-4">
                {viewMode === "list" ? <>
                    {/* r18: only the rows near the screen are drawn (Black Clover 170, long series 1000+) */}
                    <WindowedRows items={sortedEpisodes} keyOf={onlineEpisodeKey} estimate={ONLINE_ROW_ESTIMATE} renderItem={episode => {
                        const title = media.format === "MOVIE" ? t("Complete movie", "Ganzer Film") : `${t("Episode", "Folge")} ${episode.number}`
                        const selected = episode.number === currentEpisodeNumber
                        return <View className={cn(selected && "rounded-[10px] bg-sm-accent-soft")}>
                            <EpisodeRow mobileEntry media={media} image={episode.image} title={title} episodeTitle={episode.title}
                                isWatched={progress ? episode.number <= progress : undefined} isFiller={episode.isFiller}
                                episodeNumber={episode.number} watchedProgress={progress}
                                onPress={episodeLoading && !selected ? undefined : () => selectEpisode(episode.number)}
                                action={pluginItems.length > 0 ? <IconAction icon={Ellipsis} label={t("Episode options", "Optionen der Folge")}
                                    onPress={anchor => setPluginMenu({ anchor, episode, title })} /> : undefined} />
                        </View>
                    }} />
                    {!!episodes?.length && <Muted className="py-2 text-center">{t("End", "Ende")}</Muted>}
                </> : <View className="flex-row flex-wrap gap-2">
                    {sortedEpisodes.map(episode => {
                        const selected = episode.number === currentEpisodeNumber
                        const watched = !!progress && episode.number <= progress
                        return <Pressable key={episode.number} accessibilityRole="button" accessibilityState={{ selected, disabled: episodeLoading }}
                            accessibilityLabel={`${t("Episode", "Folge")} ${episode.number}${episode.title ? ` · ${episode.title}` : ""}`}
                            disabled={episodeLoading} onPress={() => selectEpisode(episode.number)}
                            className={cn("h-12 min-w-12 items-center justify-center rounded-surface-sm px-3",
                                selected ? "bg-brand-500" : episode.isFiller ? "bg-orange-900/60" : "bg-sm-surface-raised active:bg-sm-surface-control",
                                watched && !selected && "opacity-50")}>
                            <Text className={cn("text-[15px] font-semibold", selected ? "text-white" : "text-sm-text")} style={{ fontVariant: ["tabular-nums"] }}>{episode.number}</Text>
                        </Pressable>
                    })}
                </View>}
            </View>
        </>}

        {bottomSection}

        {!!provider && <OnlinestreamManualMappingSheet entry={entry} provider={provider} open={matchOpen} onOpenChange={setMatchOpen} />}
        <Dialog open={cacheOpen} onOpenChange={setCacheOpen} title={t("Stream cache", "Stream-Cache")}
            description={t("Clears the saved sources of this anime. Use it when an episode does not load or stops.",
                "Leert die gespeicherten Quellen dieses Anime. Hilft, wenn eine Folge nicht lädt oder hängt.")}>
            <View className="gap-2">
                {/* The request stays pending until the source is fetched again, which can take long; the cache is cleared right
                    away and a toast confirms it, so the dialog closes at once */}
                <Pressable accessibilityRole="button" disabled={emptyingCache || !mediaId} onPress={() => {
                    emptyCache({ mediaId })
                    setCacheOpen(false)
                }} className={cn("min-h-12 items-center justify-center rounded-surface-sm active:opacity-80", emptyingCache && "opacity-60")}
                    style={{ backgroundColor: "rgba(242,167,182,0.14)" }}>
                    <Text className="text-[15px] font-semibold text-sm-danger">{emptyingCache ? t("Clearing …", "Wird geleert …") : t("Clear stream cache", "Stream-Cache leeren")}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setCacheOpen(false)}
                    className="min-h-12 items-center justify-center rounded-surface-sm bg-sm-surface-raised active:bg-sm-surface-control">
                    <Text className="text-[15px] font-semibold">{t("Cancel", "Abbrechen")}</Text>
                </Pressable>
            </View>
        </Dialog>
        <CardMenu anchor={pluginMenu?.anchor ?? null} title={pluginMenu?.title ?? ""} onClose={() => setPluginMenu(null)}
            items={pluginMenu ? pluginItems.map(item => ({ id: `${item.extensionId}:${item.id}`, label: item.label || "???", icon: Puzzle,
                onPress: () => runPlugin(item, { episode: pluginMenu.episode, type: "onlinestream" }) })) : []} />
    </View>
}

/** `.mobile-source-more` buttons: quiet text with an icon, 48dp tall */
function QuietAction({ icon: Icon, label, tone, disabled, onPress }: {
    icon?: React.ComponentType<{ size?: number, color?: string }>
    label: string
    tone?: "warning"
    disabled?: boolean
    onPress: () => void
}) {
    const color = tone === "warning" ? colors.smWarning : colors.smTextMuted
    return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
        className="min-h-12 flex-row items-center gap-1.5 rounded-full px-2 active:bg-sm-surface-raised">
        {!!Icon && <Icon size={18} color={color} />}
        <Text className="text-[13px] font-medium" style={{ color }}>{label}</Text>
    </Pressable>
}

/** `.mobile-episode-navigation`: 48dp square buttons joined in one rounded group */
function NavButton({ label, disabled, onPress, children }: { label: string, disabled: boolean, onPress: () => void, children: React.ReactNode }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
        className={cn("h-12 w-12 items-center justify-center bg-sm-surface-raised active:bg-sm-surface-control", disabled && "opacity-45")}>
        {children}
    </Pressable>
}
