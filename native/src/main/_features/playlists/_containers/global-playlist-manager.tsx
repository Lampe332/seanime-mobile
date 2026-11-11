import type { Anime_Entry, Anime_Playlist, Anime_PlaylistEpisode, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Dialog, Sheet } from "@/components/ui/sheet/sheet"
import { Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { tr, useTr } from "@/lib/app-language"
import { logger } from "@/lib/helpers/debug"
import { usePathname, useRouter } from "@/lib/navigation"
import { WSEvents } from "@/lib/server/ws-events"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useCurrentDevicePlaybackSettings, usesAndroidBuiltInPlayer } from "@/main/_atoms/playback.atoms"
import { useAutoPlaySelectedTorrent } from "@/main/_features/autoplay/autoplay.atoms"
import { getBatchSelectionParams } from "@/main/_features/autoplay/batches"
import { nativePlayer_stateAtom } from "@/main/_features/native-player/native-player.atoms"
import { useWebsocketMessageListener, useWebsocketSender } from "@/main/_hooks/handle-websockets"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useHandleStartDebridStream } from "@/main/entry/_containers/debrid-stream/_lib/handle-debrid-stream"
import { __torrentSearch_selectionAtom, __torrentSearch_selectionEpisodeAtom } from "@/main/entry/_containers/torrent-search/torrent-search.atoms"
import { TorrentSearchPhone } from "@/main/entry/_containers/torrent-search/torrent-search-phone"
import { useHandleStartTorrentStream } from "@/main/entry/_containers/torrent-stream/_lib/handle-torrent-stream"
import {
    __debridStream_autoSelectFileAtom, __torrentStream_autoSelectFileAtom, useTorrentSearchSelectedStreamEpisode,
} from "@/main/entry/_containers/torrent-stream/torrent-stream.atoms"
import { useHandlePlayMedia } from "@/main/entry/_lib/handle-play-media"
import { useMediastreamActiveOnDevice } from "@/main/mediastream/_lib/mediastream.atoms"
import { clientIdAtom, websocketConnectedAtom } from "@/main/websocket-provider"
import { Image } from "expo-image"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import ListVideo from "lucide-react-native/icons/list-video"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import SkipBack from "lucide-react-native/icons/skip-back"
import SkipForward from "lucide-react-native/icons/skip-forward"
import X from "lucide-react-native/icons/x"
import React from "react"
import { Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { playlistEpisodeKey, samePlaylistEpisode } from "../lib/mobile-playlist-state"

/*
 * The playing playlist (web playlists/_containers/global-playlist-manager.tsx + global-playlist-popup.tsx): the server
 * owns the playlist and says which episode plays next ("playlist" websocket events); this starts it the way the episode
 * is watched (local file / Nakama in the app's player, torrent or debrid stream with the auto-selection or the torrent
 * sheet, online on the anime page's online tab). While a playlist runs and the player is closed, a round button over the
 * bottom bar opens the playlist with previous / reopen / stop / next; skipping an unfinished episode asks first whether
 * its progress counts.
 */

const log = logger("PLAYLIST MANAGER")

type ServerEvents = "current-playlist" | "play-episode" | "playing-episode"

const pm_currentPlaylist = atom<Anime_Playlist | null>(null)
const pm_currentPlaylistEpisode = atom<Anime_PlaylistEpisode | null>(null)
const pm_confirmProgressUpdateModalOpen = atom<"next" | "previous" | null>(null)
const pm_playEpisodeRequestPending = atom(false)
const playlistEpisodeRequestCooldownMs = 2500

export function usePlaylistManager() {
    const { sendMessage } = useWebsocketSender()
    const clientId = useAtomValue(clientIdAtom)
    const currentPlaylist = useAtomValue(pm_currentPlaylist)
    const currentPlaylistEpisode = useAtomValue(pm_currentPlaylistEpisode)
    const [confirmOpen, setConfirmOpen] = useAtom(pm_confirmProgressUpdateModalOpen)
    const [playEpisodeRequestPending, setPlayEpisodeRequestPending] = useAtom(pm_playEpisodeRequestPending)
    const { downloadedMediaPlayback, torrentStreamingPlayback } = useCurrentDevicePlaybackSettings()
    const { activeOnDevice } = useMediastreamActiveOnDevice()

    function startPlaylist(playlist: Anime_Playlist) {
        toast.info(tr("Starting playlist...", "Playlist wird gestartet…"))
        sendMessage({
            type: WSEvents.PLAYLIST,
            payload: {
                type: "start-playlist",
                payload: {
                    clientId,
                    dbId: playlist.dbId,
                    localFilePlaybackMethod: usesAndroidBuiltInPlayer(downloadedMediaPlayback) ? "nativePlayer" : activeOnDevice ? "transcode" : downloadedMediaPlayback,
                    streamPlaybackMethod: torrentStreamingPlayback,
                },
            },
        })
    }

    function stopPlaylist() {
        setPlayEpisodeRequestPending(false)
        sendMessage({ type: WSEvents.PLAYLIST, payload: { type: "stop-playlist" } })
    }

    function reopenEpisode() {
        sendMessage({ type: WSEvents.PLAYLIST, payload: { type: "reopen-episode" } })
    }

    function requestEpisode(which: "next" | "previous", isCurrentCompleted: boolean) {
        setPlayEpisodeRequestPending(true)
        setTimeout(() => setPlayEpisodeRequestPending(false), playlistEpisodeRequestCooldownMs)
        sendMessage({ type: WSEvents.PLAYLIST, payload: { type: "play-episode", payload: { which, isCurrentCompleted } } })
    }

    function playEpisode(which: "next" | "previous", isCurrentCompleted: boolean) {
        if (playEpisodeRequestPending) return
        // A finished episode moves on at once (the server does not need to update progress); else ask first
        if (isCurrentCompleted) requestEpisode(which, false)
        else setConfirmOpen(which)
    }

    function onConfirmedProgress(shouldUpdate: boolean) {
        if (!confirmOpen) return
        setConfirmOpen(null)
        if (playEpisodeRequestPending) return
        log.info("Sending play episode event", confirmOpen, shouldUpdate)
        requestEpisode(confirmOpen, shouldUpdate)
    }

    const index = currentPlaylist?.episodes?.findIndex(n => samePlaylistEpisode(n, currentPlaylistEpisode)) ?? -1
    return {
        currentPlaylist,
        startPlaylist,
        stopPlaylist,
        reopenEpisode,
        playEpisode,
        nextPlaylistEpisode: currentPlaylist?.episodes?.[index + 1],
        prevPlaylistEpisode: index > 0 ? currentPlaylist?.episodes?.[index - 1] : undefined,
        onConfirmedProgress,
        playEpisodeRequestPending,
    }
}

function sameTorrent(autoPlayTorrent: { entry: Anime_Entry, torrent: HibikeTorrent_AnimeTorrent } | null, episode: Anime_PlaylistEpisode) {
    return !!autoPlayTorrent && autoPlayTorrent.entry.mediaId === episode.episode?.baseAnime?.id
}

/** Once in the main layout */
export function GlobalPlaylistManager() {
    const t = useTr()
    const { sendMessage } = useWebsocketSender()
    const websocketConnected = useAtomValue(websocketConnectedAtom)
    const serverStatus = useServerStatus()
    const router = useRouter()
    const pathname = usePathname()
    const nativePlayerState = useAtomValue(nativePlayer_stateAtom)
    const manager = usePlaylistManager()
    const [currentPlaylist, setCurrentPlaylist] = useAtom(pm_currentPlaylist)
    const setCurrentPlaylistEpisode = useSetAtom(pm_currentPlaylistEpisode)
    const [confirmProgress, setConfirmProgress] = useAtom(pm_confirmProgressUpdateModalOpen)
    const [open, setOpen] = React.useState(false)

    React.useEffect(() => {
        sendMessage({ type: WSEvents.PLAYLIST, payload: { type: "current-playlist" } })
    }, [websocketConnected, sendMessage])

    const { handleStreamSelection: handleTorrentstreamSelection, handleAutoSelectStream: handleTorrentstreamAutoSelect } = useHandleStartTorrentStream()
    const { handleStreamSelection: handleDebridstreamSelection, handleAutoSelectStream: handleDebridstreamAutoSelect } = useHandleStartDebridStream()
    const { playMediaFile } = useHandlePlayMedia()
    const torrentAutoSelect = serverStatus?.torrentstreamSettings?.autoSelect
    const debridAutoSelect = serverStatus?.debridSettings?.streamAutoSelect
    const torrentAutoSelectFile = useAtomValue(__torrentStream_autoSelectFileAtom)
    const debridAutoSelectFile = useAtomValue(__debridStream_autoSelectFileAtom)
    const { torrentSearchStreamEpisode, setTorrentSearchStreamEpisode } = useTorrentSearchSelectedStreamEpisode()
    const setTorrentSearch = useSetAtom(__torrentSearch_selectionAtom)
    const setTorrentSearchEpisode = useSetAtom(__torrentSearch_selectionEpisodeAtom)
    const { data: animeEntry } = useGetAnimeEntry(torrentSearchStreamEpisode?.baseAnime?.id)
    const { autoPlayTorrent, setAutoPlayTorrent } = useAutoPlaySelectedTorrent()

    const openTorrentSearch = (episode: Anime_PlaylistEpisode, selection: "torrentstream-select" | "torrentstream-select-file" | "debridstream-select" | "debridstream-select-file") => {
        setTorrentSearchEpisode(episode.episode?.episodeNumber)
        setTorrentSearchStreamEpisode(episode.episode!)
        setTorrentSearch(selection)
    }

    useWebsocketMessageListener<{ type: ServerEvents, payload: unknown }>({
        type: WSEvents.PLAYLIST,
        onMessage: data => {
            if (data.type === "current-playlist") {
                const payload = data.payload as { playlist: Anime_Playlist | null, playlistEpisode: Anime_PlaylistEpisode | null }
                setCurrentPlaylist(payload.playlist ?? null)
                setCurrentPlaylistEpisode(payload.playlistEpisode ?? null)
                return
            }
            if (data.type === "playing-episode") {
                setTorrentSearchStreamEpisode(null)
                setTorrentSearch(undefined)
                return
            }
            if (data.type !== "play-episode") return
            const episode = (data.payload as { playlistEpisode: Anime_PlaylistEpisode }).playlistEpisode
            setCurrentPlaylistEpisode(episode)
            const mediaId = episode.episode?.baseAnime?.id!
            const params = { mediaId, episodeNumber: episode.episode?.episodeNumber!, aniDBEpisode: episode.episode?.aniDBEpisode! }
            toast.info(t(`Playing episode ${episode.episode?.aniDBEpisode} of ${episode.episode?.baseAnime?.title?.userPreferred}`,
                `Folge ${episode.episode?.aniDBEpisode} von ${episode.episode?.baseAnime?.title?.userPreferred} wird gespielt`))

            switch (episode.watchType) {
                case "nakama":
                case "localfile":
                    if (episode.episode?.localFile?.path) playMediaFile({ path: episode.episode.localFile.path, mediaId, episode: episode.episode })
                    break
                case "torrent":
                    if (torrentAutoSelect) handleTorrentstreamAutoSelect(params)
                    else if (autoPlayTorrent?.torrent?.isBatch && torrentAutoSelectFile && sameTorrent(autoPlayTorrent, episode)) {
                        // the batch picked for the last episode has this one too
                        const batch = getBatchSelectionParams(autoPlayTorrent.batchFiles, params.episodeNumber, params.aniDBEpisode)
                        handleTorrentstreamSelection({ ...params, torrent: autoPlayTorrent.torrent, chosenFileIndex: batch.fileIndex, batchEpisodeFiles: batch.batchEpisodeFiles })
                        if (batch.batchEpisodeFiles) setAutoPlayTorrent(autoPlayTorrent.torrent, autoPlayTorrent.entry, batch.batchEpisodeFiles)
                    } else openTorrentSearch(episode, torrentAutoSelectFile ? "torrentstream-select" : "torrentstream-select-file")
                    break
                case "debrid":
                    if (debridAutoSelect) handleDebridstreamAutoSelect(params)
                    else if (autoPlayTorrent?.torrent?.isBatch && debridAutoSelectFile && sameTorrent(autoPlayTorrent, episode)) {
                        handleDebridstreamSelection({ ...params, torrent: autoPlayTorrent.torrent, chosenFileId: "", batchEpisodeFiles: undefined })
                    } else openTorrentSearch(episode, debridAutoSelectFile ? "debridstream-select" : "debridstream-select-file")
                    break
                case "online":
                    router.push(`/entry?id=${mediaId}&tab=onlinestream&episode=${params.episodeNumber}`)
                    break
            }
        },
    })

    if (!currentPlaylist) return null
    // The anime page has its own torrent sheet on the same atoms; this one is for the other pages
    const ownTorrentSheet = !!animeEntry && pathname !== "/entry"

    return <>
        {ownTorrentSheet && <TorrentSearchPhone entry={animeEntry} />}

        <Dialog open={confirmProgress !== null} onOpenChange={next => {
            if (!next) setConfirmProgress(null)
        }} title={t("Update progress?", "Fortschritt aktualisieren?")}
            description={t("Do you want to update the progress of the current episode?", "Möchtest du den Fortschritt der aktuellen Episode aktualisieren?")}
            footer={<>
                <Button intent="secondary" disabled={manager.playEpisodeRequestPending} onPress={() => manager.onConfirmedProgress(false)}>{t("No", "Nein")}</Button>
                <Button disabled={manager.playEpisodeRequestPending} onPress={() => manager.onConfirmedProgress(true)}>{t("Yes", "Ja")}</Button>
            </>} />

        {!nativePlayerState.active && <PlaylistButton open={open} onPress={() => setOpen(o => !o)} />}

        <Sheet open={open && !nativePlayerState.active} onOpenChange={setOpen} title={currentPlaylist.name || t("Playing playlist", "Laufende Playlist")}
            footer={<View className="flex-1 flex-row items-center">
                <Button intent="icon" accessibilityLabel={t("Previous episode", "Vorherige Episode")} disabled={!manager.prevPlaylistEpisode || manager.playEpisodeRequestPending}
                    onPress={() => manager.playEpisode("previous", false)}><SkipBack size={22} color={colors.smText} /></Button>
                <View className="flex-1" />
                <Button intent="icon" accessibilityLabel={t("Reopen episode", "Episode erneut öffnen")} disabled={manager.playEpisodeRequestPending}
                    onPress={manager.reopenEpisode}><RefreshCw size={22} color={colors.smTextMuted} /></Button>
                <Button intent="icon" accessibilityLabel={t("Stop playlist", "Playlist stoppen")} onPress={() => {
                    manager.stopPlaylist()
                    setOpen(false)
                }}><X size={22} color={colors.smDanger} /></Button>
                <View className="flex-1" />
                <Button intent="icon" accessibilityLabel={t("Next episode", "Nächste Episode")} disabled={!manager.nextPlaylistEpisode || manager.playEpisodeRequestPending}
                    onPress={() => manager.playEpisode("next", false)}><SkipForward size={22} color={colors.smText} /></Button>
            </View>}>
            <View className="gap-2">{currentPlaylist.episodes?.map(ep => <PlayingEpisode key={playlistEpisodeKey(ep)} episode={ep} />)}</View>
        </Sheet>
    </>
}

/** The round button over the bottom bar (global-playlist-popup.tsx, `bottom-24 right-4`); tablet: at the foot beside the rail */
function PlaylistButton({ open, onPress }: { open: boolean, onPress: () => void }) {
    const t = useTr()
    const insets = useSafeAreaInsets()
    const barHeight = useNavBarHeight()
    const { rail } = useTabletLayout()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t("Open playing playlist", "Laufende Playlist öffnen")} onPress={onPress}
            style={{ bottom: (rail ? 16 : barHeight + 16) + insets.bottom, shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 14, elevation: 10 }}
            className="absolute right-4 h-14 w-14 items-center justify-center rounded-full bg-white active:bg-[#e4e4e7]">
            {open ? <X size={24} color="#111111" /> : <ListVideo size={24} color="#111111" />}
        </Pressable>
    )
}

