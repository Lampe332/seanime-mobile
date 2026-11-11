import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { Slider } from "@/components/ui/slider/slider"
import { type Translate, useTr } from "@/lib/app-language"
import { ANDROID_PLAYER_PRESETS } from "@/lib/external-player-link/android-player-presets"
import { colors } from "@/lib/theme/tokens"
import { getSkipPatternError } from "@/main/_features/media-core/media-core-chapters"
import { mediaCorePreferencesAtom } from "@/main/_features/media-core/media-core-preferences"
import {
    vc_autoNextAtom,
    vc_autoPlayVideoAtom,
    vc_autoSkipOPEDAtom,
    vc_beautifyImageAtom,
    vc_highlightOPEDChaptersAtom,
    vc_settings,
    vc_sleepTimerAtom,
    vc_storedVolumeBoostAtom,
    vc_videoFitAtom,
    type VideoCoreFit,
    type VideoCoreSettings,
} from "@/main/_features/video-core/video-core.atoms"
import { useAtom } from "jotai"
import Blend from "lucide-react-native/icons/blend"
import Captions from "lucide-react-native/icons/captions"
import Check from "lucide-react-native/icons/check"
import ChevronLeft from "lucide-react-native/icons/chevron-left"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import CirclePlay from "lucide-react-native/icons/circle-play"
import Clock from "lucide-react-native/icons/clock"
import Cpu from "lucide-react-native/icons/cpu"
import Key from "lucide-react-native/icons/key"
import Languages from "lucide-react-native/icons/languages"
import Link from "lucide-react-native/icons/link"
import Download from "lucide-react-native/icons/download"
import ExternalLink from "lucide-react-native/icons/external-link"
import FastForward from "lucide-react-native/icons/fast-forward"
import FileText from "lucide-react-native/icons/file-text"
import Gauge from "lucide-react-native/icons/gauge"
import Paintbrush from "lucide-react-native/icons/paintbrush"
import Palette from "lucide-react-native/icons/palette"
import Ratio from "lucide-react-native/icons/ratio"
import Redo2 from "lucide-react-native/icons/redo-2"
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal"
import Timer from "lucide-react-native/icons/timer"
import TvMinimalPlay from "lucide-react-native/icons/tv-minimal-play"
import Type from "lucide-react-native/icons/type"
import Volume2 from "lucide-react-native/icons/volume-2"
import React from "react"
import { BackHandler, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native"
import Animated, { Easing, Keyframe, ReduceMotion, useAnimatedStyle, withTiming } from "react-native-reanimated"
import { useKeyboardHeight } from "@/components/ui/core/use-keyboard-height"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { type PlayerTrack, sleepTimerFrom, sleepTimerRemainingMs } from "./player-logic"
import {
    CAPTION_BACKGROUND_OPACITIES,
    CAPTION_FONT_SIZES,
    CAPTION_SHADOWS,
    captionLook,
    landscapeMenuPlacement,
    languageSummary,
    listSummary,
    narrowRows,
    optionLabel,
    PHONE_LANGUAGES,
    ROW_LABEL_STYLE,
    rowValueMaxWidth,
    shortValue,
    SPEED_MAX,
    SPEED_MIN,
    SPEED_PRESETS,
    SPEED_STEP,
    stepSpeed,
    STYLE_COLORS,
    SUBTITLE_FONT_SIZES,
    SUBTITLE_OUTLINES,
    SUBTITLE_SHADOW_OPACITIES,
    SUBTITLE_SHADOWS,
    type SubtitleKind,
    subtitleLook,
    TRANSLATE_LANGUAGES,
    TRANSLATE_PROVIDERS,
    translateLanguageLabel,
    translateModelValue,
    translateProviderChanges,
    translateSettings,
} from "./player-menu-logic"
import { usePatchSetting } from "@/api/hooks/settings.hooks"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { trackDisplayName } from "./track-names"

const SLEEP_MINUTES = [15, 30, 45, 60, 90]
/** media-core-volume-boost VOLUME_BOOST_OPTIONS */
const VOLUME_BOOSTS = [1, 1.25, 1.5, 2, 2.5, 3]
const FITS: VideoCoreFit[] = ["contain", "cover", "fill"]
const DELAYS = [-2, -1, -0.5, 0, 0.5, 1, 2]

export type PlayerMenuPage =
    | "main" | "audio" | "subtitles" | "quality"
    | "speed" | "fit" | "boost" | "sleep" | "languages" | "delay" | "appearance" | "advanced" | "skipPatterns" | "blacklist" | "external"
    | "translate" | "translateBaseUrl" | "translateModel" | "translateKey"
    | "style" | "styleSize" | "styleColor" | "styleOutline" | "styleShadow"
    | "caption" | "captionSize" | "captionColor" | "captionBackground" | "captionShadow"

/** Where Back goes from a page; the bar's own menus (audio, subtitles, quality) close instead */
const PARENT: Partial<Record<PlayerMenuPage, PlayerMenuPage>> = {
    speed: "main", fit: "main", boost: "main", sleep: "main", languages: "main", delay: "main", appearance: "main", advanced: "main",
    external: "main", style: "main", caption: "main", skipPatterns: "advanced", blacklist: "advanced", translate: "advanced",
    translateBaseUrl: "translate", translateModel: "translate", translateKey: "translate",
    styleSize: "style", styleColor: "style", styleOutline: "style", styleShadow: "style",
    captionSize: "caption", captionColor: "caption", captionBackground: "caption", captionShadow: "caption",
}

/** The tapped bar button, in the player's coordinates */
export type MenuAnchor = { x: number, y: number, width: number, height: number }

function fitLabel(fit: VideoCoreFit, t: Translate) {
    if (fit === "cover") return t("Zoom to fill", "Zoomen (füllen)")
    if (fit === "fill") return t("Stretch", "Strecken")
    return t("Fit", "Anpassen")
}

/* 2.0.32 opening curves (video-core-phone-settings.css): portrait rises 2rem from the bottom edge in 240 ms, landscape
   grows from 94 % out of the tapped button in 200 ms; closing is quicker and settles back only a little. */
const portraitIn = new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 32 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.bezier(0.32, 0.72, 0, 1) },
}).duration(240).reduceMotion(ReduceMotion.System)
const portraitOut = new Keyframe({
    0: { opacity: 1, transform: [{ translateY: 0 }] },
    100: { opacity: 0, transform: [{ translateY: 24 }], easing: Easing.bezier(0.32, 0.72, 0, 1) },
}).duration(160).reduceMotion(ReduceMotion.System)
const popIn = new Keyframe({
    0: { opacity: 0, transform: [{ scale: 0.94 }] },
    100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.bezier(0.23, 1, 0.32, 1) },
}).duration(200).reduceMotion(ReduceMotion.System)
const popOut = new Keyframe({
    0: { opacity: 1, transform: [{ scale: 1 }] },
    100: { opacity: 0, transform: [{ scale: 0.97 }], easing: Easing.bezier(0.23, 1, 0.32, 1) },
}).duration(140).reduceMotion(ReduceMotion.System)
/* pages: the first page comes in from the left, the deeper ones from the right (media-core-menu, 150 ms) */
const pageFromLeft = new Keyframe({ 0: { opacity: 0, transform: [{ translateX: -10 }] }, 100: { opacity: 1, transform: [{ translateX: 0 }] } })
    .duration(150).reduceMotion(ReduceMotion.System)
