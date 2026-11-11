import type { NativePlayer_PlaybackInfo } from "@/api/generated/types"
import { getServerBaseUrl } from "@/api/client/server-url"
import { Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { openInPlayerApp } from "@/lib/external-player-link/open-external-player"
import { colors } from "@/lib/theme/tokens"
import { showsRail } from "@/lib/tablet-ui"
import { BOX_BAR_FADE, bottomPad, boxControlSizes, controlSizes, fitBarButton, topPad } from "./control-sizes"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import { getSkipChapters } from "@/main/_features/media-core/media-core-chapters"
import { mediaCorePreferencesAtom } from "@/main/_features/media-core/media-core-preferences"
import { useSkipData } from "@/main/_features/video-core/_lib/aniskip"
import {
    vc_autoNextAtom,
    vc_autoPlayVideoAtom,
    vc_autoSkipOPEDAtom,
    vc_beautifyImageAtom,
    vc_highlightOPEDChaptersAtom,
    vc_settings,
    vc_sleepTimerAtom,
    vc_storedMutedAtom,
    vc_storedPlaybackRateAtom,
    vc_storedVolumeAtom,
    vc_storedVolumeBoostAtom,
    vc_videoFitAtom,
} from "@/main/_features/video-core/video-core.atoms"
import { ExpoMpvView, type ExpoMpvViewRef } from "expo-mpv"
import { useKeepAwake } from "expo-keep-awake"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import Captions from "lucide-react-native/icons/captions"
import Cast from "lucide-react-native/icons/cast"
import Film from "lucide-react-native/icons/film"
import Headphones from "lucide-react-native/icons/headphones"
import Maximize from "lucide-react-native/icons/maximize"
import Minimize from "lucide-react-native/icons/minimize"
import PictureInPicture2 from "lucide-react-native/icons/picture-in-picture-2"
import Settings from "lucide-react-native/icons/settings"
import SkipBack from "lucide-react-native/icons/skip-back"
import SkipForward from "lucide-react-native/icons/skip-forward"
import X from "lucide-react-native/icons/x"
import React from "react"
import { ActivityIndicator, BackHandler, type GestureResponderEvent, Pressable, StyleSheet, useWindowDimensions, View } from "react-native"
import Animated, { Easing, FadeIn, FadeOut, ReduceMotion, useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated"
import { levelPanelIn, levelPanelOut } from "@/components/ui/core/animations"
import { LEVEL_PANEL } from "@/lib/motion"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Path, Text as SvgText } from "react-native-svg"
import { type MenuAnchor, PlayerMenu, type PlayerMenuPage } from "./player-menu"
import { assStyleCount, colourProperties, subtitleKind, subtitleLookProperties, timeBarPieces, type TimeBarPiece } from "./player-menu-logic"
import { mpvVolume, VolumeButton, VolumePanel } from "./player-volume"
import {
    activeSkipSegment,
    aniSkipSegments,
    AUTO_NEXT_SECONDS,
    BOOST_RATE,
    canEnterPip,
    classifySwipe,
    classifyTap,
    clampTime,
    countdownTick,
    DOUBLE_TAP_MS,
    doubleTapSeekSeconds,
    endAction,
    endedEarly,
    playedPosition,
    readTrackList,
    stillEnded,
    formatTime,
    HIDE_DELAY_MS,
    isPlayingState,
    languageList,
    LONG_PRESS_MS,
    mkvNumberToMpvId,
    MPV_OPEN_OPTIONS,
    mpvIdToMkvNumber,
    pickTrack,
    type PlayerTrack,
    rememberTrack,
    resolveStreamUrl,
    SCRUB_IDLE,
    type ScrubState,
    scrubDown,
    scrubMove,
    scrubUp,
    SEEK_BACK_SECONDS,
    SEEK_FORWARD_SECONDS,
    remoteEpisode,
    sessionQueue,
    shouldSendCompleted,
    sideOf,
    type Side,
    type SkipSegment,
    pictureFitProperties,
    type SwipeKind,
    swipeLevel,
    type TapMemory,
    toPlayerTrack,
} from "./player-logic"
import { useSubtitleTranslation } from "./use-subtitle-translation"
import { player_castingAtom, player_miniAtom, player_trackMemoryAtom } from "./player.atoms"
import { boxScroll, player_boxSlotAtom, player_nowAtom } from "./player-box"
import { castableStreamUrl, castTitle, castTrackNumbers, castUrlWithTracks } from "./player-cast"
import { CastPill, CastSheet, usePlayerCast } from "./player-cast-panel"
import { endPlayerOrientation, readBrightness, readVolume, restoreBrightness, setVideoFullscreenOrientation, turnedToLandscape, writeBrightness, writeVolume } from "./player-system"
import { backStep, boxFrame, boxOwner, isScrollDrag, loadStart, MINI_BAR, MINI_CARD, type MiniFrame, miniFrame, miniPlayCommand, playerView, progressFraction, viewTurn } from "./player-chrome"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { usePlayerPlaylist } from "./use-player-playlist"
import { type OfflinePlayback, offlinePositionToSave } from "@/main/android-downloads/_lib/offline-playback"
import { askForDownloadNotices } from "@/main/android-downloads/_lib/download-notifications"
import { useMobileOfflineDownload } from "@/api/hooks/mobile_offline.hooks"
import { successFeedback } from "@/lib/feedback"
import type { OnlinePlayback } from "@/main/onlinestream/_lib/onlinestream-player.atoms"
import { preferredOnlineSubtitle } from "@/main/onlinestream/_lib/onlinestream-source"
import { usePlayerLoadEvents } from "./player-load-events"
import { usePlayerContinuity } from "./player-continuity"
import { type PlayerCommands, usePlayerServer } from "./use-player-server"
import { usePlaylistManager } from "@/main/_features/playlists/_containers/global-playlist-manager"
import { playlistNavigation } from "@/main/_features/playlists/lib/mobile-playlist-state"

/*
 * The app's player (E3): mpv (expo-mpv) with the old app's controls rebuilt (media-core-control-bar, VideoControlInjector.kt):
 * centre buttons −5 / play / +10, bars that hide after 5 s while playing, a time bar that scrubs only after 10 px
 * sideways, double tap −5/+10 on either half, brightness (left) and volume (right) by vertical swipes, long press = 2x.
 * Sideways swipes do nothing (no swipe-to-seek), and a swipe or long press never toggles the controls.
 * r22 (Nick 11.11.): one player, three places (player-chrome playerView): fullscreen over everything, the box on its anime
 * page (2.0.x inline player), the mini player anywhere else. The bottom-right button switches fullscreen ↔ small (box or
 * mini), during loading too; Back in fullscreen makes it small; it always plays on (the mpv view is never remounted,
 * only its frame moves). The mini player's × closes it.
 */

type ViewRef = React.ComponentRef<typeof View>

// Bars: in 180 ms, out faster (140 ms), strong ease-out (lib/motion MOTION_EASE_OUT); pills and HUDs fade 150/120 ms
const BAR_IN_MS = 180
const BAR_OUT_MS = 140
const BAR_EASE = Easing.bezier(0.23, 1, 0.32, 1)
const POP_IN = FadeIn.duration(150).easing(BAR_EASE)
const POP_OUT = FadeOut.duration(120)

type SurfaceGesture = {
    x: number, y: number, side: Side, kind: SwipeKind | "boost" | "scroll" | null, startLevel: number, kindY: number, moved: boolean,
    levels: { brightness: number, volume: number }
    /** window position at the start and the last two moves (the box scrolls the page by them, r22) */
    pageX: number, pageY: number, last: { y: number, t: number }, previous: { y: number, t: number }
}

/** `level` (0…1): the brightness / volume panel's bar */
type Hud = { side: Side | "center", text: string, kind: SwipeKind | null, level?: number }

/** An episode of the offline library (android-downloads/_lib/offline-playback.ts): own position, no server channel. */
export type PlayerOffline = {
    playback: OfflinePlayback
    hasNext: boolean
    playNext: () => void
    /** stores where the player stopped, in ms (0 after the end) */
    savePosition: (positionMs: number) => void
}

// The offline position is stored this often while playing, and on pause, close and end (OfflineActivity.kt savePosition)
const OFFLINE_SAVE_EVERY_S = 15

export function PlayerScreen({ info, loadingState, playbackError, onClose, offline, online }: {
    info: NativePlayer_PlaybackInfo | null
    loadingState: string | null
    playbackError: string | null
    onClose: () => void
    offline?: PlayerOffline
    /** an online stream (onlinestream page): its episode list, quality, subtitle preference and "Save this episode" */
    online?: OnlinePlayback
}) {
    const t = useTr()
    const insets = useSafeAreaInsets()
    const window = useWindowDimensions()
    const isTablet = useIsTabletScreen()
    const reduceMotion = useReducedMotion()
    const mpv = React.useRef<ExpoMpvViewRef>(null)

    const [small, setSmall] = useAtom(player_miniAtom)
    const casting = useAtomValue(player_castingAtom)
    const [trackMemory, setTrackMemory] = useAtom(player_trackMemoryAtom)
    const settings = useAtomValue(vc_settings)
    const preferences = useAtomValue(mediaCorePreferencesAtom)
    const autoNext = useAtomValue(vc_autoNextAtom)
    const autoSkip = useAtomValue(vc_autoSkipOPEDAtom)
    const [sleepTimer, setSleepTimer] = useAtom(vc_sleepTimerAtom)
    const [speed, setSpeed] = useAtom(vc_storedPlaybackRateAtom)

    const mediaId = info?.media?.id
    const progressNumber = info?.episode?.progressNumber
    const { data: skipData } = useSkipData(info?.media?.idMal, progressNumber ?? -1)
    const continuity = usePlayerContinuity(info?.id, offline ? undefined : mediaId)
    const serverPlaylist = usePlayerPlaylist(offline || online ? null : info)
    const playlistManager = usePlaylistManager()
    // offline: the next saved episode of the anime, no previous (OfflinePlayerView.kt auto next)
    // a running playlist: its previous/next episode, whatever plays (web video-core-playlist.tsx)
    // online: the provider's episode list of the online stream page
    const playlist: Pick<typeof serverPlaylist, "hasNextEpisode" | "hasPreviousEpisode" | "playEpisode"> = offline
        ? { hasNextEpisode: offline.hasNext, hasPreviousEpisode: false, playEpisode: which => { if (which === "next") offline.playNext() } }
        : playlistManager.currentPlaylist
            ? playlistNavigation(playlistManager.nextPlaylistEpisode, playlistManager.prevPlaylistEpisode, playlistManager.playEpisode)
            : online
                ? { hasNextEpisode: online.hasNext, hasPreviousEpisode: online.hasPrevious, playEpisode: which => online.events.current?.playEpisode(which) }
                : serverPlaylist

    // ── Per-episode state; a new playback id starts fresh ──
    const [playbackId, setPlaybackId] = React.useState(info?.id)
    const [loaded, setLoaded] = React.useState(false)
    const [playing, setPlaying] = React.useState(false)
    const [buffering, setBuffering] = React.useState(true)
    const [position, setPosition] = React.useState(0)
    const [duration, setDuration] = React.useState(0)
    const [buffered, setBuffered] = React.useState(0)
    const [tracks, setTracks] = React.useState<PlayerTrack[]>([])
    const [audioId, setAudioId] = React.useState(0)
    const [subId, setSubId] = React.useState(0)
    // the tracks of this episode are picked (they go into the cast stream)
    const [tracksReady, setTracksReady] = React.useState(false)
    const [countdown, setCountdown] = React.useState<number | null>(null)
    const [videoError, setVideoError] = React.useState<string | null>(null)
    if (playbackId !== info?.id) {
        setPlaybackId(info?.id)
        setLoaded(false)
        setPlaying(false)
        setBuffering(true)
        setPosition(0)
        setDuration(0)
        setBuffered(0)
        setTracks([])
        setAudioId(0)
        setSubId(0)
        setTracksReady(false)
        setCountdown(null)
        setVideoError(null)
    }

    const [visible, setVisible] = React.useState(true)
    const [pip, setPip] = React.useState(false)
    const pipRef = React.useRef(false)
    // ── Where the player is (r22): full, the box on its anime page, or the mini player ──
    const owner = boxOwner(!!online, mediaId)
    const setNow = useSetAtom(player_nowAtom)
    React.useEffect(() => {
        setNow({ owner })
    }, [owner, setNow])
    React.useEffect(() => () => setNow(null), [setNow])
    const slot = useAtomValue(player_boxSlotAtom)
    const boxSlot = slot && owner && slot.owner === owner ? slot : null
    const view = playerView(small, !!boxSlot)
    // picture in picture shows the whole window: the player fills it, whatever its place in the app
    const layoutView = pip ? "full" : view
    const mini = layoutView === "mini"
    const box = layoutView === "box" ? boxSlot : null
    const fullscreen = view === "full"
    const landscape = window.width > window.height
    const [menuOpen, setMenuOpen] = React.useState(false)
    const [menuPage, setMenuPage] = React.useState<PlayerMenuPage>("main")
    // the bar button the menu hangs from in landscape (2.0.32: each menu is a popover out of its own button)
    const [menuAnchor, setMenuAnchor] = React.useState<MenuAnchor | null>(null)
    const rootRef = React.useRef<ViewRef>(null)
    // the player's own volume (top bar speaker, 2.0.32 MediaCoreVolumeButton)
    const [volume, setVolume] = useAtom(vc_storedVolumeAtom)
    const [muted, setMuted] = useAtom(vc_storedMutedAtom)
    const volumeBoost = useAtomValue(vc_storedVolumeBoostAtom)
    // "Auto play" off: a loaded episode waits paused (mpv always starts on load)
    const autoPlay = useAtomValue(vc_autoPlayVideoAtom)
    const [volumeOpen, setVolumeOpen] = React.useState(false)
    const openMenu = (page: PlayerMenuPage, button: ViewRef | null) => {
        setVolumeOpen(false)
        setMenuPage(page)
        const root = rootRef.current
        if (!button || !root) {
            setMenuAnchor(null)
            setMenuOpen(true)
            return
        }
        root.measureInWindow((rootX, rootY) => button.measureInWindow((x, y, width, height) => {
            setMenuAnchor({ x: x - rootX, y: y - rootY, width, height })
            setMenuOpen(true)
        }))
    }
    const [boosting, setBoosting] = React.useState(false)
    const [hud, setHud] = React.useState<Hud | null>(null)
    const [ripple, setRipple] = React.useState<{ side: Side, text: string, key: number } | null>(null)
    const [message, setMessage] = React.useState<string | null>(null)
    const [remainingMode, setRemainingMode] = React.useState(preferences.timestampMode === "remaining")

    const timeRef = React.useRef({ currentTime: 0, duration: 0, paused: true })
    // how far playback really got (player-logic playedPosition): a broken stream's jump to its end is not counted
    const playedRef = React.useRef({ played: 0, previous: 0, seeking: false })
    const completedRef = React.useRef(false)
    const endedRef = React.useRef(false)
    const playingRef = React.useRef(false)
    // mpv keeps its pause flag across files, so an episode picked while the last one was paused would load paused: with
    // "Auto play" it starts on load instead (old <video autoplay>), unless a pause came in while it loaded (r21)
    const playOnLoad = React.useRef(false)
    const skippedRef = React.useRef<number | null>(null)
    const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    React.useEffect(() => {
        playedRef.current = { played: 0, previous: 0, seeking: false }
        completedRef.current = false
        playOnLoad.current = true
        playingRef.current = false
        endedRef.current = false
        skippedRef.current = null
    }, [info?.id])

    // ── Source: wait for the watch history so continuity can start at the last position (web handleCanPlay) ──
    const waiting = !!continuity.waitForWatchHistory
    const historyItem = continuity.watchHistory?.item
    // an online stream that changed quality/server/provider carries on where it was (web previousState → initialState)
    const offlineStart = offline?.playback.startSeconds ?? online?.startSeconds
    const startPosition = React.useMemo(() => {
        if (offlineStart !== undefined) return offlineStart
        if (!info || !progressNumber || !historyItem?.duration) return 0
        return continuity.getEpisodeContinuitySeekTo(progressNumber, 0, historyItem.duration)
    }, [offlineStart, info, progressNumber, historyItem, continuity])
    // mpv options that only apply when a file opens go in first, into every mpv view: a refreshed online stream gets a
    // new view (its key below), which starts without them and without the subtitle look
    const viewKey = online ? `online-${online.reload}` : "file"
    const [optionsView, setOptionsView] = React.useState<string | null>(null)
    const mpvOptionsSet = optionsView === viewKey
    React.useEffect(() => {
        const view = mpv.current
        if (!view) return
        let alive = true
        void Promise.all(MPV_OPEN_OPTIONS.map(([name, value]) => view.setPropertyString(name, value).catch(() => {})))
            .then(() => alive && setOptionsView(viewKey))
        return () => {
            alive = false
        }
    }, [viewKey])
    // offline episodes do not wait for the watch history; every mode waits for the open options (preroll, E3 device fix)
    const source = info?.streamUrl && (offline || !waiting) && mpvOptionsSet ? info.streamUrl : undefined

    // ── Server channel (not for offline episodes) ──
    const commands = React.useRef<PlayerCommands>(null)
    const origin = React.useMemo(() => online ? { playbackType: "onlinestream" as const, onlinestreamParams: online.params } : undefined, [online])
    // an online stream tells the server about itself once it has its URL (not while the page is still getting the source)
    const events = usePlayerServer(info, commands, !offline && (!online || !!info?.streamUrl), origin)
    const onlineEvents = online?.events
    // video-loaded with the source, video-loaded-metadata + video-can-play once mpv opened the file (web order)
    const loadEvents = usePlayerLoadEvents(info?.id, !!source, { loaded: events.loaded, metadata: events.loadedMetadata, canPlay: events.canPlay })

    // ── Offline position ──
    const savedAtRef = React.useRef(0)
    const saveOffline = React.useCallback((seconds: number, ended: boolean) => {
        if (!offline) return
        savedAtRef.current = seconds
        offline.savePosition(offlinePositionToSave(seconds, ended))
    }, [offline])

    // ── "Save this episode" (online streams): the Go server downloads from the provider URL (no app token in it) ──
    const { mutate: download, isPending: saving } = useMobileOfflineDownload()
    const saveEpisode = () => {
        const request = online?.download
        if (!request || saving) return
        download(request, {
            onSuccess: () => {
                successFeedback()
                toast.success(t("Download started. See Downloads for progress.", "Download gestartet. Fortschritt unter Downloads."))
                void askForDownloadNotices().catch(() => undefined)
            },
        })
    }

    // ── Helpers ──
    const scheduleHide = React.useCallback(() => {
        if (hideTimer.current) clearTimeout(hideTimer.current)
        hideTimer.current = setTimeout(() => setVisible(false), HIDE_DELAY_MS)
    }, [])
    const showBars = React.useCallback(() => {
        setVisible(true)
        scheduleHide()
    }, [scheduleHide])
    const hideBars = React.useCallback(() => {
        if (hideTimer.current) clearTimeout(hideTimer.current)
        setVisible(false)
    }, [])
    React.useEffect(() => () => {
        if (hideTimer.current) clearTimeout(hideTimer.current)
    }, [])

    const seekTo = React.useCallback((time: number) => {
        const target = clampTime(time, timeRef.current.duration)
        playedRef.current = { played: target, previous: target, seeking: false }
        setPosition(target)
        mpv.current?.seekTo(target).catch(() => {})
    }, [])
    const seekBy = React.useCallback((seconds: number) => seekTo(timeRef.current.currentTime + seconds), [seekTo])
    const togglePlay = React.useCallback(() => {
        mpv.current?.togglePlay().catch(() => {})
    }, [])

    const flash = React.useCallback((text: string, ms: number) => {
        setMessage(text)
        setTimeout(() => setMessage(current => current === text ? null : current), ms)
    }, [])

    // ── Tracks ──
    const mkvAudio = info?.mkvMetadata?.audioTracks
    const mkvSubs = info?.mkvMetadata?.subtitleTracks

    const selectAudio = React.useCallback((track: PlayerTrack, remember = true) => {
        setAudioId(track.id)
        mpv.current?.setAudioTrack(track.id).catch(() => {})
        if (remember && mediaId) setTrackMemory(memory => rememberTrack(memory, mediaId, "audio", track))
    }, [mediaId, setTrackMemory])

    const selectSubtitle = React.useCallback((track: PlayerTrack | null, remember = true) => {
        setSubId(track?.id ?? 0)
        mpv.current?.setSubtitleTrack(track?.id ?? -1).catch(() => {})
        if (remember && mediaId) setTrackMemory(memory => rememberTrack(memory, mediaId, "sub", track))
    }, [mediaId, setTrackMemory])

    const offlineFiles = offline?.playback
    const loadTracks = React.useCallback(async () => {
        const view = mpv.current
        if (!view) return
        // A saved episode's own files: its separate audio track (HLS downloads) is the episode's sound, the subtitles
        // are offered like embedded ones
        if (offlineFiles?.audioUrl) await view.addAudio(offlineFiles.audioUrl, "select").catch(() => {})
        for (const sub of offlineFiles?.subtitles ?? []) {
            await view.addSubtitle(sub.url, sub.default ? "select" : "auto", sub.label, sub.language).catch(() => {})
        }
        // Subtitle files the server found next to the stream (torrents, Nakama), added without selecting; an online
        // stream's default subtitle is shown unless a preference below says otherwise (web isDefaultSubtitleTrack)
        for (const sub of info?.subtitleTracks ?? []) {
            if (!sub.src) continue
            const resolved = resolveStreamUrl(sub.src, getServerBaseUrl())
            const src = resolved.startsWith("http") ? resolved : getServerBaseUrl() + resolved
            await view.addSubtitle(src, online && sub.default ? "select" : "auto", sub.label, sub.language).catch(() => {})
        }
        const list = (await readTrackList(() => view.getTrackList(), () => mpv.current === view))
            .map(toPlayerTrack)
        if (mpv.current !== view) return
        setTracks(list)
        const current = await view.getCurrentTrackIds().catch(() => null)
        const memory = mediaId ? trackMemory[String(mediaId)] : undefined
        const audio = pickTrack(list, "audio", memory?.audio, languageList(settings.preferredAudioLanguage))
        const sub = preferredOnlineSubtitle(list, online?.subtitlePreference)
            ?? pickTrack(list, "sub", memory?.sub, languageList(settings.preferredSubtitleLanguage), languageList(settings.preferredSubtitleBlacklist))
        if (audio !== null) {
            setAudioId(audio)
            if (audio !== current?.aid) await view.setAudioTrack(audio).catch(() => {})
        } else setAudioId(current?.aid ?? 0)
        if (sub !== null) {
            setSubId(Math.max(0, sub))
            if (sub !== current?.sid) await view.setSubtitleTrack(sub).catch(() => {})
        } else setSubId(current?.sid ?? 0)
        setTracksReady(true)
    }, [offlineFiles, info?.subtitleTracks, mediaId, trackMemory, settings.preferredAudioLanguage, settings.preferredSubtitleLanguage,
        settings.preferredSubtitleBlacklist, online])

    // ── Translate subtitles: a translated track is an extra subtitle file in mpv (use-subtitle-translation) ──
    const refreshTracks = React.useCallback(async () => {
        const view = mpv.current
        if (!view) return []
        const list = (await view.getTrackList().catch(() => [])).map(toPlayerTrack)
        if (mpv.current === view) setTracks(list)
        return list
    }, [])
    const translationSources = React.useMemo(() => ({
        mkvSubs,
        // the server's MP4 text tracks (mpv shows them from the file itself, in the same order)
        embeddedContents: (info?.subtitleTracks ?? []).filter(sub => !sub.src && !!sub.content).map(sub => sub.content ?? ""),
        // the files loadTracks adds, in its order
        externalFiles: [
            ...(offlineFiles?.subtitles ?? []).map(sub => ({ label: sub.label, url: sub.url })),
            ...(info?.subtitleTracks ?? []).filter(sub => !!sub.src).map(sub => {
                const resolved = resolveStreamUrl(sub.src ?? "", getServerBaseUrl())
                return { label: sub.label, url: resolved.startsWith("http") ? resolved : getServerBaseUrl() + resolved }
            }),
        ],
    }), [mkvSubs, info?.subtitleTracks, offlineFiles])
    const translation = useSubtitleTranslation({
        mpv,
        sessionKey: source ? `${info?.id ?? ""}|${viewKey}` : null,
        tracks,
        subId,
        tracksReady,
        selectSubtitle,
        refreshTracks,
        positionMs: () => timeRef.current.currentTime * 1000,
        sources: translationSources,
    })

    // Subtitle look, applied on every load (a new view of a refreshed online stream), on every track change and whenever
    // it changes (sizes need a loaded file in mpv): the "Subtitle styles" for an ASS track, the "Caption style" for a plain
    // one (player-menu-logic subtitleLookProperties).
    // The settings' picture fit, subtitle delay and "Stronger colours" go along (2.0.32 "Picture", "Delay", "Player
    // appearance", here as mpv properties).
    const videoFit = useAtomValue(vc_videoFitAtom)
    const subtitleDelay = settings.subtitleDelay ?? 0
    const strongerColours = useAtomValue(vc_beautifyImageAtom)
    const playingSub = tracks.find(track => track.type === "sub" && track.id === subId)
    const playingSubKind = subtitleKind(playingSub?.codec)
    const playingSubStyles = assStyleCount(mkvSubs?.find(track => track.number === mpvIdToMkvNumber(mkvSubs, subId))?.codecPrivate)
    const applySubtitleStyle = React.useCallback(() => {
        const look = subtitleLookProperties(settings, playingSubKind, playingSubStyles)
        for (const [name, value] of [...look, ...pictureFitProperties(videoFit), ["sub-delay", String(subtitleDelay)],
            ...colourProperties(strongerColours, settings.videoEnhancement)]) {
            mpv.current?.setPropertyString(name, value).catch(() => {})
        }
    }, [settings, playingSubKind, playingSubStyles, videoFit, subtitleDelay, strongerColours])
    React.useEffect(() => {
        if (loaded) applySubtitleStyle()
    }, [loaded, applySubtitleStyle])

    // ── Skip segments: the file's chapters, else AniSkip ──
    const segments = React.useMemo<SkipSegment[]>(() => {
        const chapters = info?.mkvMetadata?.chapters ?? []
        if (chapters.length && duration > 1) {
            const list = chapters.slice().sort((a, b) => a.start - b.start).map((c, i, all) => ({
                label: c.text || null,
                start: c.start,
                end: c.end || all[i + 1]?.start || duration,
            }))
            return getSkipChapters(list, preferences.skipPatterns).map(c => ({ start: c.start, end: c.end, label: c.label ?? "Chapter" }))
        }
        return aniSkipSegments(skipData, duration)
    }, [info?.mkvMetadata?.chapters, duration, skipData, preferences.skipPatterns])
    // the time bar in chapters, openings/endings in amber while "Mark skippable parts" is on (2.0.32 Player appearance)
    const highlightSkips = useAtomValue(vc_highlightOPEDChaptersAtom)
    const barPieces = React.useMemo(() => timeBarPieces(duration, (info?.mkvMetadata?.chapters ?? []).map(c => c.start), segments),
        [duration, info?.mkvMetadata?.chapters, segments])
    const skipSegment = activeSkipSegment(segments, position)

    React.useEffect(() => {
        if (!skipSegment || !autoSkip || skippedRef.current === skipSegment.start) return
        skippedRef.current = skipSegment.start
        seekTo(skipSegment.end)
        flash(t(`Skipped ${skipSegment.label}`, `${skipSegment.label} übersprungen`), 1000)
    }, [skipSegment, autoSkip, seekTo, flash, t])

    // ── Auto next countdown and sleep timer ──
    // Progress re-renders several times a second; the timers below depend only on their own value so they keep running
    const playNext = React.useEffectEvent(() => playlist.playEpisode("next"))
    React.useEffect(() => {
        if (countdown === null) return
        const timer = setTimeout(() => {
            const next = countdownTick(countdown)
            setCountdown(next.seconds)
            if (next.play) playNext()
        }, 1000)
        return () => clearTimeout(timer)
    }, [countdown])

    const sleepTimerFired = React.useEffectEvent(() => {
        mpv.current?.pause().catch(() => {})
        setSleepTimer(null)
        toast.info(t("Sleep timer: paused", "Sleep-Timer: pausiert"))
    })
    React.useEffect(() => {
        if (typeof sleepTimer !== "number") return
        const timer = setTimeout(() => sleepTimerFired(), Math.max(sleepTimer - Date.now(), 0))
        return () => clearTimeout(timer)
    }, [sleepTimer])

    const handleEnded = () => {
        if (endedRef.current) return
        // a stream the demuxer gave up on: an error (the online stream tries the next server/provider), never the end of
        // the episode with auto next
        if (endedEarly(playedRef.current.played, timeRef.current.duration)) {
            const error = t("The stream stopped early.", "Der Stream hat vorzeitig aufgehört.")
            events.error(error)
            if (onlineEvents?.current) onlineEvents.current.error(error)
            else setVideoError(error)
            return
        }
        endedRef.current = true
        events.ended(autoNext)
        saveOffline(0, true)
        switch (endAction(sleepTimer, autoNext, playlist.hasNextEpisode)) {
            case "stop-sleep":
                setSleepTimer(null)
                toast.info(t("Sleep timer: stopped after this episode", "Sleep-Timer: nach dieser Folge gestoppt"))
                break
            case "countdown":
                setCountdown(AUTO_NEXT_SECONDS)
                break
            case "play-next":
                playlist.playEpisode("next")
                break
        }
    }

    // ── Fullscreen ↔ small (box/mini), PiP, close ──
    // the bottom-right button and Back: the frame moves, the stream plays on (no remount of the mpv view)
    const toggleFullscreen = () => {
        setMenuOpen(false)
        setVolumeOpen(false)
        setSmall(!small)
    }
    // a phone turns to landscape for fullscreen and upright for the box/mini (only after the app turned it); a tablet
    // keeps its orientation (player-chrome viewTurn)
    React.useEffect(() => {
        switch (viewTurn(view, isTablet)) {
            case "landscape":
                setVideoFullscreenOrientation(true, false)
                break
            case "upright":
                if (turnedToLandscape()) setVideoFullscreenOrientation(false, false)
                break
        }
    }, [view, isTablet])
    const reportFullscreen = React.useEffectEvent((on: boolean) => events.fullscreen(on))
    React.useEffect(() => {
        reportFullscreen(fullscreen)
    }, [fullscreen])

    const close = React.useCallback(async () => {
        setCountdown(null)
        if (!endedRef.current) saveOffline(timeRef.current.currentTime, false)
        await mpv.current?.prepareForExit().catch(() => {})
        restoreBrightness()
        endPlayerOrientation()
        events.terminated()
        onClose()
    }, [events, onClose, saveOffline])
    // The player can also go without close(): another stream takes its place (server stream over an online or saved
    // episode) or the server aborts the start. The window brightness and a fullscreen lock must not outlive it.
    React.useEffect(() => () => {
        restoreBrightness()
        endPlayerOrientation()
    }, [])

    const commandsValue: PlayerCommands = {
        getTime: () => timeRef.current,
        pause: () => mpv.current?.pause().catch(() => {}),
        resume: () => mpv.current?.play().catch(() => {}),
        seekTo,
        terminate: () => void close(),
        setAudioTrack: number => {
            const id = mkvNumberToMpvId(mkvAudio, number)
            const track = tracks.find(tr => tr.type === "audio" && tr.id === id)
            if (track) selectAudio(track, false)
        },
        setSubtitleTrack: number => {
            const id = mkvNumberToMpvId(mkvSubs, number)
            if (id === -1) selectSubtitle(null, false)
            const track = tracks.find(tr => tr.type === "sub" && tr.id === id)
            if (track) selectSubtitle(track, false)
        },
        getAudioTrack: () => mpvIdToMkvNumber(mkvAudio, audioId),
        getSubtitleTrack: () => mpvIdToMkvNumber(mkvSubs, subId),
        showMessage: flash,
        isFullscreen: () => fullscreen,
        isPip: () => pip,
        playEpisode: playlist.playEpisode,
    }
    React.useLayoutEffect(() => {
        commands.current = commandsValue
    })

    // ── Gestures on the video (VideoControlInjector.kt) ──
    const gesture = React.useRef<SurfaceGesture | null>(null)
    const longPress = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const tapMemory = React.useRef<TapMemory>(null)
    const singleTap = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const surface = React.useRef({ width: 0, height: 0 })
    const speedBeforeBoost = React.useRef(1)

    const onGrant = (e: GestureResponderEvent) => {
        const { locationX: x, locationY: y, pageX, pageY, timestamp } = e.nativeEvent
        const g: SurfaceGesture = { x, y, side: sideOf(x, surface.current.width), kind: null, startLevel: 0, kindY: y, moved: false, levels: { brightness: 0.5, volume: 0.5 },
            pageX, pageY, last: { y: pageY, t: timestamp }, previous: { y: pageY, t: timestamp } }
        gesture.current = g
        // the levels are read now so they are there once the finger has moved far enough to count as a swipe
        readBrightness().then(v => (g.levels.brightness = v))
        readVolume().then(v => (g.levels.volume = v))
        if (longPress.current) clearTimeout(longPress.current)
        longPress.current = setTimeout(() => {
            if (gesture.current !== g || g.kind || !timeRef.current || timeRef.current.paused) return
            g.kind = "boost"
            speedBeforeBoost.current = speed
            setBoosting(true)
            setHud({ side: "center", text: `${BOOST_RATE}x`, kind: null })
        }, LONG_PRESS_MS)
    }

    const onMove = (e: GestureResponderEvent) => {
        const g = gesture.current
        if (!g || g.kind === "boost") return
        const { locationX: x, locationY: y, pageX, pageY, timestamp } = e.nativeEvent
        // the box: a vertical drag scrolls the page under it (window coordinates, the box moves with the page)
        if (box) {
            g.previous = g.last
            g.last = { y: pageY, t: timestamp }
            if (!g.kind && isScrollDrag(pageX - g.pageX, pageY - g.pageY)) {
                g.kind = "scroll"
                g.moved = true
                if (longPress.current) clearTimeout(longPress.current)
                g.pageY = pageY
                box.scroller.begin()
            }
            if (g.kind === "scroll") box.scroller.move(pageY - g.pageY)
            else if (Math.abs(pageX - g.pageX) > 10) {
                g.moved = true
                if (longPress.current) clearTimeout(longPress.current)
            }
            return
        }
        const dx = x - g.x
        const dyUp = g.y - y
        if (Math.abs(dx) > 10 || Math.abs(dyUp) > 10) {
            g.moved = true
            if (longPress.current) clearTimeout(longPress.current)
        }
        if (!g.kind) {
            const kind = classifySwipe(dx, dyUp, g.side)
            if (!kind) return
            g.kind = kind
            g.startLevel = g.levels[kind]
            g.kindY = y
        }
        const level = swipeLevel(g.startLevel, g.kindY - y, surface.current.height)
        if (g.kind === "brightness") writeBrightness(level)
        else writeVolume(level)
        setHud({ side: g.side, text: `${Math.round(level * 100)} %`, kind: g.kind as SwipeKind, level })
    }

    const onEnd = (e: GestureResponderEvent, cancelled: boolean) => {
        if (longPress.current) clearTimeout(longPress.current)
        const g = gesture.current
        gesture.current = null
        if (!g) return
        if (g.kind === "boost") {
            setBoosting(false)
            setHud(null)
            return
        }
        if (g.kind === "scroll") {
            const ms = g.last.t - g.previous.t
            box?.scroller.end(!cancelled && ms > 0 ? (g.last.y - g.previous.y) / ms * 1000 : 0)
            return
        }
        if (g.kind) {
            setTimeout(() => setHud(null), 600)
            return
        }
        // a swipe or long press never toggles the controls; only a real tap does
        if (cancelled || g.moved) return
        const side = sideOf(e.nativeEvent.locationX, surface.current.width)
        const { double, memory } = classifyTap(tapMemory.current, Date.now(), side)
        tapMemory.current = memory
        if (singleTap.current) clearTimeout(singleTap.current)
        if (double) {
            const seconds = doubleTapSeekSeconds(side)
            seekBy(seconds)
            setRipple({ side, text: seconds > 0 ? `+${seconds}` : `${seconds}`, key: Date.now() })
            showBars()
            return
        }
        // a tap beside the open volume pill only closes it (its outside-pointerdown)
        if (volumeOpen) {
            setVolumeOpen(false)
            scheduleHide()
            return
        }
        const wasVisible = visible
        singleTap.current = setTimeout(() => (wasVisible ? hideBars() : showBars()), DOUBLE_TAP_MS)
    }

    React.useEffect(() => {
        if (!ripple) return
        const timer = setTimeout(() => setRipple(null), 700)
        return () => clearTimeout(timer)
    }, [ripple])

    // ── Native player events ──
    // Whether mpv plays. expo-mpv's state event can be wrong or missing right after the source is set (S22 + Tablet:
    // play icon and spinner over a playing video), so mpv's own pause flag is read on load and while unsure.
    // ended: the end saves position 0 for an offline episode itself (handleEnded), so a pause there saves nothing
    const applyPlaying = (isPlaying: boolean, ended = false) => {
        if (isPlaying === playingRef.current) return
        playingRef.current = isPlaying
        setPlaying(isPlaying)
        timeRef.current = { ...timeRef.current, paused: !isPlaying }
        if (isPlaying) {
            setCountdown(null)
            scheduleHide()
            events.resumed()
        } else {
            playOnLoad.current = false
            events.paused()
            if (!ended) saveOffline(timeRef.current.currentTime, false)
        }
    }
    const syncPlaying = () => {
        mpv.current?.getPlaybackInfo().then(i => applyPlaying(i.isPlaying)).catch(() => {})
    }

    const effectiveSpeed = boosting ? BOOST_RATE : speed
    // an open volume pill keeps the bars, like an open player menu did
    const barsShown = visible || !playing || volumeOpen
    // the frame the controls fill: the window, or the box (r22) with no system insets inside it
    const frameWidth = box ? box.geometry.content.width : window.width
    const edge = box ? { top: 0, bottom: 0, left: 0, right: 0 } : insets
    // --vc-* of media-core-controls.css by the player's width (control-sizes.ts); from 1000dp the tablet's values
    const vc = box ? boxControlSizes(frameWidth, box.geometry.content.height) : controlSizes(window.width)
    const barIcon = vc.icon
    const hasVideo = !!source && loaded
    const title = info?.episode?.displayTitle || (progressNumber ? t(`Episode ${progressNumber}`, `Folge ${progressNumber}`) : "")
    const animeTitle = info?.media?.title?.userPreferred ?? ""

    // ── Cast: the server's own stream with the tracks playing here (web video-core-cast tvUrl) ──
    const castBase = castableStreamUrl(source, getServerBaseUrl(), { online: !!online, separateAudio: !!offline?.playback.audioUrl })
    const castUrl = React.useMemo(() => castBase ? castUrlWithTracks(castBase, castTrackNumbers(mkvAudio, mkvSubs, audioId, subId)) : null,
        [castBase, mkvAudio, mkvSubs, audioId, subId])
    const pauseLocal = React.useCallback(() => {
        mpv.current?.pause().catch(() => {})
    }, [])
    const resumeLocal = React.useCallback((seconds: number | null, play: boolean) => {
        if (seconds !== null) seekTo(seconds)
        if (play) mpv.current?.play().catch(() => {})
    }, [seekTo])
    const playerCast = usePlayerCast({
        castUrl, ready: tracksReady, title: castTitle(animeTitle, title),
        artwork: info?.episode?.episodeMetadata?.image || info?.media?.coverImage?.large || "",
        playing, positionMs: () => timeRef.current.currentTime * 1000, pauseLocal, resumeLocal,
    })
    const castPill = !mini && playerCast.casting && !playerCast.open

    // Back (r22, player-chrome backStep): open menus first; fullscreen becomes small (box or mini) and plays on; in the box
    // or the mini player Back is the page's
    const onBack = React.useEffectEvent(() => {
        switch (backStep({ overlayOpen: menuOpen || playerCast.open, view })) {
            case "pass":
                return false
            case "shrink":
                toggleFullscreen()
                return true
        }
    })
    React.useEffect(() => {
        if (!fullscreen) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => onBack())
        return () => sub.remove()
    }, [fullscreen])
    const errorText = playbackError ?? videoError

    const barTiming = { duration: reduceMotion ? 0 : barsShown ? BAR_IN_MS : BAR_OUT_MS, easing: BAR_EASE }
    const barStyle = useAnimatedStyle(() => ({
        opacity: withTiming(barsShown ? 1 : 0, barTiming),
        // reduced motion: only the fade, no scale
        transform: [{ scale: withTiming(barsShown || reduceMotion ? 1 : 0.96, barTiming) }],
    }), [barsShown, reduceMotion])
    const fadeStyle = useAnimatedStyle(() => ({
        opacity: withTiming(barsShown ? 1 : 0, barTiming),
    }), [barsShown, reduceMotion])
    const pop = reduceMotion ? undefined : POP_IN
    const unpop = reduceMotion ? undefined : POP_OUT

    // the box has no screen edges inside it: its bars sit at its own edges (2.0.x inline: [data-vc-inline="true"])
    const fillsScreen = !!box || landscape
    // the top row's buttons, narrowed when they would not fit (control-sizes fitBarButton); the box leaves out the volume
    // (the phone's keys), its bars stay inside the page
    const showVolume = !box
    const topButtons = [playlist.hasPreviousEpisode, playlist.hasNextEpisode, true, (online?.qualities?.length ?? 0) > 1,
        tracks.some(track => track.type === "sub"), tracks.filter(track => track.type === "audio").length > 1,
        playerCast.available && !pip, canEnterPip(casting, hasVideo), showVolume].filter(Boolean).length
    const topButton = fitBarButton(vc.button, topButtons, frameWidth - edge.left - edge.right - vc.padX * 2 - (topButtons - 1) * 2)
    const barFadeTop = box ? BOX_BAR_FADE : 24
    const barFadeBottom = box ? BOX_BAR_FADE : 28
    // the bottom bar's height (row + time bar + room under it): the centre buttons sit between the bars in the box
    const bottomBarHeight = barFadeBottom + vc.button + 44 + bottomPad(frameWidth, !mini && !box, edge.bottom)
    const topBarHeight = topPad(frameWidth, fillsScreen, edge.top) + vc.button
    // Mini player (player-chrome miniFrame): a bar above the phone's navigation bar, 2.0.33's card beside the tablet's rail
    const navBar = useNavBarHeight()
    const miniBox = miniFrame({ width: window.width, rail: showsRail(isTablet, window), navBar, insets })
    // One tree in every place (the mpv view is never remounted): the outer frame clips, the body carries the picture and
    // the controls. Full: both fill the window above everything. Box: the outer frame is the page's scroll area (clip), the
    // body the box, moved with the page's scroll on the UI thread. Mini: the card.
    const boxStatic = box ? boxFrame(box.geometry, 0) : null
    const outerStyle = mini
        ? { position: "absolute" as const, right: miniBox.right, bottom: miniBox.bottom, width: miniBox.width, height: miniBox.height, borderRadius: 14, overflow: "hidden" as const, backgroundColor: colors.smSurfaceRaised }
        : boxStatic
            ? { position: "absolute" as const, ...boxStatic.clip, overflow: "hidden" as const }
            : { position: "absolute" as const, left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#000", zIndex: 50, elevation: 50 }
    const bodyStyle = boxStatic
        ? { position: "absolute" as const, left: boxStatic.box.left, top: 0, width: boxStatic.box.width, height: boxStatic.box.height, backgroundColor: "#000" }
        : { position: "absolute" as const, left: 0, top: 0, right: 0, bottom: 0 }
    const geometry = box?.geometry ?? null
    const bodyMotion = useAnimatedStyle(() => {
        if (!geometry) return { transform: [{ translateY: 0 }] }
        return { transform: [{ translateY: boxFrame(geometry, boxScroll.value).box.top }] }
    }, [geometry])
    // the picture keeps square corners (a SurfaceView ignores rounding), so in the mini player it sits inside the card's padding
    const videoStyle = mini
        ? { position: "absolute" as const, left: MINI_BAR.pad, top: MINI_BAR.pad, width: miniBox.video.width, height: miniBox.video.height, backgroundColor: "#000" }
        : { position: "absolute" as const, left: 0, top: 0, right: 0, bottom: 0 }

    return (<>
        <View collapsable={false} pointerEvents="box-none" style={outerStyle}>
        <Animated.View collapsable={false} style={[bodyStyle, bodyMotion]}>
            {playing && <KeepScreenOn />}

            <ExpoMpvView
                ref={mpv}
                // an online stream whose source was refreshed can come back with the same URL: a new view loads it again
                key={viewKey}
                style={videoStyle}
                source={source}
                startPosition={startPosition}
                speed={effectiveSpeed}
                volume={mpvVolume(volume, volumeBoost)}
                muted={muted}
                showNotificationControls={!!source}
                metadata={{
                    title: title || animeTitle,
                    artist: animeTitle,
                    artwork: info?.media?.coverImage?.large ?? info?.media?.coverImage?.medium ?? "",
                    ...sessionQueue(playlist.hasNextEpisode, playlist.hasPreviousEpisode),
                }}
                // lock screen, notification and headset next/previous: the same as the bar buttons
                onRemoteCommand={({ nativeEvent }) => {
                    const which = remoteEpisode(nativeEvent.command, playlist.hasNextEpisode, playlist.hasPreviousEpisode)
                    if (which) playlist.playEpisode(which)
                }}
                pictureInPictureEnabled={canEnterPip(casting, hasVideo) && view !== "mini"}
                onPictureInPictureChange={({ nativeEvent }) => {
                    pipRef.current = nativeEvent.isActive
                    setPip(nativeEvent.isActive)
                    // back from picture in picture: the bars show where it stands now
                    if (!nativeEvent.isActive) setPosition(timeRef.current.currentTime)
                    events.pip(nativeEvent.isActive)
                }}
                onLoad={({ nativeEvent }) => {
                    setLoaded(true)
                    setBuffering(false)
                    const start = loadStart(autoPlay, playOnLoad.current)
                    playOnLoad.current = false
                    if (start === "pause") void mpv.current?.pause().then(syncPlaying).catch(() => {})
                    else if (start === "play") void mpv.current?.play().then(syncPlaying).catch(() => {})
                    else syncPlaying()
                    setDuration(nativeEvent.duration)
                    timeRef.current = { ...timeRef.current, duration: nativeEvent.duration }
                    loadEvents.opened()
                    onlineEvents?.current?.loaded()
                    applySubtitleStyle()
                    void loadTracks()
                }}
                onPlaybackStateChange={({ nativeEvent }) => {
                    const { state } = nativeEvent
                    applyPlaying(isPlayingState(state, nativeEvent.isPlaying), state === "ended")
                    endedRef.current = stillEnded(endedRef.current, state)
                    if (state === "ended") handleEnded()
                }}
                onProgress={({ nativeEvent }) => {
                    const { position: p, duration: d, bufferedPosition } = nativeEvent
                    timeRef.current = { ...timeRef.current, currentTime: p, duration: d }
                    // picture in picture shows only the picture: no re-render of hidden bars per tick (r22 PiP)
                    if (!pipRef.current) {
                        setPosition(p)
                        if (d > 0 && d !== duration) setDuration(d)
                        setBuffered(bufferedPosition)
                    }
                    onlineEvents?.current?.time(p)
                    if (offline && Math.abs(p - savedAtRef.current) >= OFFLINE_SAVE_EVERY_S) saveOffline(p, false)
                    // progress only ticks while mpv plays; a missed state event is caught up here
                    if (!playingRef.current) syncPlaying()
                    // a seek (also from the lock screen, which bypasses seekTo) lands where it lands
                    const track = playedRef.current
                    const played = track.seeking ? p : playedPosition(track.played, track.previous, p)
                    playedRef.current = { played, previous: p, seeking: false }
                    if (shouldSendCompleted(completedRef.current, played, d)) {
                        completedRef.current = true
                        events.completed()
                    }
                }}
                onBuffer={({ nativeEvent }) => setBuffering(nativeEvent.isBuffering)}
                onSeek={() => {
                    playedRef.current = { ...playedRef.current, seeking: true }
                    events.seeked()
                }}
                onError={({ nativeEvent }) => {
                    events.error(nativeEvent.error)
                    // an online stream first tries a fresh source, another server, then the next provider (cycler);
                    // the page shows its own error once nothing is left
                    if (onlineEvents?.current) onlineEvents.current.error(nativeEvent.error)
                    else setVideoError(nativeEvent.error)
                }}
            />

            {mini ? (
                <MiniPlayer
                    frame={miniBox}
                    title={title || loadingState || ""}
                    subtitle={animeTitle}
                    playing={playing}
                    loading={(buffering || !source) && !errorText}
                    error={errorText}
                    progress={progressFraction(position, duration)}
                    onExpand={() => {
                        setSmall(false)
                        showBars()
                    }}
                    onPlay={() => {
                        // what the button shows is what it does (a toggle could meet a state change on the way)
                        if (miniPlayCommand(playing) === "pause") mpv.current?.pause().catch(() => {})
                        else mpv.current?.play().catch(() => {})
                    }}
                    onClose={() => void close()}
                />
            ) : pip ? null : (
                <>
                    {/* The video surface: taps, double taps, swipes, long press; in the box a vertical drag scrolls the page */}
                    <View
                        style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
                        onLayout={e => (surface.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
                        onStartShouldSetResponder={() => true}
                        onResponderTerminationRequest={() => true}
                        onResponderGrant={onGrant}
                        onResponderMove={onMove}
                        onResponderRelease={e => onEnd(e, false)}
                        onResponderTerminate={e => onEnd(e, true)}
                    />

                    {(buffering || !source) && !errorText && (
                        <View pointerEvents="none" className="absolute inset-0 items-center justify-center gap-3">
                            <ActivityIndicator color="#fff" size="large" />
                            {!!loadingState && <Text className="px-8 text-center text-[15px] text-white/80">{loadingState}</Text>}
                        </View>
                    )}

                    {!!errorText && (
                        <View className="absolute inset-0 items-center justify-center gap-4 bg-black/80 px-8">
                            <Text className="text-center text-[15px] text-white">{errorText}</Text>
                            <Pressable accessibilityRole="button" onPress={() => void close()} className="rounded-full bg-white/15 px-5 py-2.5 active:bg-white/25">
                                <Text className="font-semibold text-white">{t("Close", "Schließen")}</Text>
                            </Pressable>
                        </View>
                    )}

                    {!!ripple && (
                        <View pointerEvents="none" className="absolute top-0 bottom-0 justify-center" style={ripple.side === "left" ? { left: "12%" } : { right: "12%" }}>
                            <Animated.View key={ripple.key} entering={pop} exiting={unpop} className="rounded-full bg-black/55 px-4 py-2.5">
                                <Text className="text-[15px] font-semibold text-white">{ripple.text} s</Text>
                            </Animated.View>
                        </View>
                    )}

                    {!!hud && (
                        <View pointerEvents="none" className="absolute"
                            style={hud.side === "center" ? { top: "12%", alignSelf: "center" } : hud.side === "left" ? { top: "45%", left: "8%" } : { top: "45%", right: "8%" }}>
                            {hud.level !== undefined && hud.side !== "center"
                                ? <LevelPanel text={hud.text} level={hud.level} fromRight={hud.side === "right"} isTablet={isTablet} />
                                : <Animated.View entering={pop} exiting={unpop} className="rounded-full bg-black/65 px-4 py-2.5">
                                    <Text className="text-[15px] font-semibold text-white">{hud.text}</Text>
                                </Animated.View>}
                        </View>
                    )}

                    {!!message && (
                        <View pointerEvents="none" className="absolute self-center rounded-full bg-black/65 px-4 py-2" style={{ top: edge.top + (box ? 52 : castPill ? 116 : 64) }}>
                            <Text className="text-sm font-semibold text-white">{message}</Text>
                        </View>
                    )}

                    {/* Top bar */}
                    <Animated.View pointerEvents={barsShown ? "box-none" : "none"} style={[fadeStyle, {
                        position: "absolute", left: 0, right: 0, top: 0,
                        paddingTop: topPad(frameWidth, fillsScreen, edge.top), paddingLeft: edge.left + vc.padX, paddingRight: edge.right + vc.padX, paddingBottom: barFadeTop,
                        backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.62), rgba(0,0,0,0.26) 62%, transparent)",
                    }]}>
                        {/* 2.0.32's row (video-core.tsx VideoCoreMobileControlBar): episode buttons and, from 560dp, the title on
                            the left; settings, quality, subtitles, audio, cast, picture in picture and volume on the right.
                            r22: no close arrow and no loading "minimise" (Nick 11.11.): the bottom-right button makes it small. */}
                        <BarSizeContext value={topButton}>
                        <View className="flex-row items-center gap-0.5" style={{ minHeight: vc.button }}>
                            {playlist.hasPreviousEpisode && (
                                <BarButton label={t("Previous episode", "Vorige Folge")} onPress={() => playlist.playEpisode("previous")}><SkipBack size={barIcon} color="#fff" /></BarButton>
                            )}
                            {playlist.hasNextEpisode && (
                                <BarButton label={t("Next episode", "Nächste Folge")} onPress={() => playlist.playEpisode("next")}><SkipForward size={barIcon} color="#fff" /></BarButton>
                            )}
                            <View className="min-w-0 flex-1 px-2" pointerEvents="none">
                                {frameWidth >= 560 && <View style={{ maxWidth: frameWidth * 0.46 }}>
                                    {!!animeTitle && <Text numberOfLines={1} className="text-white/70" style={{ fontSize: vc.titleText * 0.9 }}>{animeTitle}</Text>}
                                    {!!title && <Text numberOfLines={1} className="font-semibold text-white" style={{ fontSize: vc.titleText + 1 }}>{title}</Text>}
                                </View>}
                            </View>
                            <BarButton label={t("Settings", "Einstellungen")} onPress={button => openMenu("main", button)}><Settings size={barIcon} color="#fff" /></BarButton>
                            {(online?.qualities?.length ?? 0) > 1 && (
                                <BarButton label={t("Quality", "Qualität")} onPress={button => openMenu("quality", button)}><Film size={barIcon} color="#fff" /></BarButton>
                            )}
                            {tracks.some(track => track.type === "sub") && (
                                <BarButton label={t("Subtitles", "Untertitel")} onPress={button => openMenu("subtitles", button)}><Captions size={barIcon} color="#fff" /></BarButton>
                            )}
                            {tracks.filter(track => track.type === "audio").length > 1 && (
                                <BarButton label={t("Audio", "Ton")} onPress={button => openMenu("audio", button)}><Headphones size={barIcon} color="#fff" /></BarButton>
                            )}
                            {playerCast.available && !pip && (
                                <BarButton label={playerCast.casting ? t("Playing on TV", "Läuft auf dem Fernseher") : t("Cast to a TV", "Auf Fernseher übertragen")}
                                    onPress={() => playerCast.setOpen(true)}>
                                    <Cast size={barIcon} color={playerCast.casting ? colors.smAccent : "#fff"} />
                                </BarButton>
                            )}
                            {canEnterPip(casting, hasVideo) && (
                                <BarButton label={t("Picture in picture", "Bild im Bild")} onPress={() => void mpv.current?.enterPictureInPicture()}>
                                    <PictureInPicture2 size={barIcon} color="#fff" />
                                </BarButton>
                            )}
                            {showVolume && <VolumeButton volume={volume} muted={muted} open={volumeOpen} iconSize={barIcon} size={topButton} onToggle={() => {
                                if (volumeOpen) scheduleHide()
                                else if (hideTimer.current) clearTimeout(hideTimer.current)
                                setVolumeOpen(!volumeOpen)
                            }} />}
                        </View>
                        </BarSizeContext>
                    </Animated.View>

                    {volumeOpen && barsShown && showVolume && (
                        <VolumePanel top={topPad(window.width, fillsScreen, insets.top) + vc.button + 6} right={insets.right + vc.padX} width={window.width}
                            volume={volume} muted={muted} onVolume={setVolume} onMuted={setMuted}
                            onClose={() => {
                                setVolumeOpen(false)
                                scheduleHide()
                            }} />
                    )}

                    {/* "Playing on …": stays while the bars hide, the phone is paused while the TV plays */}
                    {castPill && (
                        <Animated.View entering={pop} exiting={unpop} pointerEvents="box-none" className="absolute left-0 right-0 items-center"
                            style={{ top: (fillsScreen ? 8 : edge.top) + 60 }}>
                            <CastPill device={playerCast.state.device ?? ""} onPress={() => playerCast.setOpen(true)} />
                        </Animated.View>
                    )}

                    {/* Centre: −5, play/pause, +10 */}
                    {!!source && !errorText && (
                        <Animated.View pointerEvents={barsShown ? "box-none" : "none"} style={[barStyle, {
                            // the box: between its bars (the 214dp box has no room for them to overlap the centre)
                            position: "absolute", left: 0, right: 0, top: box ? topBarHeight : 0, bottom: box ? bottomBarHeight - barFadeBottom : 0,
                            alignItems: "center", justifyContent: "center",
                        }]}>
                            <View className="flex-row items-center" style={{ gap: vc.centerGap }} pointerEvents="box-none">
                                <CenterSeek seconds={-SEEK_BACK_SECONDS} size={vc.seek} onSeek={s => { seekBy(s); showBars() }} />
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={playing ? t("Pause", "Pause") : t("Play", "Abspielen")}
                                    onPress={() => { togglePlay(); showBars() }}
                                    className="items-center justify-center rounded-full border border-white/20 bg-black/40 active:bg-black/55"
                                    style={({ pressed }) => ({ width: vc.play, height: vc.play, transform: [{ scale: pressed ? 0.92 : 1 }] })}
                                >
                                    <PlayPauseIcon playing={playing} size={vc.playIcon} />
                                </Pressable>
                                <CenterSeek seconds={SEEK_FORWARD_SECONDS} size={vc.seek} onSeek={s => { seekBy(s); showBars() }} />
                            </View>
                        </Animated.View>
                    )}

                    {/* Skip intro/outro and the auto next countdown sit above the bottom bar */}
                    {countdown !== null ? (
                        <Animated.View entering={pop} exiting={unpop} className="absolute right-3 flex-row items-center gap-2 rounded-full bg-black/70 py-1.5 pl-4 pr-1.5"
                            style={{ bottom: box ? bottomBarHeight - barFadeBottom + 4 : (fillsScreen ? 8 : insets.bottom) + 96 }}>
                            <Text className="text-sm font-semibold text-white">{t(`Next episode in ${countdown}`, `Nächste Folge in ${countdown}`)}</Text>
                            <Pressable accessibilityRole="button" onPress={() => setCountdown(null)} className="rounded-full px-3 py-2 active:bg-white/15">
                                <Text className="text-sm text-white/80">{t("Cancel", "Abbrechen")}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" onPress={() => { setCountdown(null); playlist.playEpisode("next") }} className="rounded-full bg-white px-3 py-2 active:bg-white/80">
                                <Text className="text-sm font-semibold text-black">{t("Play now", "Jetzt abspielen")}</Text>
                            </Pressable>
                        </Animated.View>
                    ) : (!!skipSegment && !autoSkip && barsShown && !box && (
                        <Pressable accessibilityRole="button" onPress={() => seekTo(skipSegment.end)}
                            className="absolute right-3 rounded-full border border-white/25 bg-black/70 px-4 py-2.5 active:bg-black/85"
                            style={{ bottom: box ? bottomBarHeight - barFadeBottom + 4 : (fillsScreen ? 8 : insets.bottom) + 96 }}>
                            <Text className="text-sm font-semibold text-white">{t(`Skip ${skipSegment.label}`, `${skipSegment.label} überspringen`)}</Text>
                        </Pressable>
                    ))}

                    {/* Bottom bar: full fills the screen ([data-vc-inline="false"]), upright too: the 1.25rem room under it; the box
                        ([data-vc-inline="true"]) only its own padding */}
                    <Animated.View pointerEvents={barsShown ? "box-none" : "none"} style={[fadeStyle, {
                        position: "absolute", left: 0, right: 0, bottom: 0,
                        paddingTop: barFadeBottom, paddingBottom: bottomPad(frameWidth, !mini && !box, edge.bottom), paddingLeft: edge.left + vc.padX, paddingRight: edge.right + vc.padX,
                        backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0.3) 62%, transparent)",
                    }]}>
                        <BarSizeContext value={vc.button}>
                        <View className="flex-row items-center gap-0.5" style={{ minHeight: vc.button }}>
                            <Pressable accessibilityRole="button" onPress={() => setRemainingMode(m => !m)} className="justify-center px-2" style={{ minHeight: vc.button }}>
                                <Text className="font-semibold text-white" style={{ fontSize: vc.timeText, fontVariant: ["tabular-nums"] }}>
                                    {remainingMode ? `-${formatTime(duration - position)}` : formatTime(position)}
                                    <Text className="font-medium text-white/65" style={{ fontSize: vc.timeText }}> / {formatTime(duration)}</Text>
                                </Text>
                            </Pressable>
                            <View className="flex-1" />
                            {/* the box (~214dp) has no room above its bar: "Skip" sits in the row, beside the size button */}
                            {!!box && !!skipSegment && !autoSkip && countdown === null && (
                                <Pressable accessibilityRole="button" onPress={() => seekTo(skipSegment.end)} hitSlop={4}
                                    className="mr-1 justify-center rounded-full border border-white/25 bg-black/60 px-3 active:bg-black/80" style={{ height: 36 }}>
                                    <Text numberOfLines={1} className="text-[13px] font-semibold text-white">{t(`Skip ${skipSegment.label}`, `${skipSegment.label} überspringen`)}</Text>
                                </Pressable>
                            )}
                            {/* r22: on every device (tablets too): fullscreen <-> the box on the anime page (else the mini player) */}
                            <BarButton label={fullscreen ? t("Exit fullscreen", "Vollbild beenden") : t("Fullscreen", "Vollbild")} onPress={toggleFullscreen}>
                                {fullscreen ? <Minimize size={barIcon} color="#fff" /> : <Maximize size={barIcon} color="#fff" />}
                            </BarButton>
                        </View>
                        </BarSizeContext>
                        <TimeBar
                            position={position}
                            duration={duration}
                            buffered={buffered}
                            pieces={barPieces}
                            highlight={highlightSkips}
                            track={vc.track}
                            thumbSize={vc.thumb}
                            onScrubStart={() => {
                                if (hideTimer.current) clearTimeout(hideTimer.current)
                                setVisible(true)
                            }}
                            onScrubEnd={target => {
                                if (target !== null) seekTo(target)
                                scheduleHide()
                            }}
                        />
                    </Animated.View>
                </>
            )}
        </Animated.View>
        </View>

        {/* Menus over the whole window, also from the box (r22); above the bar and rail while open */}
        <View ref={rootRef} collapsable={false} pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 60, elevation: menuOpen ? 60 : 0 }]}>
            <CastSheet cast={playerCast} title={castTitle(animeTitle, title)} hasNext={playlist.hasNextEpisode} onNext={() => playlist.playEpisode("next")} />

            <PlayerMenu
                open={menuOpen}
                onOpenChange={setMenuOpen}
                page={menuPage}
                onPageChange={setMenuPage}
                anchor={menuAnchor}
                subtitleKind={playingSubKind}
                tracks={tracks}
                audioId={audioId}
                subId={subId}
                onAudio={track => selectAudio(track)}
                onSubtitle={track => {
                    // a translation is no language to remember for the next episode
                    if (track && translation.translatedIds.has(track.id)) {
                        selectSubtitle(track, false)
                        return
                    }
                    if (track?.id !== subId) translation.onPick()
                    selectSubtitle(track)
                    // online streams also keep the web's per-anime subtitle preference (onSubtitlePreferenceChange)
                    onlineEvents?.current?.subtitle(track ? { language: track.lang, label: track.title } : null)
                }}
                onTranslateSettings={translation.onSettingsChange}
                speed={speed}
                onSpeed={setSpeed}
                qualities={online?.qualities}
                quality={online?.quality}
                onQuality={value => onlineEvents?.current?.quality(value)}
                onSave={online?.download ? saveEpisode : undefined}
                saving={saving}
                onExternal={packageName => {
                    if (!info?.streamUrl) return
                    mpv.current?.pause().catch(() => {})
                    setMenuOpen(false)
                    void openInPlayerApp(info.streamUrl, packageName)
                }}
            />
        </View>
    </>)
}