function PlayingEpisode({ episode }: { episode: Anime_PlaylistEpisode }) {
    const t = useTr()
    const current = useAtomValue(pm_currentPlaylistEpisode)
    const playing = samePlaylistEpisode(current, episode)
    const image = episode.episode?.episodeMetadata?.image
    const source = episode.watchType === "torrent" ? t("Torrent streaming", "Torrent-Streaming") : episode.watchType === "debrid" ? t("Debrid streaming", "Debrid-Streaming")
        : episode.watchType === "online" ? t("Online streaming", "Online-Streaming") : episode.episode?.localFile?.name
    return (
        <View accessibilityState={{ selected: playing }} style={{ opacity: playing ? 1 : 0.5 }}
            className={cn("flex-row gap-3 rounded-surface-sm bg-sm-surface-raised px-2.5 py-2", playing && "border border-[rgba(255,255,255,0.5)]")}>
            <View className="h-12 w-12 overflow-hidden rounded-md bg-sm-surface-control">
                {!!image && <Image source={{ uri: image }} style={{ width: 48, height: 48, opacity: episode.isCompleted ? 0.1 : 1 }} contentFit="cover" />}
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={2} className="text-sm text-sm-text-muted">{episode.episode?.baseAnime?.title?.userPreferred}</Text>
                <Text>{episode.episode?.baseAnime?.format !== "MOVIE" ? `${t("Episode", "Episode")} ${episode.episode?.episodeNumber}` : t("Movie", "Film")}</Text>
                {!!source && <Text numberOfLines={1} className="text-xs text-sm-text-muted">{source}</Text>}
            </View>
        </View>
    )
}