const pageFromRight = new Keyframe({ 0: { opacity: 0, transform: [{ translateX: 10 }] }, 100: { opacity: 1, transform: [{ translateX: 0 }] } })
    .duration(150).reduceMotion(ReduceMotion.System)

/*
 * "Player settings" as in 2.0.32 (video-core-settings-menu.tsx PhoneSettingsHome + video-core-phone-settings.css): a
 * popover, no backdrop; a tap beside it or Back closes it (Back first steps one page up). Portrait docks it to the bottom
 * edge across the width (the player sits high there), landscape hangs it under the tapped button, up to 50rem wide, with
 * the groups side by side and without the title. The bar's audio, subtitle and quality buttons open their own menu in
 * the same surface. Native extras without a 2.0.32 template (another player, saving an online episode) sit in "More".
 */
export function PlayerMenu(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    page: PlayerMenuPage
    onPageChange: (page: PlayerMenuPage) => void
    anchor: MenuAnchor | null
    tracks: PlayerTrack[]
    audioId: number
    subId: number
    /** the look of the playing subtitle track decides which style page exists (Subtitle styles = ASS, Caption style = plain) */
    subtitleKind: SubtitleKind | null
    onAudio: (track: PlayerTrack) => void
    onSubtitle: (track: PlayerTrack | null) => void
    speed: number
    onSpeed: (speed: number) => void
    onExternal: (packageName: string) => void
    qualities?: string[]
    quality?: string
    onQuality?: (quality: string) => void
    onSave?: () => void
    saving?: boolean
    /** called before a "Translate subtitles" setting is written (the player may start a translation) */
    onTranslateSettings?: () => void
}) {
    const { open, onOpenChange, page, onPageChange, anchor } = props
    const t = useTr()
    const window = useWindowDimensions()
    const insets = useSafeAreaInsets()
    // a text page (skip patterns, blacklist) lifts the menu onto the open keyboard
    const keyboard = useKeyboardHeight()
    const landscape = window.width > window.height
    const isTablet = useIsTabletScreen()

    const close = React.useCallback(() => {
        onOpenChange(false)
    }, [onOpenChange])
    const back = React.useCallback(() => {
        const parent = PARENT[page]
        if (parent) onPageChange(parent)
        else close()
    }, [page, onPageChange, close])

    // Back steps one page up before it closes (onEscapeKeyDown); registered last, so it runs before the player's own
    React.useEffect(() => {
        if (!open) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            back()
            return true
        })
        return () => sub.remove()
    }, [open, back])

    // the surface's room and place; a tablet keeps it 16dp off the screen edges (media-core-menu.tsx `collisionPadding`)
    const placed = landscapeMenuPlacement(window, anchor, isTablet)
    const width = landscape ? placed.width : window.width
    const { top } = placed
    const left = landscape ? placed.left : 0
    const padBottom = landscape ? 8 : keyboard ? 12 : Math.max(12, insets.bottom)
    const room = landscape ? placed.maxHeight - keyboard : window.height - 48 - keyboard
    const originX = anchor ? anchor.x + anchor.width / 2 - left : width / 2

    return (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {open && (
                <Pressable accessibilityLabel={t("Close", "Schließen")} onPress={close} style={StyleSheet.absoluteFill} />
            )}
            {open && (
                <Animated.View
                    entering={landscape ? popIn : portraitIn}
                    exiting={landscape ? popOut : portraitOut}
                    style={[
                        landscape
                            ? { position: "absolute", top, left, width, borderRadius: 20, transformOrigin: `${originX}px 0px` }
                            : { position: "absolute", left: 0, right: 0, bottom: keyboard, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
                        { backgroundColor: colors.smSurface, padding: 8, paddingBottom: padBottom, elevation: 16 },
                    ]}
                >
                    <ScrollView
                        style={{ maxHeight: room - 8 - padBottom }}
                        className="grow-0"
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        overScrollMode="never"
                    >
                        <Animated.View key={page} entering={page === "main" ? pageFromLeft : pageFromRight}>
                            <MenuPages {...props} back={back} close={close} landscape={landscape} width={width} />
                        </Animated.View>
                    </ScrollView>
                </Animated.View>
            )}
        </View>
    )
}