/** The brightness / volume panel: it slides in from its side, its bar glides to each new level (UI thread) */
function LevelPanel({ text, level, fromRight, isTablet }: { text: string, level: number, fromRight: boolean, isTablet: boolean }) {
    const fill = useAnimatedStyle(() => ({
        transform: [{ scaleX: withTiming(Math.max(0, Math.min(1, level)), { duration: LEVEL_PANEL.level, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System }) }],
    }), [level])
    return (
        <Animated.View entering={levelPanelIn(isTablet, fromRight)} exiting={levelPanelOut} className="w-28 gap-2 rounded-2xl bg-black/65 px-4 py-2.5">
            <Text className="text-center text-[15px] font-semibold text-white" style={{ fontVariant: ["tabular-nums"] }}>{text}</Text>
            <View className="h-1 overflow-hidden rounded-full bg-white/25">
                <Animated.View style={[{ height: "100%", width: "100%", transformOrigin: "left" }, fill]} className="rounded-full bg-white" />
            </View>
        </Animated.View>
    )
}

function KeepScreenOn() {
    useKeepAwake("seanime-player")
    return null
}

/** `--vc-btn` of the bar around the buttons (44dp, a tablet 48dp); the mini player keeps 44dp */
const BarSizeContext = React.createContext(44)

