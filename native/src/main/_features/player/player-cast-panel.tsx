import { ActionRow, RowGroup } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { Slider } from "@/components/ui/slider/slider"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { castController } from "@/lib/cast/cast-controller"
import { type CastDevice, castErrorText, type CastState } from "@/lib/cast/cast-state"
import { useCast } from "@/lib/cast/use-cast"
import { colors } from "@/lib/theme/tokens"
import Cast from "lucide-react-native/icons/cast"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Minus from "lucide-react-native/icons/minus"
import Pause from "lucide-react-native/icons/pause"
import Play from "lucide-react-native/icons/play"
import Plus from "lucide-react-native/icons/plus"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import RotateCcw from "lucide-react-native/icons/rotate-ccw"
import RotateCw from "lucide-react-native/icons/rotate-cw"
import SkipForward from "lucide-react-native/icons/skip-forward"
import Smartphone from "lucide-react-native/icons/smartphone"
import Tv from "lucide-react-native/icons/tv"
import React from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import { castFollowUp, castKindLabel, castPollMs, castSeekValue, castVolumeStep, phoneAfterCast } from "./player-cast"
import { formatTime } from "./player-logic"

/*
 * Casting from the player (web video-core-cast.tsx): the bar's cast button, the "Playing on …" pill and one sheet with the
 * search, the device list, connecting, the remote and errors. The session is the shared castController (DLNA in Go,
 * Google Cast through react-native-google-cast); this file keeps the player in step with it:
 * - a cast starts from the phone's position with the tracks playing here; the phone pauses while the TV plays
 * - other tracks picked here switch the TV where it is (after 1 s, an audio switch reloads the stream here first)
 * - another episode here (the remote's "Next episode", the bar's buttons) goes to the TV from its start
 * - when casting ends the phone goes back to the TV's position, and plays on "Continue on this device"
 */

export type PlayerCast = ReturnType<typeof usePlayerCast>

export function usePlayerCast({ castUrl, ready, title, artwork, playing, positionMs, pauseLocal, resumeLocal }: {
    /** the stream for the TV with the tracks playing here; null = this video cannot be cast */
    castUrl: string | null
    /** the tracks of the current video are known (they go into castUrl) */
    ready: boolean
    title: string
    artwork: string
    playing: boolean
    positionMs: () => number
    pauseLocal: () => void
    resumeLocal: (seconds: number | null, play: boolean) => void
}) {
    const t = useTr()
    const { state, cast } = useCast()
    const [open, setOpen] = React.useState(false)
    const casting = state.phase === "casting"
    // the stream the TV has, to follow only real changes
    const sent = React.useRef<string | null>(null)

    // The phone keeps still while the TV plays
    React.useEffect(() => {
        if (casting && playing) pauseLocal()
    }, [casting, playing, pauseLocal])

    // Casting ended: the sheet closes and the phone goes on where the TV was
    const resume = React.useEffectEvent((after: ReturnType<typeof phoneAfterCast>) => {
        if (after) resumeLocal(after.seekTo, after.play)
    })
    React.useEffect(() => cast.subscribe(event => {
        if (event.state !== "stopped") return
        sent.current = null
        setOpen(false)
        resume(phoneAfterCast(event))
    }), [cast])
    React.useEffect(() => {
        if (!casting && state.phase !== "connecting") sent.current = null
    }, [casting, state.phase])

    // Opening without a TV in use looks for TVs
    const discover = React.useEffectEvent(() => {
        if (state.phase === "idle") cast.discover()
    })
    React.useEffect(() => {
        if (open) discover()
    }, [open])

    // The TV's place and state: every second with the panel open, else now and then to notice the end
    React.useEffect(() => {
        if (!casting) return
        void cast.status()
        const timer = setInterval(() => void cast.status(), castPollMs(open))
        return () => clearInterval(timer)
    }, [casting, open, cast])

    // Other tracks or another episode here while the TV plays. Only the stream counts as a dependency: the status events
    // re-render the player every second and must not restart the 1 s wait.
    const follow = React.useEffectEvent((step: "switch" | "load", url: string) => {
        sent.current = url
        if (step === "switch") {
            void cast.switchStream(url)
            toast.info(t("The TV switches to the new track…", "Der Fernseher wechselt die Spur …"))
        }
        else void cast.load(url, title, 0, artwork)
    })
    React.useEffect(() => {
        if (!casting || !ready || !castUrl) return
        const step = castFollowUp(sent.current, castUrl)
        if (step === "none") return
        if (step === "adopt") {
            sent.current = castUrl
            return
        }
        const timer = setTimeout(() => follow(step, castUrl), step === "switch" ? 1000 : 0)
        return () => clearTimeout(timer)
    }, [casting, ready, castUrl])

    // Errors show in the sheet; with the sheet closed (a failed control from the pill's session) as a toast
    const error = state.error
    const toastError = React.useEffectEvent((code: NonNullable<CastState["error"]>) => {
        if (!open) toast.error(castErrorText(code, t))
    })
    React.useEffect(() => {
        if (error) toastError(error)
    }, [error])

    const start = (device: CastDevice) => {
        if (!castUrl) return
        sent.current = castUrl
        void cast.start(device.id, castUrl, title, Math.round(positionMs()), artwork)
    }

    return { state, cast, open, setOpen, casting, start, available: !!castUrl || casting || state.phase === "connecting" }
}