function MenuPages({ page, onPageChange, tracks, audioId, subId, subtitleKind, onAudio, onSubtitle, speed, onSpeed, onExternal, qualities, quality, onQuality,
    onSave, saving, onTranslateSettings, open, back, close, landscape, width }: React.ComponentProps<typeof PlayerMenu> & {
    back: () => void
    close: () => void
    landscape: boolean
    width: number
}) {
    const t = useTr()
    const [autoNext, setAutoNext] = useAtom(vc_autoNextAtom)
    const [autoPlay, setAutoPlay] = useAtom(vc_autoPlayVideoAtom)
    const [autoSkip, setAutoSkip] = useAtom(vc_autoSkipOPEDAtom)
    const [sleepTimer, setSleepTimer] = useAtom(vc_sleepTimerAtom)
    const [boost, setBoost] = useAtom(vc_storedVolumeBoostAtom)
    const [fit, setFit] = useAtom(vc_videoFitAtom)
    const [highlight, setHighlight] = useAtom(vc_highlightOPEDChaptersAtom)
    const [colourful, setColourful] = useAtom(vc_beautifyImageAtom)
    const [settings, setSettings] = useAtom(vc_settings)
    const [preferences, setPreferences] = useAtom(mediaCorePreferencesAtom)
    const delay = settings.subtitleDelay ?? 0
    const setDelay = (value: number) => setSettings({ ...settings, subtitleDelay: Math.round(value * 10) / 10 })
    const sub = subtitleLook(settings)
    const setSub = (patch: Partial<VideoCoreSettings["subtitleCustomization"]>) =>
        setSettings({ ...settings, subtitleCustomization: { ...sub, ...patch } })
    const cap = captionLook(settings)
    const setCap = (patch: Partial<VideoCoreSettings["captionCustomization"]>) =>
        setSettings({ ...settings, captionCustomization: { ...cap, ...patch } })

    const audio = tracks.filter(tr => tr.type === "audio")
    const subs = tracks.filter(tr => tr.type === "sub")
    const trackName = (track: PlayerTrack) => trackDisplayName(track, t)
    // the clock for "n min left", read when the menu opens and every 15 s while it is open
    const [now, setNow] = React.useState(0)
    React.useEffect(() => {
        if (!open) return
        const tick = () => setNow(Date.now())
        const first = setTimeout(tick, 0)
        const timer = setInterval(tick, 15_000)
        return () => {
            clearTimeout(first)
            clearInterval(timer)
        }
    }, [open, sleepTimer])
    const remaining = now ? sleepTimerRemainingMs(sleepTimer, now) : null
    const sleepLabel = sleepTimer === "episode"
        ? t("End of episode", "Ende der Folge")
        : remaining !== null ? t(`${Math.max(1, Math.ceil(remaining / 60000))} min left`, `noch ${Math.max(1, Math.ceil(remaining / 60000))} min`) : t("Off", "Aus")
    const boostLabel = boost <= 1 ? t("Off", "Aus") : `${Math.round(boost * 100)}%`
    const hasSubs = subs.length > 0

    // Subtitle translation lives in the server settings (2.0.x): one PATCH per value, each after the previous one, so
    // every request sees the one before; other settings stay untouched. The key itself is never shown.
    const mediaPlayer = useServerStatus()?.settings?.mediaPlayer
    const translate = translateSettings(mediaPlayer)
    const { mutate: patchSetting } = usePatchSetting()
    const patchMediaPlayer = (changes: [string, string | boolean][], onDone?: () => void): void => {
        const [change, ...rest] = changes
        if (!change) return onDone?.()
        onTranslateSettings?.()
        patchSetting({ path: `mediaPlayer.${change[0]}`, value: change[1] }, { onSuccess: () => patchMediaPlayer(rest, onDone) })
    }

    if (page === "main") {
        // landscape: the groups side by side, at least 14.5rem each (grid auto-fit), the title hidden
        const inner = width - 16
        const columns = landscape ? Math.max(1, Math.floor((inner + 8) / (232 + 8))) : 1
        const groupWidth = landscape ? (inner - (columns - 1) * 8) / columns : undefined
        const groups = [
            <MenuGroup key="playback" width={groupWidth} title={t("Playback", "Wiedergabe")}>
                <LinkRow icon={Gauge} label={t("Speed", "Geschwindigkeit")} value={`${speed.toFixed(2)}x`} onPress={() => onPageChange("speed")} />
                <LinkRow icon={Ratio} label={t("Picture", "Bildformat")} value={fitLabel(fit, t)} onPress={() => onPageChange("fit")} />
                <SwitchRow icon={CirclePlay} label={t("Auto play", "Automatisch abspielen")} checked={autoPlay} onChange={setAutoPlay} />
                <SwitchRow icon={FastForward} label={t("Auto next", "Nächste Folge automatisch")} checked={autoNext} onChange={setAutoNext} />
                <SwitchRow icon={Redo2} label={t("Skip OP/ED", "OP/ED überspringen")} checked={autoSkip} onChange={setAutoSkip} />
                <LinkRow icon={Volume2} label={t("Volume boost", "Lautstärke-Boost")} value={boostLabel} onPress={() => onPageChange("boost")} />
                <LinkRow icon={Timer} label={t("Sleep timer", "Sleep-Timer")} value={sleepLabel} onPress={() => onPageChange("sleep")} />
            </MenuGroup>,
            <MenuGroup key="language" width={groupWidth} title={t("Language & subtitles", "Sprache & Untertitel")}>
                <LinkRow icon={Captions} label={t("Languages", "Sprachen")} value={languageSummary(settings, t)} onPress={() => onPageChange("languages")} />
                {hasSubs && <LinkRow icon={Clock} label={t("Delay", "Versatz")} value={`${delay.toFixed(1)} s`} onPress={() => onPageChange("delay")} />}
                {subtitleKind === "ass" && <LinkRow icon={Captions} label={t("Style", "Stil")} value={sub.enabled ? t("On", "An") : t("Off", "Aus")} onPress={() => onPageChange("style")} />}
                {subtitleKind === "text" && <LinkRow icon={Captions} label={t("Caption style", "Stil der Bildunterschriften")} onPress={() => onPageChange("caption")} />}
            </MenuGroup>,
            <MenuGroup key="display" width={groupWidth} title={t("Display", "Darstellung")}>
                <LinkRow icon={TvMinimalPlay} label={t("Player appearance", "Player-Darstellung")} onPress={() => onPageChange("appearance")} />
                <LinkRow icon={SlidersHorizontal} label={t("Advanced", "Erweitert")} onPress={() => onPageChange("advanced")} />
            </MenuGroup>,
            <MenuGroup key="more" width={groupWidth} title={t("More", "Mehr")}>
                <LinkRow icon={ExternalLink} label={t("Open in another player", "In anderem Player öffnen")} onPress={() => onPageChange("external")} />
                {!!onSave && (
                    <ActionRow icon={Download} label={saving ? t("Preparing download …", "Download wird vorbereitet …") : t("Save this episode", "Diese Folge speichern")}
                        disabled={saving} onPress={onSave} />
                )}
            </MenuGroup>,
        ]
        return (
            <View>
                {!landscape && <Text className="mx-2 mb-3 mt-1.5 text-base font-semibold leading-[21px]">{t("Player settings", "Player-Einstellungen")}</Text>}
                <View className={landscape ? "flex-row flex-wrap items-start" : ""} style={{ rowGap: 14, columnGap: 8 }}>{groups}</View>
            </View>
        )
    }

    switch (page) {
        case "audio":
            return (
                <View>
                    <MenuTitle>{t("Audio", "Ton")}</MenuTitle>
                    {audio.map(track => <OptionRow key={track.id} checked={track.id === audioId} label={trackName(track)} onPress={() => onAudio(track)} />)}
                </View>
            )
        case "subtitles":
            return (
                <View>
                    <MenuTitle action={subtitleKind ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={t("Subtitle style", "Untertitel-Stil")} hitSlop={4}
                            onPress={() => onPageChange(subtitleKind === "ass" ? "style" : "caption")}
                            className="h-10 w-10 items-center justify-center rounded-lg active:bg-white/10">
                            <Paintbrush size={18} color={colors.smTextMuted} />
                        </Pressable>
                    ) : undefined}>{t("Subtitles", "Untertitel")}</MenuTitle>
                    <OptionRow checked={subId <= 0} label="Off" onPress={() => onSubtitle(null)} />
                    {subs.map(track => <OptionRow key={track.id} checked={track.id === subId} label={trackName(track)} onPress={() => onSubtitle(track)} />)}
                </View>
            )
        case "quality":
            return (
                <View>
                    <MenuTitle>Quality</MenuTitle>
                    {(qualities ?? []).map(q => <OptionRow key={q} checked={q === quality} label={q} onPress={() => {
                        onQuality?.(q)
                        close()
                    }} />)}
                </View>
            )
        case "speed":
            return (
                <Page title={t("Playback speed", "Geschwindigkeit")} onBack={back}>
                    <Text className="mt-2 text-center font-semibold" style={{ fontVariant: ["tabular-nums"] }}>{speed.toFixed(2)}x</Text>
                    <View className="mt-1 flex-row items-center gap-1.5">
                        <GrayButton label="-" accessibilityLabel={t("Decrease playback speed", "Langsamer")} disabled={speed <= SPEED_MIN}
                            onPress={() => onSpeed(stepSpeed(speed, -SPEED_STEP))} className="w-14 flex-none" />
                        <View className="flex-1">
                            <Slider value={speed} min={SPEED_MIN} max={SPEED_MAX} step={SPEED_STEP} onValueChange={v => onSpeed(Math.round(v * 100) / 100)}
                                accessibilityLabel={t("Playback speed", "Geschwindigkeit")} />
                        </View>
                        <GrayButton label="+" accessibilityLabel={t("Increase playback speed", "Schneller")} disabled={speed >= SPEED_MAX}
                            onPress={() => onSpeed(stepSpeed(speed, SPEED_STEP))} className="w-14 flex-none" />
                    </View>
                    <View className="mt-3 flex-row items-center gap-1.5">
                        {SPEED_PRESETS.map(p => <GrayButton key={p} label={p.toFixed(1)} onPress={() => onSpeed(p)} className="flex-1" />)}
                    </View>
                </Page>
            )
        case "fit":
            return (
                <Page title={t("Picture", "Bildformat")} onBack={back}>
                    {FITS.map(f => <OptionRow key={f} checked={f === fit} label={fitLabel(f, t)} onPress={() => setFit(f)} />)}
                </Page>
            )
        case "boost":
            return (
                <Page title={t("Volume boost", "Lautstärke-Boost")} onBack={back}>
                    {VOLUME_BOOSTS.map(b => <OptionRow key={b} checked={b === boost} label={b <= 1 ? "Off" : `${Math.round(b * 100)}%`} onPress={() => setBoost(b)} />)}
                </Page>
            )
        case "sleep":
            return (
                <Page title={t("Sleep timer", "Sleep-Timer")} onBack={back}>
                    <Para>{t("Pauses playback after the chosen time.", "Pausiert die Wiedergabe nach der gewählten Zeit.")}</Para>
                    <OptionRow checked={sleepTimer === null} label={t("Off", "Aus")} onPress={() => setSleepTimer(null)} />
                    {SLEEP_MINUTES.map(m => <OptionRow key={m} checked={false} label={`${m} min`} onPress={() => setSleepTimer(sleepTimerFrom(m, Date.now()))} />)}
                    <OptionRow checked={sleepTimer === "episode"} label={t("End of episode", "Ende der Folge")} onPress={() => setSleepTimer("episode")} />
                </Page>
            )
        case "languages":
            return (
                <Page title={t("Languages", "Sprachen")} onBack={back}>
                    <Para>{t("Chosen automatically when an episode starts and the stream offers it.",
                        "Wird beim Start einer Folge automatisch gewählt, wenn der Stream sie anbietet.")}</Para>
                    <PageLabel>{t("Subtitles", "Untertitel")}</PageLabel>
                    {PHONE_LANGUAGES.map(l => <OptionRow key={l.codes} checked={settings.preferredSubtitleLanguage === l.codes} label={t(l.en, l.de)}
                        onPress={() => setSettings({ ...settings, preferredSubtitleLanguage: l.codes })} />)}
                    <PageLabel>{t("Audio", "Audio")}</PageLabel>
                    {PHONE_LANGUAGES.map(l => <OptionRow key={l.codes} checked={settings.preferredAudioLanguage === l.codes} label={t(l.en, l.de)}
                        onPress={() => setSettings({ ...settings, preferredAudioLanguage: l.codes })} />)}
                </Page>
            )
        case "delay":
            return (
                <Page title={t("Subtitle delay", "Untertitel-Versatz")} onBack={back}>
                    <Para>{t("Plus shows subtitles later, minus earlier.", "Plus zeigt Untertitel später, Minus früher.")}</Para>
                    <View className="mt-3 flex-row items-center gap-1.5">
                        {[-0.5, -0.1].map(step => <GrayButton key={step} label={`−${-step}`} onPress={() => setDelay(delay + step)} className="flex-1" />)}
                        <Text className="flex-1 px-1 text-center text-sm text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>{delay.toFixed(1)}s</Text>
                        {[0.1, 0.5].map(step => <GrayButton key={step} label={`+${step}`} onPress={() => setDelay(delay + step)} className="flex-1" />)}
                    </View>
                    {DELAYS.map(d => <OptionRow key={d} checked={d === delay} label={d === 0 ? "0s" : `${d.toFixed(1)}s`} onPress={() => setDelay(d)} />)}
                </Page>
            )
        case "appearance":
            return (
                <Page title={t("Player appearance", "Player-Darstellung")} onBack={back}>
                    <Rows>
                        <SwitchRow icon={Redo2} label={t("Mark skippable parts on the seek bar", "Überspringbare Teile auf der Leiste markieren")} checked={highlight} onChange={setHighlight} />
                        <SwitchRow icon={Palette} label={t("Stronger colours", "Kräftigere Farben")} checked={colourful} onChange={setColourful} />
                    </Rows>
                </Page>
            )
        case "advanced":
            return (
                <Page title={t("Advanced", "Erweitert")} onBack={back}>
                    <Rows>
                        <LinkRow icon={Redo2} label={t("Skip patterns", "Skip-Muster")} value={listSummary(preferences.skipPatterns, t)} onPress={() => onPageChange("skipPatterns")} />
                        <LinkRow icon={Captions} label={t("Subtitle blacklist", "Untertitel-Blacklist")} value={listSummary(settings.preferredSubtitleBlacklist, t)}
                            onPress={() => onPageChange("blacklist")} />
                        {!!mediaPlayer && (
                            <LinkRow icon={Languages} label={t("Translate subtitles", "Untertitel übersetzen")}
                                value={translate.enabled ? translateLanguageLabel(translate.target) : t("Off", "Aus")} onPress={() => onPageChange("translate")} />
                        )}
                    </Rows>
                </Page>
            )
        case "translate":
            return (
                <Page title={t("Translate subtitles", "Untertitel übersetzen")} onBack={back}>
                    <Para>{t("Automatically translates subtitle tracks into the chosen language.", "Übersetzt Untertitelspuren automatisch in die gewählte Sprache.")}</Para>
                    <Rows>
                        <SwitchRow icon={Languages} label={t("Translate subtitles", "Untertitel übersetzen")} checked={translate.enabled}
                            onChange={value => patchMediaPlayer([["vcTranslate", value]])} />
                    </Rows>
                    <PageLabel>{t("Provider", "Anbieter")}</PageLabel>
                    <Select options={TRANSLATE_PROVIDERS} value={translate.provider} onChange={provider => patchMediaPlayer(translateProviderChanges(provider, mediaPlayer))} />
                    {translate.provider === "deepl" && <Para className="px-2 pt-2">{t("DeepL does not support all target languages.", "DeepL unterstützt nicht alle Zielsprachen.")}</Para>}
                    {translate.provider === "openai-compatible" && (
                        <SubOptionRow icon={Link} label={t("Base URL", "Basis-URL")} value={shortValue(translate.baseUrl)} onPress={() => onPageChange("translateBaseUrl")} />
                    )}
                    {translate.usesOpenAI && (
                        <SubOptionRow icon={Cpu} label={t("Model", "Modell")} value={shortValue(translate.model)} onPress={() => onPageChange("translateModel")} />
                    )}
                    {/* The key itself is never shown, only whether one is stored. */}
                    {translate.provider !== "google" && (
                        <SubOptionRow icon={Key} label={t("API key", "API-Schlüssel")} value={translate.hasKey ? t("Set", "Gesetzt") : t("Not set", "Nicht gesetzt")}
                            onPress={() => onPageChange("translateKey")} />
                    )}
                    <PageLabel>{t("Target language", "Zielsprache")}</PageLabel>
                    <Select options={TRANSLATE_LANGUAGES} value={translate.target} onChange={target => patchMediaPlayer([["vcTranslateTargetLanguage", target]])} />
                </Page>
            )
        case "translateBaseUrl":
            return (
                <Page title={t("Base URL", "Basis-URL")} onBack={back}>
                    <TextEditor
                        label={t("Base URL", "Basis-URL")}
                        help={t("OpenAI-compatible /v1 endpoint, e.g. LM Studio or Ollama.", "OpenAI-kompatibler /v1-Endpunkt, z. B. LM Studio oder Ollama.")}
                        placeholder="http://localhost:1234/v1"
                        value={translate.baseUrl}
                        onApply={value => {
                            patchMediaPlayer([["vcTranslateBaseUrl", value]])
                            onPageChange("translate")
                        }}
                        onCancel={() => onPageChange("translate")}
                    />
                </Page>
            )
        case "translateModel":
            return (
                <Page title={t("Model", "Modell")} onBack={back}>
                    <TextEditor
                        label={t("Model", "Modell")}
                        help={t("Name of the model that translates.", "Name des Modells, das übersetzt.")}
                        placeholder={translate.provider === "openai-compatible" ? "local-model" : "gpt-4o-mini"}
                        value={translate.model}
                        onApply={value => {
                            patchMediaPlayer([["vcTranslateModel", translateModelValue(translate.provider, value)]])
                            onPageChange("translate")
                        }}
                        onCancel={() => onPageChange("translate")}
                    />
                </Page>
            )
        case "translateKey":
            return (
                <Page title={t("API key", "API-Schlüssel")} onBack={back}>
                    <TextEditor
                        secret
                        label={t("API key", "API-Schlüssel")}
                        help={translate.provider === "openai-compatible"
                            ? t("Optional for local servers. Stored on the server.", "Für lokale Server optional. Wird auf dem Server gespeichert.")
                            : t("Stored on the server.", "Wird auf dem Server gespeichert.")}
                        placeholder={t("Enter your API key", "API-Schlüssel eingeben")}
                        value={translate.apiKey}
                        onApply={value => {
                            patchMediaPlayer([["vcTranslateApiKey", value]])
                            onPageChange("translate")
                        }}
                        onCancel={() => onPageChange("translate")}
                    />
                </Page>
            )
        case "skipPatterns":
            return (
                <Page title={t("Skip patterns", "Skip-Muster")} onBack={back}>
                    <TextEditor
                        label={t("Skip patterns", "Skip-Muster")}
                        help={t("Extra chapters to skip: comma-separated regular expressions, case is ignored. Opening and ending rules stay active.",
                            "Weitere Kapitel zum Überspringen: reguläre Ausdrücke mit Kommas getrennt, Groß-/Kleinschreibung egal. Opening- und Ending-Regeln bleiben aktiv.")}
                        placeholder="^Intro$,^Outro$,^Preview$"
                        value={preferences.skipPatterns}
                        validate={getSkipPatternError}
                        onApply={value => {
                            setPreferences(current => ({ ...current, skipPatterns: value.trim() }))
                            onPageChange("advanced")
                        }}
                        onCancel={() => onPageChange("advanced")}
                    />
                </Page>
            )
        case "blacklist":
            return (
                <Page title={t("Subtitle blacklist", "Untertitel-Blacklist")} onBack={back}>
                    <TextEditor
                        label={t("Subtitle blacklist", "Untertitel-Blacklist")}
                        help={t("Subtitle tracks with these names are not chosen automatically. Separate names with commas.",
                            "Untertitelspuren mit diesen Namen werden nicht automatisch gewählt. Namen mit Kommas trennen.")}
                        placeholder="signs & songs,signs/songs"
                        value={settings.preferredSubtitleBlacklist}
                        onApply={value => {
                            setSettings({ ...settings, preferredSubtitleBlacklist: value })
                            onPageChange("advanced")
                        }}
                        onCancel={() => onPageChange("advanced")}
                    />
                </Page>
            )
        case "style":
            return (
                <Page title={t("Subtitle styles", "Untertitel-Stil")} onBack={back}>
                    <Para>{t("ASS/SSA tracks with several styles keep their own look.", "ASS/SSA-Spuren mit mehreren Stilen behalten ihr eigenes Aussehen.")}</Para>
                    <OptionRow checked={sub.enabled} label="On" onPress={() => setSub({ enabled: true })} />
                    <OptionRow checked={!sub.enabled} label="Off" onPress={() => setSub({ enabled: false })} />
                    {sub.enabled && (
                        <>
                            <Para className="my-2">{t("Options", "Optionen")}</Para>
                            <SubOptionRow icon={Type} label="Font Size" value={optionLabel(SUBTITLE_FONT_SIZES, sub.fontSize)} onPress={() => onPageChange("styleSize")} />
                            <SubOptionRow icon={Palette} label="Text Color" value={optionLabel(STYLE_COLORS, sub.primaryColor)} onPress={() => onPageChange("styleColor")} />
                            <SubOptionRow icon={FileText} label="Outline"
                                value={`${optionLabel(SUBTITLE_OUTLINES, sub.outline)}, ${optionLabel(STYLE_COLORS, sub.outlineColor)}`} onPress={() => onPageChange("styleOutline")} />
                            <SubOptionRow icon={Blend} label="Shadow"
                                value={`${optionLabel(SUBTITLE_SHADOWS, sub.shadow)}, ${optionLabel(STYLE_COLORS, sub.backColor)}`} onPress={() => onPageChange("styleShadow")} />
                        </>
                    )}
                </Page>
            )
        case "styleSize":
            return (
                <Page title="Font Size" onBack={back}>
                    <Para>{t("Font size", "Schriftgröße")}</Para>
                    <Select options={SUBTITLE_FONT_SIZES} value={sub.fontSize} onChange={fontSize => setSub({ fontSize })} />
                </Page>
            )
        case "styleColor":
            return (
                <Page title="Text Color" onBack={back}>
                    <Select options={STYLE_COLORS} value={sub.primaryColor} onChange={primaryColor => setSub({ primaryColor })} />
                </Page>
            )
        case "styleOutline":
            return (
                <Page title="Outline" onBack={back}>
                    <Para>{t("Outline width", "Konturbreite")}</Para>
                    <Select options={SUBTITLE_OUTLINES} value={sub.outline} onChange={outline => setSub({ outline })} />
                    <Para className="my-2">{t("Outline colour", "Konturfarbe")}</Para>
                    <Select options={STYLE_COLORS} value={sub.outlineColor} onChange={outlineColor => setSub({ outlineColor })} />
                </Page>
            )
        case "styleShadow":
            return (
                <Page title="Shadow" onBack={back}>
                    <Para>{t("Shadow depth", "Schattentiefe")}</Para>
                    <Select options={SUBTITLE_SHADOWS} value={sub.shadow} onChange={shadow => setSub({ shadow })} />
                    <Para className="my-2">{t("Shadow opacity", "Schattendeckkraft")}</Para>
                    <Select options={SUBTITLE_SHADOW_OPACITIES} value={sub.backColorOpacity} onChange={backColorOpacity => setSub({ backColorOpacity })} />
                    <Para className="my-2">{t("Shadow colour", "Schattenfarbe")}</Para>
                    <Select options={STYLE_COLORS} value={sub.backColor} onChange={backColor => setSub({ backColor })} />
                </Page>
            )
        case "caption":
            return (
                <Page title={t("Caption styles", "Stil der Bildunterschriften")} onBack={back}>
                    <Para>{t("Only for subtitles that are not ASS.", "Nur für Untertitel, die kein ASS sind.")}</Para>
                    <Para className="my-2">{t("Options", "Optionen")}</Para>
                    <SubOptionRow icon={Type} label="Font Size" value={optionLabel(CAPTION_FONT_SIZES, cap.fontSize)} onPress={() => onPageChange("captionSize")} />
                    <SubOptionRow icon={Palette} label="Text Color" value={optionLabel(STYLE_COLORS, cap.textColor)} onPress={() => onPageChange("captionColor")} />
                    <SubOptionRow icon={Paintbrush} label="Background"
                        value={`${Math.round(cap.backgroundOpacity * 100)}%, ${optionLabel(STYLE_COLORS, cap.backgroundColor)}`} onPress={() => onPageChange("captionBackground")} />
                    <SubOptionRow icon={Blend} label="Shadow"
                        value={`${optionLabel(CAPTION_SHADOWS, cap.textShadow)}, ${optionLabel(STYLE_COLORS, cap.textShadowColor)}`} onPress={() => onPageChange("captionShadow")} />
                </Page>
            )
        case "captionSize":
            return (
                <Page title="Font Size" onBack={back}>
                    <Select options={CAPTION_FONT_SIZES} value={cap.fontSize} onChange={fontSize => setCap({ fontSize })} />
                </Page>
            )
        case "captionColor":
            return (
                <Page title="Text Color" onBack={back}>
                    <Select options={STYLE_COLORS} value={cap.textColor} onChange={textColor => setCap({ textColor })} />
                </Page>
            )
        case "captionBackground":
            return (
                <Page title="Background" onBack={back}>
                    <Para className="my-2">{t("Background opacity", "Hintergrunddeckkraft")}</Para>
                    <Select options={CAPTION_BACKGROUND_OPACITIES} value={cap.backgroundOpacity} onChange={backgroundOpacity => setCap({ backgroundOpacity })} />
                    <Para>{t("Background colour", "Hintergrundfarbe")}</Para>
                    <Select options={STYLE_COLORS} value={cap.backgroundColor} onChange={backgroundColor => setCap({ backgroundColor })} />
                </Page>
            )
        case "captionShadow":
            return (
                <Page title="Shadow" onBack={back}>
                    <Para>{t("Text shadow", "Textschatten")}</Para>
                    <Select options={CAPTION_SHADOWS} value={cap.textShadow} onChange={textShadow => setCap({ textShadow })} />
                    <Para className="my-2">{t("Shadow colour", "Schattenfarbe")}</Para>
                    <Select options={STYLE_COLORS} value={cap.textShadowColor} onChange={textShadowColor => setCap({ textShadowColor })} />
                </Page>
            )
        case "external":
            return (
                <Page title={t("Open in another player", "In anderem Player öffnen")} onBack={back}>
                    <Para>{t("Playback here pauses; the other app plays the same stream.", "Die Wiedergabe hier pausiert, die andere App spielt denselben Stream.")}</Para>
                    <Rows>
                        {ANDROID_PLAYER_PRESETS.map(preset => (
                            <ActionRow key={preset.packageName} icon={ExternalLink} label={preset.name} onPress={() => onExternal(preset.packageName)} />
                        ))}
                    </Rows>
                </Page>
            )
    }
    return null
}