function BarButton({ label, onPress, children }: { label: string, onPress: (button: ViewRef | null) => void, children: React.ReactNode }) {
    const ref = React.useRef<ViewRef>(null)
    const size = React.use(BarSizeContext)
    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => onPress(ref.current)}
            hitSlop={4}
            className="items-center justify-center rounded-full active:bg-white/15"
            style={({ pressed }) => ({ width: size, height: size, transform: [{ scale: pressed ? 0.92 : 1 }] })}
        >
            {children}
        </Pressable>
    )
}

// Material "replay" / "forward" arrows with the seconds inside (media-core-control-bar.tsx)
const SEEK_BACK_PATH = "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
const SEEK_FORWARD_PATH = "M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z"

function CenterSeek({ seconds, size, onSeek }: { seconds: number, size: number, onSeek: (seconds: number) => void }) {
    const t = useTr()
    const back = seconds < 0
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={back ? t(`Back ${-seconds} seconds`, `${-seconds} Sekunden zurück`) : t(`Forward ${seconds} seconds`, `${seconds} Sekunden vor`)}
            onPress={() => onSeek(seconds)}
            className="items-center justify-center rounded-full active:bg-white/15"
            style={({ pressed }) => ({ width: size, height: size, transform: [{ scale: pressed ? 0.92 : 1 }] })}
        >
            <Svg width={size * 0.64} height={size * 0.64} viewBox="0 0 24 24">
                <Path d={back ? SEEK_BACK_PATH : SEEK_FORWARD_PATH} fill="#fff" />
                <SvgText x="12" y="15.4" fontSize="6.5" fontWeight="700" fill="#fff" textAnchor="middle">{Math.abs(seconds)}</SvgText>
            </Svg>
        </Pressable>
    )
}