/** Over the player while a TV plays and the sheet is closed; opens the remote. */
export function CastPill({ device, onPress }: { device: string, onPress: () => void }) {
    const t = useTr()
    const label = t(`Playing on ${device}`, `Läuft auf ${device}`)
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
            className="max-w-[86%] flex-row items-center gap-2 rounded-full border border-sm-line-strong bg-[rgba(20,20,22,0.88)] py-2.5 pl-3.5 pr-2.5 active:bg-sm-surface-control">
            <Tv size={18} color={colors.smAccent} />
            <Text numberOfLines={1} className="min-w-0 shrink text-sm font-semibold">{label}</Text>
            <ChevronRight size={18} color={colors.smTextSubtle} />
        </Pressable>
    )
}

export function CastSheet({ cast: c, title, hasNext, onNext }: { cast: PlayerCast, title: string, hasNext: boolean, onNext: () => void }) {
    const t = useTr()
    const { state, cast, open, setOpen, casting, start } = c
    return (
        <Sheet open={open} onOpenChange={setOpen} title={casting ? t("Playing on TV", "Läuft auf dem Fernseher") : t("Cast to a TV", "Auf Fernseher übertragen")}>
            <View className="gap-5">
                {state.phase === "searching" && <Waiting text={t("Looking for TVs in your Wi-Fi…", "Suche Fernseher im WLAN …")} />}
                {state.phase === "connecting" && <Waiting text={t(`Connecting to ${state.device ?? ""}…`, `Verbinde mit ${state.device ?? ""} …`)} />}

                {state.phase === "idle" && state.devices.length > 0 && (
                    <SheetGroup title={t("TVs in your Wi-Fi", "Fernseher im WLAN")}>
                        <RowGroup>
                            {state.devices.map(device => (
                                <ActionRow key={device.id} icon={device.kind === "googlecast" ? Cast : Tv} label={device.name} note={castKindLabel(device.kind, t)}
                                    chevron onPress={() => start(device)} />
                            ))}
                        </RowGroup>
                    </SheetGroup>
                )}
                {state.phase === "idle" && state.devices.length === 0 && <NoTv t={t} />}
                {state.phase === "idle" && (
                    <Button intent="secondary" leftIcon={<RefreshCw size={18} color={colors.smText} />} onPress={() => cast.discover()}>
                        {t("Search again", "Erneut suchen")}
                    </Button>
                )}

                {casting && <CastRemote t={t} state={state} title={title} onNext={hasNext ? onNext : undefined} />}

                {!!state.error && <Text accessibilityRole="alert" className="text-[13px] leading-[19.5px] text-sm-danger">{castErrorText(state.error, t)}</Text>}
            </View>
        </Sheet>
    )
}

function Waiting({ text }: { text: string }) {
    return (
        <View accessibilityRole="progressbar" accessibilityLabel={text} className="min-h-24 flex-row items-center justify-center gap-3 rounded-surface bg-sm-surface-raised px-4">
            <ActivityIndicator color={colors.smAccent} />
            <Text className="shrink text-[15px]">{text}</Text>
        </View>
    )
}

function NoTv({ t }: { t: Translate }) {
    return (
        <View className="items-center gap-2 rounded-surface bg-sm-surface-raised px-5 py-6">
            <Tv size={28} color={colors.smTextSubtle} />
            <Text className="text-base font-semibold">{t("No TV found", "Kein Fernseher gefunden")}</Text>
            <Muted className="text-center leading-[19.5px]">
                {t("Turn the TV on and use the same Wi-Fi as this device. LG webOS, other DLNA TVs, Google TV and Chromecast work.",
                    "Fernseher einschalten und im selben WLAN wie dieses Gerät sein. LG webOS, andere DLNA-Fernseher, Google TV und Chromecast gehen.")}
            </Muted>
        </View>
    )
}

function RoundButton({ label, onPress, big, children }: { label: string, onPress: () => void, big?: boolean, children: React.ReactNode }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
            className={cn("items-center justify-center rounded-full", big ? "h-16 w-16 bg-sm-accent-strong active:opacity-80" : "h-14 w-14 bg-sm-surface-raised active:bg-sm-surface-control")}>
            {children}
        </Pressable>
    )
}