/* ── Building blocks (video-core-phone-settings.css) ──────────────────── */

type Icon = React.ComponentType<{ size?: number, color?: string }>

/** `.vc-phone-group`: a small title over its rows */
function MenuGroup({ title, width, children }: { title: string, width?: number, children: React.ReactNode }) {
    return (
        <View style={width ? { width } : undefined}>
            <Text className="mx-3 mb-1.5 text-[13px] font-medium leading-[17px] text-sm-text-subtle">{title}</Text>
            <NarrowRows value={narrowRows(width)}>
                <Rows>{children}</Rows>
            </NarrowRows>
        </View>
    )
}

/** see narrowRows: rows of a narrow group show no icon and keep their value or switch at the right edge */
const NarrowRows = React.createContext(false)

/** `.vc-phone-group-rows`: the raised block, rows without gaps */
function Rows({ children }: { children: React.ReactNode }) {
    return <View className="overflow-hidden rounded-surface bg-sm-surface-raised">{children}</View>
}

/*
 * `.vc-phone-row`: the label is `flex: 1 1 6em` (90dp at 15dp) and the row wraps, so a value that does not fit next to
 * those 90dp moves under the label (ellipsis at 45 %) instead of squeezing the label letter by letter ("Langua|ges").
 */
function RowBody({ icon: RowIcon, label, children }: { icon: Icon, label: string, children?: React.ReactNode }) {
    const narrow = React.use(NarrowRows)
    return (
        <>
            {!narrow && <RowIcon size={20} color={colors.smTextMuted} />}
            <Text className="leading-[19.5px]" style={ROW_LABEL_STYLE}>{label}</Text>
            {children}
        </>
    )
}