function PlayPauseIcon({ playing, size }: { playing: boolean, size: number }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
            {playing
                ? <><Path d="M7.25 5h1.75a1.25 1.25 0 0 1 1.25 1.25v11.5A1.25 1.25 0 0 1 9 19H7.25A1.25 1.25 0 0 1 6 17.75V6.25A1.25 1.25 0 0 1 7.25 5z" fill="#fff" /><Path d="M15 5h1.75A1.25 1.25 0 0 1 18 6.25v11.5A1.25 1.25 0 0 1 16.75 19H15a1.25 1.25 0 0 1-1.25-1.25V6.25A1.25 1.25 0 0 1 15 5z" fill="#fff" /></>
                : <Path d="M8.5 5.65v12.7a1 1 0 0 0 1.53.85l10.16-6.35a1 1 0 0 0 0-1.7L10.03 4.8a1 1 0 0 0-1.53.85z" fill="#fff" />}
        </Svg>
    )
}

/**
 * The time bar (video-core-time-range.tsx): scrubs only after 10 px sideways; a cancelled touch never moves the video.
 * `.vc-time-range`: 44dp to touch, `--vc-track` high, the thumb `--vc-thumb` (1.35× while scrubbing), half a thumb + 4dp
 * in from the bar's sides.
 */
function TimeBar({ position, duration, buffered, pieces, highlight, track, thumbSize, onScrubStart, onScrubEnd }: {
    position: number
    duration: number
    buffered: number
    pieces: TimeBarPiece[]
    highlight: boolean
    track: number
    thumbSize: number
    onScrubStart: () => void
    onScrubEnd: (target: number | null) => void
}) {
    const [scrub, setScrubState] = React.useState<ScrubState>(SCRUB_IDLE)
    // Touch moves arrive faster than React re-renders: the handlers read the latest state from the ref (with only the
    // state, the first moves saw "idle" and a drag never scrubbed – S22)
    const scrubRef = React.useRef<ScrubState>(SCRUB_IDLE)
    const setScrub = (next: ScrubState) => {
        scrubRef.current = next
        setScrubState(next)
    }
    const width = React.useRef(0)
    const ratio = scrub.phase === "scrubbing" ? scrub.ratio : duration > 0 ? position / duration : 0
    const bufferedRatio = duration > 0 ? Math.min(1, buffered / duration) : 0
    const thumb = scrub.phase === "scrubbing" ? Math.round(thumbSize * 1.35) : thumbSize

    return (
        <View
            className="h-11 justify-center"
            style={{ marginHorizontal: thumbSize / 2 + 4 }}
            onLayout={e => (width.current = e.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => duration > 0}
            onResponderTerminationRequest={() => scrubRef.current.phase !== "scrubbing"}
            onResponderGrant={e => setScrub(scrubDown(e.nativeEvent.locationX, e.nativeEvent.locationY))}
            onResponderMove={e => {
                const current = scrubRef.current
                const next = scrubMove(current, e.nativeEvent.locationX, e.nativeEvent.locationY, width.current)
                if (next.phase === "scrubbing" && current.phase !== "scrubbing") onScrubStart()
                setScrub(next)
            }}
            onResponderRelease={e => {
                const target = scrubUp(scrubRef.current, e.nativeEvent.locationX, width.current, duration)
                setScrub(SCRUB_IDLE)
                onScrubEnd(target)
            }}
            onResponderTerminate={() => {
                setScrub(SCRUB_IDLE)
                onScrubEnd(null)
            }}
            accessibilityRole="adjustable"
            accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(position) }}
        >
            {/* one rounded piece per chapter, 3 px apart (MediaCoreTimeRangeSegment): track, buffer, progress */}
            <View pointerEvents="none" className="flex-row" style={{ height: track }}>
                {pieces.map((piece, i) => {
                    const span = Math.max(piece.end - piece.start, 0.001)
                    const fill = (to: number) => `${Math.min(1, Math.max(0, (to * Math.max(duration, 0.001) - piece.start) / span)) * 100}%` as const
                    return (
                        <View key={piece.start} className="h-full overflow-hidden rounded-lg"
                            style={{ flexGrow: duration > 0 ? span : 1, flexBasis: 0, marginLeft: i > 0 ? 3 : 0,
                                backgroundColor: highlight && piece.skip ? "rgba(253, 230, 138, 0.55)" : "rgba(255, 255, 255, 0.25)" }}>
                            <View className="absolute bottom-0 left-0 top-0 bg-white/25" style={{ width: fill(bufferedRatio) }} />
                            <View className="absolute bottom-0 left-0 top-0" style={{ width: fill(ratio), backgroundColor: colors.smAccent }} />
                        </View>
                    )
                })}
            </View>
            <View pointerEvents="none" className="absolute rounded-full"
                style={{ width: thumb, height: thumb, left: `${ratio * 100}%`, marginLeft: -thumb / 2, backgroundColor: colors.smAccent }} />
            {scrub.phase === "scrubbing" && (
                <View pointerEvents="none" className="absolute rounded-md bg-black/70 px-2 py-1" style={{ bottom: 40, left: `${ratio * 100}%`, transform: [{ translateX: -28 }] }}>
                    <Text className="text-sm text-white">{formatTime(ratio * duration)}</Text>
                </View>
            )}
        </View>
    )
}

