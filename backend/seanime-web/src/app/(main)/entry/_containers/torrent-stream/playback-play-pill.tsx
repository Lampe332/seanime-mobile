import { DebridClient_StreamState, StreamAutoSelectStatusPayload, Torrentstream_TorrentStatus } from "@/api/generated/types"
import { useDebridCancelStream } from "@/api/hooks/debrid.hooks"
import { useTorrentstreamStopStream } from "@/api/hooks/torrentstream.hooks"
import { nativePlayer_stateAtom } from "@/app/(main)/_features/native-player/native-player.atoms"
import { PlaybackManager_PlaybackState } from "@/app/(main)/_features/progress-tracking/_lib/playback-manager.types"
import { vc_currentTime, vc_globalMiniPlayerAtom, vc_miniPlayer, vc_videoElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { useWebsocketSender } from "@/app/(main)/_hooks/handle-websockets"
import { useWebsocketMessageListener } from "@/app/(main)/_hooks/handle-websockets"
import { toastDebridStreamFailure } from "@/app/(main)/_features/native-player/stream-start-error"
import { clientIdAtom } from "@/app/websocket-provider"
import { DownloadSample, estimateDownload, etaLabel } from "@/app/(main)/entry/_containers/torrent-stream/_lib/download-eta"
import "@/app/(main)/entry/_containers/torrent-stream/playback-play-pill.css"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import "@/components/shared/mobile-surface.css"
import { cn } from "@/components/ui/core/styling"
import { Spinner } from "@/components/ui/loading-spinner"
import { Translate, useTr } from "@/lib/app-language"
import { WSEvents } from "@/lib/server/ws-events"
import { atom } from "jotai"
import { useAtom, useAtomValue, useSetAtom } from "jotai/react"
import { AnimatePresence, motion } from "motion/react"
import React, { useEffect, useRef, useState } from "react"
import { BiChevronUp, BiDownArrow, BiGroup, BiStop, BiUpArrow } from "react-icons/bi"
import { toast } from "sonner"

export const enum TorrentStreamEvents {
    TorrentLoading = "loading",
    TorrentLoadingFailed = "loading-failed",
    TorrentLoadingStatus = "loading-status",
    TorrentLoaded = "loaded",
    TorrentStartedPlaying = "started-playing",
    TorrentStatus = "status",
    TorrentStopped = "stopped",
    PreloadNextStream = "preload-next-stream",
}

export const __torrentstream__loadingStateAtom = atom<string | null>(null)
export const __torrentstream__isLoadedAtom = atom<boolean>(false)
export const __debridstream_stateAtom = atom<DebridClient_StreamState | null>(null)
const playPillMinimizedAtom = atom<boolean>(true)

export function PlaybackPlayPill({ isNativePlayerComponent, show }: {
    isNativePlayerComponent?: "control-bar" | "top-section" | "overlay",
    show?: boolean
}) {
    const [nativePlayerState, setNativePlayerState] = useAtom(nativePlayer_stateAtom)
    const videoElement = useAtomValue(vc_videoElement)
    const setMiniPlayer = useSetAtom(vc_miniPlayer)
    const clientId = useAtomValue(clientIdAtom)
    const { sendMessage } = useWebsocketSender()

    const [loadingState, setLoadingState] = useAtom(__torrentstream__loadingStateAtom)
    const [isLoaded, setIsLoaded] = useAtom(__torrentstream__isLoadedAtom)
    const [debridState, setDebridState] = useAtom(__debridstream_stateAtom)
    const [minimized, setMinimized] = useAtom(playPillMinimizedAtom)

    const [status, setStatus] = useState<Torrentstream_TorrentStatus | null>(null)
    const [torrentBeingLoaded, setTorrentBeingLoaded] = useState<string | null>(null)
    const [mediaPlayerStartedPlaying, setMediaPlayerStartedPlaying] = useState<boolean>(false)

    const [autoSelectState, setAutoSelectState] = useState<StreamAutoSelectStatusPayload | null>(null)

    const { mutate: stopTorrent, isPending: isStoppingTorrent } = useTorrentstreamStopStream()
    const { mutate: cancelDebrid, isPending: isCancellingDebrid } = useDebridCancelStream()

    const t = useRef<NodeJS.Timeout | null>(null)
    const [showMediaPlayerLoading, setShowMediaPlayerLoading] = useState(false)

    const pillRef = useRef<HTMLDivElement>(null)
    const tr = useTr()
    const etaSeconds = useDownloadEta(status)

    useEffect(() => {
        if (minimized) return

        function handleClickOutside(e: PointerEvent) {
            if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
                setMinimized(true)
            }
        }

        const timer = setTimeout(() => {
            document.addEventListener("pointerdown", handleClickOutside)
        }, 100)
        return () => {
            clearTimeout(timer)
            document.removeEventListener("pointerdown", handleClickOutside)
        }
    }, [minimized, setMinimized])

    const confirmStop = useConfirmationDialog({
        title: tr("Stop streaming?", "Stream beenden?"),
        description: nativePlayerState.active
            ? tr("The stream stops and the player closes.", "Der Stream stoppt und der Player schließt sich.")
            : tr("Loading the stream is cancelled.", "Das Laden des Streams wird abgebrochen."),
        actionText: tr("Stop stream", "Stream beenden"),
        actionIntent: "alert",
        onConfirm: () => {
            handleStopStream()
        },
    })

    useEffect(() => {
        const timeout = setTimeout(() => {
            setShowMediaPlayerLoading(false)
        }, 2 * 60 * 1000)
        return () => clearTimeout(timeout)
    }, [showMediaPlayerLoading])

    const handleStopStream = React.useCallback(() => {
            if (nativePlayerState.active && clientId) {
                const playbackId = nativePlayerState.playbackInfo?.id || ""
                const playbackType = nativePlayerState.playbackInfo?.streamType || ""
                videoElement?.pause()
                setMiniPlayer(true)
                setNativePlayerState(draft => {
                    draft.playbackInfo = null
                    draft.playbackError = null
                    draft.loadingState = "Ending stream..."
                })
                setTimeout(() => setNativePlayerState(draft => {
                    draft.active = false
                }), 700)
                sendMessage({
                    type: WSEvents.VIDEOCORE,
                    payload: {
                        clientId,
                        type: "video-terminated",
                        payload: { id: playbackId, clientId, playerType: "native", playbackType },
                    },
                })
                return
            }

            if (debridState) {
                cancelDebrid({
                    options: {
                        removeTorrent: true,
                    },
                }, {
                    onSuccess: () => {
                        setDebridState(null)
                    },
                })
                return
            }

            stopTorrent()
        },
        [clientId, nativePlayerState, sendMessage, setMiniPlayer, setNativePlayerState, stopTorrent, videoElement,
            debridState, cancelDebrid, setDebridState])

    useWebsocketMessageListener({
        type: WSEvents.TORRENTSTREAM_STATE,
        onMessage: ({ state, data }: { state: string, data: any }) => {
            if (state !== TorrentStreamEvents.TorrentLoading) {
                if (t.current) clearTimeout(t.current)
            }
            switch (state) {
                case TorrentStreamEvents.TorrentLoading:
                    if (!data) {
                        setAutoSelectState(null)
                        t.current = setTimeout(() => {
                            setLoadingState("SEARCHING_TORRENTS")
                            setStatus(null)
                            setMediaPlayerStartedPlaying(false)
                        }, 500)
                    } else {
                        setLoadingState(data.state)
                        setTorrentBeingLoaded(data.torrentBeingLoaded)
                        setMediaPlayerStartedPlaying(false)
                    }
                    break
                case TorrentStreamEvents.TorrentLoadingFailed:
                    setLoadingState(null)
                    setStatus(null)
                    setMediaPlayerStartedPlaying(false)
                    break
                case TorrentStreamEvents.TorrentLoaded:
                    setLoadingState("SENDING_STREAM_TO_MEDIA_PLAYER")
                    setIsLoaded(true)
                    setMediaPlayerStartedPlaying(false)
                    break
                case TorrentStreamEvents.TorrentStartedPlaying:
                    setLoadingState(null)
                    setIsLoaded(true)
                    setMediaPlayerStartedPlaying(true)
                    break
                case TorrentStreamEvents.TorrentStopped:
                    setLoadingState(null)
                    setIsLoaded(false)
                    setStatus(null)
                    setMediaPlayerStartedPlaying(false)
                    break
                case TorrentStreamEvents.TorrentStatus:
                    setIsLoaded(true)
                    setStatus(data)
                    break
            }
        },
    })

    useEffect(() => {
        if (process.env.NODE_ENV !== "development") return
            ;
        (window as any).__debugDebridStream = (data: DebridClient_StreamState | null) => {
            if (data) {
                if (data.status === "downloading") {
                    setDebridState(data)
                    setShowMediaPlayerLoading(false)
                    return
                }
                if (data.status === "started") {
                    setDebridState(null)
                    setAutoSelectState(null)
                    setShowMediaPlayerLoading(false)
                    return
                }
                if (data.status === "failed") {
                    setDebridState(null)
                    setAutoSelectState(null)
                    toastDebridStreamFailure(data.message)
                    setShowMediaPlayerLoading(false)
                    return
                }
                if (data.status === "ready") {
                    setDebridState(null)
                    setAutoSelectState(null)
                    toast.info(tr("Sending stream to player...", "Stream wird an den Player gesendet…"), { duration: 1 })
                    setShowMediaPlayerLoading(true)
                    return
                }
            }

            setDebridState(null)
            setShowMediaPlayerLoading(false)
        }

        return () => {
            delete (window as any).__debugDebridStream
        }
    }, [setDebridState])

    useWebsocketMessageListener<DebridClient_StreamState>({
        type: WSEvents.DEBRID_STREAM_STATE,
        onMessage: data => {
            if (data) {
                if (data.status === "downloading") {
                    setDebridState(data)
                    setShowMediaPlayerLoading(false)
                    return
                }
                if (data.status === "started") {
                    setDebridState(null)
                    setAutoSelectState(null)
                    setShowMediaPlayerLoading(false)
                    return
                }
                if (data.status === "failed") {
                    setDebridState(null)
                    setAutoSelectState(null)
                    toastDebridStreamFailure(data.message)
                    setShowMediaPlayerLoading(false)
                    return
                }
                if (data.status === "ready") {
                    setDebridState(null)
                    setAutoSelectState(null)
                    if (data.message !== "") {
                        toast.info(tr("Sending stream to player...", "Stream wird an den Player gesendet…"), { duration: 1 })
                    }
                    setShowMediaPlayerLoading(true)
                    return
                }
            }
        },
    })

    useWebsocketMessageListener<PlaybackManager_PlaybackState | null>({
        type: WSEvents.PLAYBACK_MANAGER_PROGRESS_TRACKING_STARTED,
        onMessage: data => {
            if (data) {
                setShowMediaPlayerLoading(false)
            }
        },
    })

    useWebsocketMessageListener<StreamAutoSelectStatusPayload>({
        type: WSEvents.STREAM_AUTO_SELECT_STATUS,
        onMessage: data => {
            if (data) {
                setAutoSelectState(data)
            }
        },
    })

    useEffect(() => {
        if (nativePlayerState.active) {
            setDebridState(null)
        }
    }, [nativePlayerState.active])

    // Inline native player control-bar formatting
    if (isNativePlayerComponent) {
        if (isNativePlayerComponent === "control-bar" && isLoaded && nativePlayerState.active && status) {
            return (
                <div className={cn("relative justify-left w-fit top-0 h-full flex items-center px-2 truncate", show === false && "hidden")}>
                    <div className="flex-wrap w-fit h-14 flex gap-3 items-center text-sm pointer-events-auto text-[--foreground]">
                        <div className="space-x-1">
                            <BiGroup className="inline-block text-lg" />
                            <span>{status.seeders}</span>
                        </div>
                        <div className="space-x-1">
                            <BiDownArrow className="inline-block mr-1" />
                            {status.downloadSpeed !== "" ? status.downloadSpeed : "0 B/s"}
                        </div>
                        <span className={cn("text-[--muted] font-medium", status.progressPercentage < 5 && "animate-pulse")}>
                            {status.progressPercentage.toFixed(2)}%
                        </span>
                        <div className="space-x-1">
                            <BiUpArrow className="inline-block mr-1" />
                            {status.uploadSpeed !== "" ? status.uploadSpeed : "0 B/s"}
                        </div>
                    </div>
                </div>
            )
        }
        return null
    }

    // Determine if the pill is active
    const isAutoSelecting = !!autoSelectState?.active
    const isTorrentLoading = !!loadingState && loadingState !== "SENDING_STREAM_TO_MEDIA_PLAYER"
    const isTorrentLoaded = isLoaded && !!status
    const isDebridLoading = !!debridState && (debridState.status === "downloading" || debridState.status === "started")
    const isActive = isAutoSelecting || isTorrentLoading || isTorrentLoaded || isDebridLoading

    // Determine active player states
    const videoCoreMiniPlayer = useAtomValue(vc_globalMiniPlayerAtom)
    const isExpandedPlayerActive = nativePlayerState.active && !videoCoreMiniPlayer

    const videoCoreCurrentTime = useAtomValue(vc_currentTime)
    const isPlayerLoading = nativePlayerState.active && !!nativePlayerState.loadingState

    // Hide the floating pill if the player is active in expanded (fullscreen) mode and the media has started playing
    const shouldHideFloating = isExpandedPlayerActive && (mediaPlayerStartedPlaying || videoCoreCurrentTime > 0 || !isPlayerLoading)
    const showFloatingPill = isActive && !shouldHideFloating

    // Reset mediaPlayerStartedPlaying to false when loading/selecting starts
    useEffect(() => {
        if (isAutoSelecting || isTorrentLoading || isDebridLoading) {
            setMediaPlayerStartedPlaying(false)
        }
    }, [isAutoSelecting, isTorrentLoading, isDebridLoading])

    const loadingStateStr = React.useMemo(() => {
        if (!loadingState) return ""
        switch (loadingState) {
            case "LOADING":
                return tr("Loading…", "Lädt…")
            case "SEARCHING_TORRENTS":
            case "SELECTING_FILE":
                return tr("Picking the file…", "Datei wird gewählt…")
            case "ADDING_TORRENT":
                return torrentBeingLoaded ? `${tr("Adding", "Wird hinzugefügt:")} ${torrentBeingLoaded}` : tr("Adding torrent…", "Torrent wird hinzugefügt…")
            case "CHECKING_TORRENT":
                return torrentBeingLoaded ? `${tr("Checking", "Wird geprüft:")} ${torrentBeingLoaded}` : tr("Checking torrent…", "Torrent wird geprüft…")
            case "SENDING_STREAM_TO_MEDIA_PLAYER":
                return tr("Starting playback…", "Wiedergabe startet…")
            default:
                return loadingState
        }
    }, [loadingState, torrentBeingLoaded, tr])

    const currentStepDetail = autoSelectState?.stepDetail || debridState?.message || loadingStateStr || ""

    // Fetching a torrent's file list can take up to a minute when few people share it
    const [slowStart, setSlowStart] = useState(false)
    useEffect(() => {
        setSlowStart(false)
        if (isTorrentLoaded || !["LOADING", "ADDING_TORRENT", "CHECKING_TORRENT"].includes(loadingState ?? "")) return
        const timer = setTimeout(() => setSlowStart(true), 5000)
        return () => clearTimeout(timer)
    }, [loadingState, isTorrentLoaded])

    if (!showFloatingPill) return null

    const isDebridDownloading = debridState?.status === "downloading"
    const debridPercent = isDebridDownloading ? debridProgress(debridState?.message) : null
    const progress = isTorrentLoaded && status ? status.progressPercentage : debridPercent
    const title = autoSelectState?.mediaTitle || debridState?.torrentName || tr("Stream", "Stream")
    const episodeLine = autoSelectState?.episode ? `${tr("Episode", "Folge")} ${autoSelectState.episode}` : ""
    const debridLine = tr("Your debrid service is downloading it", "Der Debrid-Dienst lädt die Folge")
    const speed = status?.downloadSpeed || "0 B/s"
    const eta = etaSeconds !== null ? etaLabel(etaSeconds, tr) : ""
    const pillTitle = isTorrentLoaded && status
        ? `${Math.floor(status.progressPercentage)} % ${tr("loaded", "geladen")}`
        : isDebridDownloading ? debridLine
            : (currentStepDetail || tr("Preparing the stream…", "Stream wird vorbereitet…"))
    const pillMeta = isTorrentLoaded && status
        ? [`↓ ${speed}`, eta, `${status.seeders} ${tr("seeders", "Seeder")}`].filter(Boolean).join(" · ")
        : [title !== tr("Stream", "Stream") && title, episodeLine,
            slowStart && tr("can take up to 1 min (few seeders?)", "kann bis 1 min dauern (wenige Seeder?)")].filter(Boolean).join(" · ")
    const cardSub = episodeLine || (isDebridDownloading ? debridLine : debridState?.message)

    return (
        <div className="pp-root" ref={pillRef}>
            <motion.div
                layout
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
                className={cn("pp-surface select-none", minimized ? "rounded-full" : "rounded-[1.25rem]")}
            >
                <AnimatePresence mode="wait" initial={false}>
                    {minimized ? (
                        <motion.div
                            key="minimized"
                            layout="position"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            role="button"
                            tabIndex={0}
                            aria-label={tr("Show stream details", "Stream-Details zeigen")}
                            className="pp-pill cursor-pointer"
                            onClick={() => setMinimized(false)}
                            onKeyDown={e => {
                                if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return
                                e.preventDefault()
                                setMinimized(false)
                            }}
                        >
                            <PlayPillRing progress={progress} />
                            <div className="pp-text">
                                <AnimatePresence mode="wait" initial={false}>
                                    <motion.span
                                        key={pillTitle}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        transition={{ duration: 0.2 }}
                                        className="pp-title"
                                    >
                                        {pillTitle}
                                    </motion.span>
                                </AnimatePresence>
                                {!!pillMeta && <span className="pp-meta">{pillMeta}</span>}
                            </div>
                            <button
                                type="button"
                                aria-label={tr("Stop stream", "Stream beenden")}
                                className="pp-icon-btn pp-icon-btn--stop"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    confirmStop.open()
                                }}
                            >
                                <BiStop />
                            </button>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="maximized"
                            layout="position"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="pp-card"
                        >
                            <div className="pp-card-head">
                                <div>
                                    <h3 className="pp-card-title">{title}</h3>
                                    {!!cardSub && <p className="pp-card-sub">{cardSub}</p>}
                                </div>
                                <button
                                    type="button"
                                    aria-label={tr("Minimise", "Verkleinern")}
                                    className="pp-icon-btn"
                                    onClick={() => setMinimized(true)}
                                >
                                    <BiChevronUp />
                                </button>
                            </div>

                            {isTorrentLoaded && status ? (
                                <>
                                    <div className="pp-progress">
                                        <div className="pp-progress-row">
                                            <span className="pp-progress-pct">{status.progressPercentage.toFixed(1)} %</span>
                                            {!!eta && <span className="pp-progress-eta">{eta}</span>}
                                        </div>
                                        <div className="pp-bar">
                                            <div style={{ width: `${Math.min(100, status.progressPercentage)}%` }} />
                                        </div>
                                    </div>
                                    <dl className="pp-stats">
                                        <div className="pp-stat"><dt>{tr("Download", "Download")}</dt><dd>{speed}</dd></div>
                                        <div className="pp-stat"><dt>{tr("Seeders", "Seeder")}</dt><dd>{status.seeders}</dd></div>
                                        <div className="pp-stat"><dt>{tr("Size", "Größe")}</dt><dd>{status.size || "–"}</dd></div>
                                        <div className="pp-stat"><dt>{tr("Upload", "Upload")}</dt><dd>{status.uploadSpeed || "0 B/s"}</dd></div>
                                    </dl>
                                </>
                            ) : debridPercent !== null ? (
                                <div className="pp-progress">
                                    <div className="pp-progress-row">
                                        <span className="pp-progress-pct">{Math.floor(debridPercent)} %</span>
                                    </div>
                                    <div className="pp-bar">
                                        <div style={{ width: `${Math.min(100, debridPercent)}%` }} />
                                    </div>
                                </div>
                            ) : currentStepDetail ? (
                                <div className="pp-step">
                                    <Spinner className="size-4 text-[--brand] flex-shrink-0" />
                                    <span>{currentStepDetail}</span>
                                </div>
                            ) : null}

                            {!!autoSelectState?.candidates?.length && (
                                <div>
                                    <h4 className="pp-candidates-title">{tr("Candidates", "Kandidaten")}</h4>
                                    <div className="pp-candidates">
                                        {autoSelectState.candidates.map((cand, idx) => (
                                            <div key={cand.name + idx} className="pp-candidate" data-state={cand.status}>
                                                <div>
                                                    <p className={cn("pp-candidate-name", cand.status === "skipped" && "line-through")}>{cand.name}</p>
                                                    <p className="pp-candidate-provider">{cand.provider} · {tr("Score", "Wertung")} {cand.score}</p>
                                                </div>
                                                {!isTorrentLoaded && <span className="pp-candidate-state">{candidateStateLabel(cand.status, tr)}</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="pp-actions">
                                <button type="button" className="pp-btn" onClick={() => setMinimized(true)}>
                                    {tr("Minimise", "Verkleinern")}
                                </button>
                                <button
                                    type="button"
                                    className="pp-btn pp-btn--stop"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        confirmStop.open()
                                    }}
                                >
                                    {tr("Stop stream", "Stream beenden")}
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
            <ConfirmationDialog {...confirmStop} />
        </div>
    )
}

const RING_RADIUS = 16
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/** Percentage ring; without a percentage yet it shows a turning arc. */
function PlayPillRing({ progress }: { progress: number | null }) {
    const busy = progress === null
    const value = busy ? 0.25 : Math.max(0, Math.min(100, progress)) / 100
    return (
        <span className={cn("pp-ring", busy && "pp-ring--busy")} aria-hidden>
            <svg viewBox="0 0 40 40">
                <circle className="pp-ring-track" cx="20" cy="20" r={RING_RADIUS} />
                <circle className="pp-ring-value" cx="20" cy="20" r={RING_RADIUS} strokeDasharray={RING_LENGTH} strokeDashoffset={RING_LENGTH * (1 - value)} />
            </svg>
            {!busy && <span className="pp-ring-label">{Math.floor(progress)}</span>}
        </span>
    )
}

/** The debrid service reports its own download as "Downloading torrent: 45%". */
function debridProgress(message: string | undefined) {
    const match = message?.match(/(\d+(?:\.\d+)?)\s*%/)
    return match ? Number(match[1]) : null
}

/** Seconds until the selected file is complete, from the torrent status reports (see download-eta.ts). */
function useDownloadEta(status: Torrentstream_TorrentStatus | null) {
    const sampleRef = useRef<DownloadSample | null>(null)
    const [eta, setEta] = useState<number | null>(null)

    useEffect(() => {
        if (!status) {
            sampleRef.current = null
            setEta(null)
            return
        }
        const next = estimateDownload(sampleRef.current, status.downloadProgress, status.progressPercentage, Date.now())
        sampleRef.current = next.sample
        setEta(next.eta)
    }, [status])

    return eta
}

function candidateStateLabel(state: string, tr: Translate) {
    switch (state) {
        case "waiting":
            return tr("Waiting", "Wartet")
        case "analyzing":
            return tr("Checking", "Wird geprüft")
        case "skipped":
            return tr("Skipped", "Übersprungen")
        case "selected":
            return tr("Chosen", "Gewählt")
        default:
            return state
    }
}