const ROW = "min-h-12 w-full flex-row flex-wrap items-center gap-3 px-3 py-2 active:bg-sm-surface-control"

/** `.vc-phone-row` link: value and chevron on the right */
function LinkRow({ icon, label, value, onPress }: { icon: Icon, label: string, value?: string, onPress: () => void }) {
    const narrow = React.use(NarrowRows)
    // tablet.css: long values (two languages) get up to 62 %
    const isTablet = useIsTabletScreen()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} onPress={onPress} className={ROW}>
            <RowBody icon={icon} label={label}>
                {!!value && (
                    <Text numberOfLines={1} className="shrink-0 text-sm-text-muted"
                        style={{ maxWidth: rowValueMaxWidth(isTablet), fontVariant: ["tabular-nums"], marginLeft: narrow ? "auto" : undefined }}>{value}</Text>
                )}
                <View style={{ marginLeft: -4 }}><ChevronRight size={16} color={colors.smTextSubtle} /></View>
            </RowBody>
        </Pressable>
    )
}

/** A row that does something at once (native extras) */
function ActionRow({ icon, label, disabled, onPress }: { icon: Icon, label: string, disabled?: boolean, onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} className={ROW} style={disabled ? { opacity: 0.6 } : undefined}>
            <RowBody icon={icon} label={label} />
        </Pressable>
    )
}