/**
 * The mini player around the picture (r21): the picture and titles open the player, play/pause and × sit beside them as
 * their own 44dp buttons (before, they were nested in the "open" press area over the video, and a tap that slipped off
 * them opened the player), a progress line runs along the bottom edge. Phone: one row docked above the navigation bar;
 * tablet: the row under the picture. Only the buttons and the picture take touches; the page beside the card stays usable.
 */
function MiniPlayer({ frame, title, subtitle, playing, loading, error, progress, onExpand, onPlay, onClose }: {
    frame: MiniFrame, title: string, subtitle: string, playing: boolean, loading: boolean, error: string | null, progress: number,
    onExpand: () => void, onPlay: () => void, onClose: () => void
}) {
    const t = useTr()
    const bar = frame.kind === "bar"
    const pad = bar ? MINI_BAR.pad : MINI_CARD.pad
    // the row of titles and buttons: right of the picture on a phone, under it on a tablet
    const row = bar
        ? { left: pad + frame.video.width + 10, top: 0, right: 4, height: frame.height }
        : { left: 12, top: pad + frame.video.height, right: 4, height: MINI_CARD.rowHeight }
    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Open player", "Player öffnen")}
                onPress={onExpand}
                className="absolute inset-0 active:bg-white/5"
            />
            {loading && (
                <View pointerEvents="none" className="absolute items-center justify-center" style={{ left: pad, top: pad, width: frame.video.width, height: frame.video.height }}>
                    <ActivityIndicator color="#fff" size="small" />
                </View>
            )}
            <View pointerEvents="box-none" className="absolute flex-row items-center" style={row}>
                <View pointerEvents="none" className="min-w-0 flex-1 justify-center pr-1">
                    {!!title && <Text numberOfLines={1} className="text-[14px] font-semibold" style={{ color: colors.smText }}>{title}</Text>}
                    {!!(error || subtitle) && (
                        <Text numberOfLines={1} className="text-[12px]" style={{ color: error ? colors.smDanger : colors.smTextMuted }}>{error || subtitle}</Text>
                    )}
                </View>
                <BarSizeContext value={44}>
                    {!error && (
                        <BarButton label={playing ? t("Pause", "Pause") : t("Play", "Abspielen")} onPress={onPlay}>
                            <PlayPauseIcon playing={playing} size={24} />
                        </BarButton>
                    )}
                    <BarButton label={t("Close player", "Player schließen")} onPress={onClose}><X size={22} color="#fff" /></BarButton>
                </BarSizeContext>
            </View>
            <View pointerEvents="none" className="absolute bottom-0 left-0 right-0" style={{ height: 2, backgroundColor: colors.smLine }}>
                <View style={{ height: 2, width: `${progress * 100}%`, backgroundColor: colors.smAccent }} />
            </View>
        </>
    )
}