function CastRemote({ t, state, title, onNext }: { t: Translate, state: CastState, title: string, onNext?: () => void }) {
    // While dragging, the bar shows the finger, not the TV
    const [dragMs, setDragMs] = React.useState<number | null>(null)
    const control = (action: "play" | "pause" | "seek" | "skip" | "volume", value?: number) => void castController.control(action, value)
    const stop = (resume: boolean) => void castController.stop(resume)
    const duration = state.durationMs
    const position = castSeekValue(dragMs, state.positionMs, duration)
    const volume = state.volume
    const known = duration > 0

    return (
        <View className="gap-5">
            <View className="flex-row items-center gap-3.5 rounded-surface bg-sm-surface-raised px-4 py-3">
                {state.kind === "googlecast" ? <Cast size={22} color={colors.smAccent} /> : <Tv size={22} color={colors.smAccent} />}
                <View className="min-w-0 flex-1 gap-0.5">
                    <Text numberOfLines={1} className="text-[15px] font-semibold">{state.device}</Text>
                    <Muted numberOfLines={2}>{title}</Muted>
                </View>
            </View>

            <View className="gap-1.5">
                <Slider value={position} min={0} max={Math.max(duration, 1)} step={1000} disabled={!known} accessibilityLabel={t("Position", "Position")}
                    onValueChange={setDragMs}
                    onValueCommit={value => {
                        control("seek", value)
                        setDragMs(null)
                    }} />
                <View className="flex-row justify-between">
                    <Muted className="text-xs tabular-nums">{formatTime(position / 1000)}</Muted>
                    <Muted className="text-xs tabular-nums">{known ? formatTime(duration / 1000) : "--:--"}</Muted>
                </View>
            </View>

            <View className="flex-row items-center justify-center gap-6">
                <RoundButton label={t("Back 10 seconds", "10 Sekunden zurück")} onPress={() => control("skip", -10_000)}>
                    <RotateCcw size={22} color={colors.smText} />
                </RoundButton>
                <RoundButton big label={state.playing ? t("Pause", "Pause") : t("Play", "Abspielen")} onPress={() => control(state.playing ? "pause" : "play")}>
                    {state.playing ? <Pause size={26} color="#fff" fill="#fff" /> : <Play size={26} color="#fff" fill="#fff" />}
                </RoundButton>
                <RoundButton label={t("Forward 10 seconds", "10 Sekunden vor")} onPress={() => control("skip", 10_000)}>
                    <RotateCw size={22} color={colors.smText} />
                </RoundButton>
            </View>

            {/* LG reports the volume last set over DLNA, not the one of its remote: unknown (-1), so no buttons */}
            {volume >= 0 ? (
                <View className="flex-row items-center justify-between rounded-surface bg-sm-surface-raised px-2 py-1.5">
                    <RoundVolume label={t("Quieter", "Leiser")} onPress={() => control("volume", castVolumeStep(volume, -5))}><Minus size={20} color={colors.smText} /></RoundVolume>
                    <Text className="text-[15px] tabular-nums">{t(`Volume ${volume}`, `Lautstärke ${volume}`)}</Text>
                    <RoundVolume label={t("Louder", "Lauter")} onPress={() => control("volume", castVolumeStep(volume, 5))}><Plus size={20} color={colors.smText} /></RoundVolume>
                </View>
            ) : (
                known && <Muted className="text-center">{t("Change the volume with the TV's remote.", "Lautstärke mit der Fernbedienung des Fernsehers ändern.")}</Muted>
            )}

            {state.ended && <Muted className="text-center">{t("The episode has ended on the TV.", "Die Folge ist auf dem Fernseher zu Ende.")}</Muted>}

            <View className="gap-2.5">
                {!!onNext && (
                    <Button intent={state.ended ? "primary" : "secondary"} leftIcon={<SkipForward size={18} color={state.ended ? "#fff" : colors.smText} />} onPress={onNext}>
                        {t("Next episode", "Nächste Folge")}
                    </Button>
                )}
                <Button intent={state.ended && onNext ? "secondary" : "primary"} leftIcon={<Smartphone size={18} color={state.ended && onNext ? colors.smText : "#fff"} />}
                    onPress={() => stop(true)}>
                    {t("Continue on this device", "Auf diesem Gerät weiterschauen")}
                </Button>
                <Button intent="text" onPress={() => stop(false)}>{t("Stop casting", "Übertragung beenden")}</Button>
            </View>
        </View>
    )
}

function RoundVolume({ label, onPress, children }: { label: string, onPress: () => void, children: React.ReactNode }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
            className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
            {children}
        </Pressable>
    )
}