/** `.vc-phone-row` switch: the whole row flips; the 38×22 switch of the web sheet */
function SwitchRow({ icon, label, checked, onChange }: { icon: Icon, label: string, checked: boolean, onChange: (value: boolean) => void }) {
    const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: withTiming(checked ? 16 : 0, { duration: 150 }) }] }), [checked])
    const narrow = React.use(NarrowRows)
    return (
        <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked }} onPress={() => onChange(!checked)} className={ROW}>
            <RowBody icon={icon} label={label}>
                <View style={{
                    marginLeft: narrow ? "auto" : undefined,
                    width: 38, height: 22, borderRadius: 999, padding: 3,
                    backgroundColor: checked ? colors.smAccentStrong : colors.smSurfaceControl,
                    borderWidth: checked ? 0 : 1, borderColor: colors.smLineStrong,
                }}>
                    <Animated.View style={[{
                        width: 16, height: 16, borderRadius: 999, marginTop: checked ? 0 : -1, marginLeft: checked ? 0 : -1,
                        backgroundColor: checked ? "#fff" : colors.smTextMuted,
                    }, thumb]} />
                </View>
            </RowBody>
        </Pressable>
    )
}

/** `menu-section-close`: Back with the page's title */
function Page({ title, onBack, children }: { title: string, onBack: () => void, children: React.ReactNode }) {
    const t = useTr()
    return (
        <View>
            <Pressable accessibilityRole="button" accessibilityLabel={t(`Back: ${title}`, `Zurück: ${title}`)} onPress={onBack}
                className="mb-1 min-h-12 flex-row items-center rounded-lg px-1 active:bg-white/10">
                <View className="w-8"><ChevronLeft size={18} color={colors.smText} /></View>
                <Text className="flex-1 text-base font-semibold">{title}</Text>
            </Pressable>
            {children}
        </View>
    )
}

