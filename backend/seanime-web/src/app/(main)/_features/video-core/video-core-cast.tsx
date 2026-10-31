import { nativePlayer_stateAtom } from "@/app/(main)/_features/native-player/native-player.atoms"
import { vc_audioManager, vc_subtitleManager } from "@/app/(main)/_features/video-core/video-core"
import { vc_miniPlayer, vc_videoElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { useVideoCorePlaylist } from "@/app/(main)/_features/video-core/video-core-playlist"
import type { VideoCoreAudioManager } from "@/app/(main)/_features/video-core/video-core-audio"
import type { VideoCoreSubtitleManager } from "@/app/(main)/_features/video-core/video-core-subtitles"
import { MediaCoreControlButtonIcon } from "@/app/(main)/_features/media-core/media-core-control-bar"
import { useTr } from "@/lib/app-language"
import { atom, useAtom, useAtomValue } from "jotai"
import React from "react"
import { LuCast, LuChevronRight, LuMinus, LuPause, LuPlay, LuPlus, LuRefreshCw, LuRotateCcw, LuRotateCw, LuSkipForward, LuSmartphone, LuTv, LuX } from "react-icons/lu"
import { MdCastConnected } from "react-icons/md"
import { toast } from "sonner"
import "./video-core-cast.css"

// Casting to a TV in the Wi-Fi (LG webOS and other DLNA TVs, Google TV/Chromecast) through the Android app (window.SeanimeCast).
// The app answers with "seanime-cast" window events; this file keeps the panel and the player in step with them.

type CastDevice = { id: string, name: string, kind: "webos" | "dlna" | "googlecast" }
type CastStatus = { playing: boolean, positionMs: number, durationMs: number, volume: number, ended: boolean }
type CastState =
    | { phase: "idle" }
    | { phase: "searching" }
    | { phase: "devices", devices: CastDevice[] }
    | { phase: "connecting", device: string }
    | { phase: "casting", device: string, kind: string, status: CastStatus | null }

type CastEvent = { state: string, devices?: CastDevice[], device?: string, kind?: string, message?: string, positionMs?: number, resume?: boolean } &
    Partial<CastStatus>

const vc_castPanelOpen = atom(false)
const vc_castState = atom<CastState>({ phase: "idle" })
const vc_castError = atom<string | null>(null)

// The label says which way the video goes; LG webOS TVs only come over DLNA (the app leaves out their Google Cast entry)
const KIND_LABEL: Record<string, [string, string]> = {
    webos: ["LG webOS · direct (DLNA)", "LG webOS · direkt (DLNA)"],
    dlna: ["Smart TV · direct (DLNA)", "Smart-TV · direkt (DLNA)"],
    // the Cast receiver plays the file's audio and picture, but not its subtitles
    googlecast: ["Google Cast (Google TV, Chromecast) · no subtitles", "Google Cast (Google TV, Chromecast) · ohne Untertitel"],
}

/** Only streams of the app's own server can be handed to the TV (online streams and HLS stay on the phone). */
function castableUrl(video: HTMLVideoElement | null) {
    return video?.currentSrc.startsWith(`${window.location.origin}/api/`) ? video.currentSrc : null
}

/** The stream for the TV with the audio and subtitles playing here: the server leaves only those, else the TV picks its own. */
function tvUrl(video: HTMLVideoElement | null, audio: VideoCoreAudioManager | null, subtitles: VideoCoreSubtitleManager | null) {
    const src = castableUrl(video)
    if (!src) return null
    const url = new URL(src)
    const audioTrack = audio?.getSelectedTrackNumberOrNull()
    if (audioTrack != null) url.searchParams.set("audioTrack", String(audioTrack))
    if (subtitles) url.searchParams.set("subtitleTrack", String(subtitles.getSelectedTrackNumberOrNull() ?? -1))
    return url.toString()
}

/** Player top bar: opens the cast panel; shows when a TV is in use. */
export function VideoCoreCastButton() {
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    const videoElement = useAtomValue(vc_videoElement)
    const state = useAtomValue(vc_castState)
    const [, setOpen] = useAtom(vc_castPanelOpen)
    if (isMiniPlayer || !window.SeanimeCast || (!castableUrl(videoElement) && state.phase !== "casting")) return null
    return <MediaCoreControlButtonIcon
        icons={[["default", LuCast], ["casting", MdCastConnected]]}
        state={state.phase === "casting" ? "casting" : "default"}
        onClick={() => setOpen(true)}
    />
}

/** The cast panel and the "playing on" pill; mounted with the player, it also follows casting while the panel is closed. */
export function VideoCoreCastLayer() {
    const t = useTr()
    const cast = typeof window !== "undefined" ? window.SeanimeCast : undefined
    const videoElement = useAtomValue(vc_videoElement)
    const audioManager = useAtomValue(vc_audioManager)
    const subtitleManager = useAtomValue(vc_subtitleManager)
    const playerState = useAtomValue(nativePlayer_stateAtom)
    const [open, setOpen] = useAtom(vc_castPanelOpen)
    // the stream the TV has, to switch it only for a real change
    const sentUrl = React.useRef<string | null>(null)
    const [state, setState] = useAtom(vc_castState)
    const [error, setError] = useAtom(vc_castError)

    // A cast that went on while the page reloaded
    React.useEffect(() => {
        const current = cast?.current()
        if (!current) return
        const { device, kind } = JSON.parse(current) as { device: string, kind: string }
        setState({ phase: "casting", device, kind, status: null })
    }, [])

    React.useEffect(() => {
        const onCast = (e: Event) => {
            const detail = (e as CustomEvent<CastEvent>).detail
            switch (detail.state) {
                case "searching":
                    setError(null)
                    return setState({ phase: "searching" })
                case "devices":
                    return setState({ phase: "devices", devices: detail.devices ?? [] })
                case "connecting":
                    setError(null)
                    return setState({ phase: "connecting", device: detail.device ?? "" })
                case "started":
                    videoElement?.pause()
                    return setState({ phase: "casting", device: detail.device ?? "", kind: detail.kind ?? "dlna", status: null })
                case "status":
                    return setState(prev => prev.phase === "casting" ? {
                        ...prev,
                        status: {
                            playing: !!detail.playing, positionMs: detail.positionMs ?? 0, durationMs: detail.durationMs ?? 0,
                            volume: detail.volume ?? -1, ended: !!detail.ended,
                        },
                    } : prev)
                case "stopped":
                    setState({ phase: "idle" })
                    setOpen(false)
                    // the phone goes on where the TV was
                    if (videoElement && detail.positionMs) videoElement.currentTime = detail.positionMs / 1000
                    if (detail.resume) videoElement?.play().catch(() => {})
                    return
                case "idle":
                    return setState(prev => prev.phase === "casting" ? { phase: "idle" } : prev)
                case "error":
                    setError(detail.message ?? t("Something went wrong.", "Etwas ist schiefgelaufen."))
                    return setState(prev => prev.phase === "connecting" || prev.phase === "searching" ? { phase: "idle" } : prev)
            }
        }
        window.addEventListener("seanime-cast", onCast)
        return () => window.removeEventListener("seanime-cast", onCast)
    }, [videoElement])

    // Opening without a TV in use looks for TVs
    React.useEffect(() => {
        if (open && (state.phase === "idle" || state.phase === "devices")) cast?.discover()
    }, [open])

    // The TV's place and state: every second with the panel open, else now and then to notice the end
    const casting = state.phase === "casting"
    React.useEffect(() => {
        if (!casting) return
        cast?.status()
        const timer = setInterval(() => cast?.status(), open ? 1000 : 5000)
        return () => clearInterval(timer)
    }, [casting, open])

    // "Next episode" on the remote: the episode loads here (kept paused), then goes to the TV from its start
    const { playEpisode, hasNextEpisode } = useVideoCorePlaylist()
    const castNext = React.useRef(false)
    const playbackId = playerState.playbackInfo?.id
    React.useEffect(() => {
        if (!castNext.current || !casting || !videoElement || !playbackId || !cast?.load) return
        const send = () => {
            if (!castNext.current) return
            castNext.current = false
            videoElement.pause()
            const url = tvUrl(videoElement, audioManager, subtitleManager)
            if (!url) return setError(t("This stream cannot be cast.", "Dieser Stream lässt sich nicht übertragen."))
            const next = playerState.playbackInfo?.episode
            sentUrl.current = url
            cast.load?.(url, [next?.baseAnime?.title?.userPreferred, next?.displayTitle].filter(Boolean).join(" · ") || "Seanime", 0,
                next?.episodeMetadata?.image || next?.baseAnime?.coverImage?.large || "")
        }
        const keepPaused = () => videoElement.pause()
        videoElement.addEventListener("play", keepPaused)
        if (videoElement.readyState >= 1) send()
        else videoElement.addEventListener("loadedmetadata", send, { once: true })
        const release = window.setTimeout(() => videoElement.removeEventListener("play", keepPaused), 5000)
        return () => {
            clearTimeout(release)
            videoElement.removeEventListener("play", keepPaused)
            videoElement.removeEventListener("loadedmetadata", send)
        }
    }, [playbackId, casting, videoElement])

    // Another audio or subtitle track picked here while the TV plays: the TV switches to it where it is
    React.useEffect(() => {
        if (!casting || !cast?.switchStream) return
        let timer = 0
        const onTrackChange = () => {
            clearTimeout(timer)
            // an audio switch reloads the stream here first
            timer = window.setTimeout(() => {
                const url = tvUrl(videoElement, audioManager, subtitleManager)
                if (!url || url === sentUrl.current) return
                sentUrl.current = url
                cast.switchStream(url)
                toast.info(t("The TV switches to the new track…", "Der Fernseher wechselt die Spur …"))
            }, 1000)
        }
        audioManager?.addEventListener("trackchanged", onTrackChange)
        subtitleManager?.addEventListener("trackselected", onTrackChange)
        subtitleManager?.addEventListener("trackdeselected", onTrackChange)
        return () => {
            clearTimeout(timer)
            audioManager?.removeEventListener("trackchanged", onTrackChange)
            subtitleManager?.removeEventListener("trackselected", onTrackChange)
            subtitleManager?.removeEventListener("trackdeselected", onTrackChange)
        }
    }, [casting, videoElement, audioManager, subtitleManager])

    if (!cast) return null

    const episode = playerState.playbackInfo?.episode
    const title = [episode?.baseAnime?.title?.userPreferred, episode?.displayTitle].filter(Boolean).join(" · ") || "Seanime"
    const artwork = episode?.episodeMetadata?.image || episode?.baseAnime?.coverImage?.large || ""
    const startOn = (device: CastDevice) => {
        const url = tvUrl(videoElement, audioManager, subtitleManager)
        if (!url || !videoElement) return setError(t("This stream cannot be cast.", "Dieser Stream lässt sich nicht übertragen."))
        sentUrl.current = url
        cast.start(device.id, url, title, Math.round(videoElement.currentTime * 1000), artwork)
    }

    return <>
        {casting && !open && <button type="button" className="vc-cast-pill" onClick={() => setOpen(true)} data-vc-cast-pill
            onPointerDown={e => e.stopPropagation()}>
            <LuTv aria-hidden /><span>{t(`Playing on ${state.device}`, `Läuft auf ${state.device}`)}</span><LuChevronRight aria-hidden />
        </button>}

        {open && <div className="vc-cast-backdrop" onPointerDown={e => e.stopPropagation()} onClick={e => {
            e.stopPropagation()
            if (e.target === e.currentTarget) setOpen(false)
        }}>
            <section className="vc-cast-panel" role="dialog" aria-modal="true" aria-label={t("Cast to a TV", "Auf Fernseher übertragen")} data-vc-cast-panel>
                <header className="vc-cast-head">
                    <h2>{casting ? t("Playing on TV", "Läuft auf dem Fernseher") : t("Cast to a TV", "Auf Fernseher übertragen")}</h2>
                    <button type="button" className="vc-cast-icon" aria-label={t("Close", "Schließen")} onClick={() => setOpen(false)}><LuX /></button>
                </header>

                {state.phase === "searching" && <div className="vc-cast-wait" role="status">
                    <span className="vc-cast-spinner" aria-hidden />{t("Looking for TVs in your Wi-Fi…", "Suche Fernseher im WLAN …")}
                </div>}

                {state.phase === "connecting" && <div className="vc-cast-wait" role="status">
                    <span className="vc-cast-spinner" aria-hidden />{t(`Connecting to ${state.device}…`, `Verbinde mit ${state.device} …`)}
                </div>}

                {(state.phase === "devices" || state.phase === "idle") && <>
                    {state.phase === "devices" && state.devices.length > 0
                        ? <ul className="vc-cast-devices">
                            {state.devices.map(device => <li key={device.id}>
                                <button type="button" onClick={() => startOn(device)} data-vc-cast-device={device.kind}>
                                    <span className="vc-cast-device-icon" aria-hidden>{device.kind === "googlecast" ? <LuCast /> : <LuTv />}</span>
                                    <span className="vc-cast-device-text">
                                        <strong>{device.name}</strong>
                                        <small>{t(...KIND_LABEL[device.kind])}</small>
                                    </span>
                                    <LuChevronRight aria-hidden />
                                </button>
                            </li>)}
                        </ul>
                        : state.phase === "devices" && <div className="vc-cast-empty">
                            <LuTv aria-hidden />
                            <strong>{t("No TV found", "Kein Fernseher gefunden")}</strong>
                            <p>{t("Turn the TV on and use the same Wi-Fi as this device. LG webOS, other DLNA TVs, Google TV and Chromecast work.",
                                "Fernseher einschalten und im selben WLAN wie dieses Gerät sein. LG webOS, andere DLNA-Fernseher, Google TV und Chromecast gehen.")}</p>
                        </div>}
                    <button type="button" className="vc-cast-secondary" onClick={() => cast.discover()}><LuRefreshCw aria-hidden />{t("Search again",
                        "Erneut suchen")}</button>
                </>}

                {casting && <CastRemote t={t} title={title} device={state.device} kind={state.kind} status={state.status}
                    control={(action, value = 0) => cast.control(action, value)} stop={resume => cast.stop(resume)}
                    onNext={hasNextEpisode && cast.load ? () => {
                        castNext.current = true
                        playEpisode("next")
                    } : undefined} />}

                {!!error && <p className="vc-cast-error" role="alert">{error}</p>}
            </section>
        </div>}
    </>
}

function CastRemote({ t, title, device, kind, status, control, stop, onNext }: {
    t: ReturnType<typeof useTr>
    title: string
    device: string
    kind: string
    status: CastStatus | null
    control: (action: string, value?: number) => void
    stop: (resume: boolean) => void
    /** Plays the next episode on the TV; missing without one */
    onNext?: () => void
}) {
    // While dragging, the bar shows the finger, not the TV
    const [dragMs, setDragMs] = React.useState<number | null>(null)
    const commitSeek = () => {
        if (dragMs !== null) control("seek", dragMs)
        setDragMs(null)
    }
    const duration = status?.durationMs ?? 0
    const position = dragMs ?? status?.positionMs ?? 0
    const volume = status?.volume ?? -1

    return <div className="vc-cast-remote" data-vc-cast-remote>
        <div className="vc-cast-now">
            <span className="vc-cast-device-icon" aria-hidden>{kind === "googlecast" ? <LuCast /> : <LuTv />}</span>
            <span className="vc-cast-device-text">
                <strong>{device}</strong>
                <small>{title}</small>
            </span>
        </div>

        <div className="vc-cast-seek">
            <input type="range" min={0} max={Math.max(duration, 1)} step={1000} value={Math.min(position, Math.max(duration, 1))} disabled={!duration}
                aria-label={t("Position", "Position")}
                onChange={e => setDragMs(Number(e.target.value))}
                onPointerUp={commitSeek}
                onPointerCancel={commitSeek}
                onKeyUp={() => {
                    if (dragMs !== null) control("seek", dragMs)
                    setDragMs(null)
                }} />
            <div className="vc-cast-times"><span>{clock(position)}</span><span>{duration ? clock(duration) : "--:--"}</span></div>
        </div>

        <div className="vc-cast-buttons">
            <button type="button" className="vc-cast-round" aria-label={t("Back 10 seconds", "10 Sekunden zurück")} onClick={() => control("skip", -10_000)}>
                <LuRotateCcw /><small>10</small>
            </button>
            <button type="button" className="vc-cast-play" aria-label={status?.playing ? t("Pause", "Pause") : t("Play", "Abspielen")}
                onClick={() => control(status?.playing ? "pause" : "play")}>
                {status?.playing ? <LuPause /> : <LuPlay />}
            </button>
            <button type="button" className="vc-cast-round" aria-label={t("Forward 10 seconds", "10 Sekunden vor")} onClick={() => control("skip", 10_000)}>
                <LuRotateCw /><small>10</small>
            </button>
        </div>

        {volume >= 0 && <div className="vc-cast-volume">
            <button type="button" className="vc-cast-icon" aria-label={t("Quieter", "Leiser")} onClick={() => control("volume", Math.max(volume - 5, 0))}><LuMinus /></button>
            <span>{t(`Volume ${volume}`, `Lautstärke ${volume}`)}</span>
            <button type="button" className="vc-cast-icon" aria-label={t("Louder", "Lauter")} onClick={() => control("volume", Math.min(volume + 5, 100))}><LuPlus /></button>
        </div>}
        {status && volume < 0 && <p className="vc-cast-note">{t("Change the volume with the TV's remote.", "Lautstärke mit der Fernbedienung des Fernsehers ändern.")}</p>}

        {status?.ended && <p className="vc-cast-note">{t("The episode has ended on the TV.", "Die Folge ist auf dem Fernseher zu Ende.")}</p>}
        {status?.ended && onNext && <button type="button" className="vc-cast-primary" onClick={onNext} data-vc-cast-next>
            <LuSkipForward aria-hidden />{t("Next episode", "Nächste Folge")}</button>}

        <button type="button" className="vc-cast-primary" onClick={() => stop(true)}><LuSmartphone aria-hidden />{t("Continue on this device",
            "Auf diesem Gerät weiterschauen")}</button>
        <button type="button" className="vc-cast-secondary" onClick={() => stop(false)}>{t("Stop casting", "Übertragung beenden")}</button>
    </div>
}

function clock(ms: number) {
    const total = Math.max(Math.floor(ms / 1000), 0)
    const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`
}