/** `menu-title` of the bar's own menus (Audio, Subtitles, Quality) */
function MenuTitle({ children, action }: { children: React.ReactNode, action?: React.ReactNode }) {
    return (
        <View className="mb-1 min-h-12 flex-row items-center px-2 pb-3 pt-1.5">
            <Text className="flex-1 text-base font-semibold">{children}</Text>
            {action}
        </View>
    )
}

/** `setting-select-option`: a check in front of the chosen one */
function OptionRow({ checked, label, onPress }: { checked: boolean, label: string, onPress: () => void }) {
    return (
        <Pressable accessibilityRole="radio" accessibilityState={{ checked }} onPress={onPress}
            className="min-h-12 flex-row items-center rounded-surface-sm px-3 py-2 active:bg-white/10">
            <View className="w-8 flex-none">{checked && <Check size={18} color={colors.smAccent} />}</View>
            <Text numberOfLines={2} className="min-w-0 flex-1 font-medium">{label}</Text>
        </Pressable>
    )
}

function Select<T>({ options, value, onChange }: { options: { label: string, value: T }[], value: T, onChange: (value: T) => void }) {
    return <>{options.map(o => <OptionRow key={String(o.value)} checked={o.value === value} label={o.label} onPress={() => onChange(o.value)} />)}</>
}

/**
 * `menu-sub-option` (media-core-menu.tsx, video-core-phone-settings.css): icon, label, value, chevron. Every span is
 * .9375rem; the value has no ellipsis – a long one wraps onto more lines beside the label, which keeps its words whole
 * (CSS min-width: auto), and the row grows (`height: auto`).
 */
function SubOptionRow({ icon: RowIcon, label, value, onPress }: { icon: Icon, label: string, value: string, onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${value}`} onPress={onPress}
            className="min-h-12 flex-row items-center rounded-surface-sm px-3 py-2 active:bg-white/10">
            <View className="w-8"><RowIcon size={20} color={colors.smText} /></View>
            {/* the label takes what the value leaves; the value keeps its width up to 60 % and wraps beyond (no min-content in Yoga) */}
            <Text className="min-w-0 flex-1 font-medium">{label}</Text>
            <Text className="mr-2 text-[15px] font-medium tracking-wide text-sm-text-muted" style={{ flexShrink: 1, maxWidth: "60%" }}>{value}</Text>
            <ChevronRight size={18} color={colors.smText} />
        </Pressable>
    )
}

/** The pages' notes: 14dp, muted (`menu-section p`); `my-2` where the web spaces them on both sides */
function Para({ children, className }: { children: React.ReactNode, className?: string }) {
    return <Text className={cn("text-sm leading-[20px] text-sm-text-muted", className ?? "mb-2")}>{children}</Text>
}

/** `.vc-phone-page-label` */
function PageLabel({ children }: { children: React.ReactNode }) {
    return <Text className="mx-3 mb-1 mt-3 text-[13px] font-medium text-sm-text-subtle">{children}</Text>
}

/** The web's gray-subtle button */
function GrayButton({ label, accessibilityLabel, onPress, disabled, className }: {
    label: string
    accessibilityLabel?: string
    onPress: () => void
    disabled?: boolean
    className?: string
}) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} disabled={disabled} onPress={onPress}
            className={cn("min-h-12 items-center justify-center rounded-lg px-1 active:bg-white/20", className)}
            style={{ backgroundColor: "rgba(243, 244, 246, 0.1)", opacity: disabled ? 0.5 : 1 }}>
            <Text className="text-[15px] font-medium text-gray-100">{label}</Text>
        </Pressable>
    )
}

/** PhoneTextEditor: edits a draft, writes only on Apply; Back and Cancel leave the stored value as it was */
function TextEditor({ label, help, placeholder, value, validate, onApply, onCancel, secret }: {
    /** a key: dots instead of letters (type="password") */
    secret?: boolean
    label: string
    help: string
    placeholder: string
    value: string
    validate?: (value: string) => string
    onApply: (value: string) => void
    onCancel: () => void
}) {
    const t = useTr()
    const [draft, setDraft] = React.useState(value)
    const error = validate?.(draft) || ""
    const apply = () => {
        if (!error) onApply(draft)
    }
    return (
        <View>
            <Para>{help}</Para>
            <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={placeholder}
                placeholderTextColor={colors.smTextSubtle}
                accessibilityLabel={label}
                secureTextEntry={secret}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={apply}
                className="mt-2 min-h-12 rounded-surface-sm bg-sm-surface-control px-3 py-2 font-sans text-base text-sm-text"
                style={{ borderWidth: 1, borderColor: error ? "rgb(248, 113, 113)" : colors.smLineStrong }}
            />
            {!!error && <Text accessibilityRole="alert" className="mt-1.5 text-sm" style={{ color: "rgb(252, 165, 165)" }}>{error}</Text>}
            <View className="mt-3 flex-row flex-wrap gap-2">
                <Pressable accessibilityRole="button" onPress={onCancel} className="min-h-12 flex-1 items-center justify-center rounded-lg active:bg-white/20"
                    style={{ backgroundColor: "rgba(243, 244, 246, 0.1)", minWidth: 128 }}>
                    <Text className="font-medium text-gray-100">{t("Cancel", "Abbrechen")}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={!!error} onPress={apply}
                    className="min-h-12 flex-1 items-center justify-center rounded-lg bg-brand-500 active:bg-brand-600" style={{ minWidth: 128, opacity: error ? 0.5 : 1 }}>
                    <Text className="font-medium text-white">{t("Apply", "Übernehmen")}</Text>
                </Pressable>
            </View>
        </View>
    )
}
