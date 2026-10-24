import { useOpenInExplorer } from "@/api/hooks/explorer.hooks"
import { usePatchSetting } from "@/api/hooks/settings.hooks"
import { vc_subtitleManager } from "@/app/(main)/_features/video-core/video-core"
import { vc_mediaCaptionsManager } from "@/app/(main)/_features/video-core/video-core"
import { anime4kOptions, getAnime4KOptionByValue, vc_anime4kOption } from "@/app/(main)/_features/video-core/video-core-anime-4k"
import { Anime4KOption } from "@/app/(main)/_features/video-core/video-core-anime-4k-manager"
import { vc_menuOpen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_menuSectionOpen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_menuSubSectionOpen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isMobile } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_playbackRate } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isFullscreen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_miniPlayer } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_containerElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_activePlayerId } from "@/app/(main)/_features/video-core/video-core-atoms"
import { VideoCoreControlButtonIcon } from "@/app/(main)/_features/video-core/video-core-control-bar"
import {
    VideoCoreMenu,
    VideoCoreMenuOption,
    VideoCoreMenuSectionBody,
    VideoCoreMenuSubmenuBody,
    VideoCoreMenuSubOption,
    VideoCoreMenuSubSubmenuBody,
    VideoCoreMenuTitle,
    VideoCoreSettingSelect,
    VideoCoreSettingTextInput,
} from "@/app/(main)/_features/video-core/video-core-menu"
import { videoCorePreferencesModalAtom } from "@/app/(main)/_features/video-core/video-core-preferences"
import {
    vc_autoNextAtom,
    vc_autoPlayVideoAtom,
    vc_autoSkipOPEDAtom,
    vc_beautifyImageAtom,
    vc_highlightOPEDChaptersAtom,
    vc_initialSettings,
    vc_settings,
    vc_showChapterMarkersAtom,
    vc_storedPlaybackRateAtom,
    vc_storedVolumeBoostAtom,
    vc_useLibassRendererAtom,
    VideoCoreSettings,
} from "@/app/(main)/_features/video-core/video-core.atoms"
import { formatVolumeBoost, VOLUME_BOOST_OPTIONS } from "@/app/(main)/_features/media-core/media-core-volume-boost"
import { getSkipPatternError } from "@/app/(main)/_features/media-core/media-core-chapters"
import { mediaCorePreferencesAtom } from "@/app/(main)/_features/media-core/media-core-preferences"
import { vc_dispatchAction } from "@/app/(main)/_features/video-core/video-core.utils"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { upath } from "@/lib/helpers/upath"
import { Translate, useTr } from "@/lib/app-language"
import "@/components/shared/mobile-surface.css"
import "./video-core-phone-settings.css"
import { useAtomValue } from "jotai"
import { useAtom, useSetAtom } from "jotai/react"
import React, { useState } from "react"
import { HiFastForward } from "react-icons/hi"
import { ImFileText } from "react-icons/im"
import { IoCaretForwardCircleOutline } from "react-icons/io5"
import {
    LuChevronRight,
    LuChevronUp,
    LuCpu,
    LuHeading,
    LuKey,
    LuLink,
    LuPaintbrush,
    LuPalette,
    LuSettings,
    LuSettings2,
    LuSparkles,
    LuTvMinimalPlay,
    LuVolume2,
} from "react-icons/lu"
import { MdOutlineAccessTime, MdOutlineSubtitles, MdSpeed, MdTranslate } from "react-icons/md"
import { RiShadowLine } from "react-icons/ri"
import { TbArrowForwardUp } from "react-icons/tb"
import { VscTextSize } from "react-icons/vsc"

const SUBTITLE_STYLES_FONT_SIZE_OPTIONS = [
    { label: "Small", value: 54 },
    { label: "Medium", value: 62 },
    { label: "Large", value: 72 },
    { label: "Extra Large", value: 82 },
]

const SUBTITLE_STYLES_COLOR_OPTIONS = [
    { label: "White", value: "#FFFFFF" },
    { label: "Black", value: "#000000" },
    { label: "Gray", value: "#808080" },
    { label: "Yellow", value: "#FFD700" },
    { label: "Cyan", value: "#00FFFF" },
    { label: "Pink", value: "#FF69B4" },
    { label: "Purple", value: "#9370DB" },
    { label: "Lime", value: "#00FF00" },
]

const SUBTITLE_STYLES_OUTLINE_WIDTH_OPTIONS = [
    { label: "None", value: 0 },
    { label: "Small", value: 2 },
    { label: "Medium", value: 3 },
    { label: "Large", value: 4 },
]

const SUBTITLE_STYLES_SHADOW_DEPTH_OPTIONS = [
    { label: "None", value: 0 },
    { label: "Small", value: 1 },
    { label: "Medium", value: 2 },
    { label: "Large", value: 3 },
]

const SUBTITLE_STYLES_BACK_COLOR_OPACITY_OPTIONS = [
    { label: "100%", value: 0 },
    { label: "80%", value: 64 },
    { label: "70%", value: 77 },
    { label: "50%", value: 150 },
    { label: "25%", value: 200 },
    { label: "0%", value: 255 },
]

const vc_subtitleStylesDefaults: VideoCoreSettings["subtitleCustomization"] = {
    enabled: false,
    fontName: "",
    fontSize: SUBTITLE_STYLES_FONT_SIZE_OPTIONS[1].value,
    primaryColor: SUBTITLE_STYLES_COLOR_OPTIONS[0].value,
    outlineColor: SUBTITLE_STYLES_COLOR_OPTIONS[1].value,
    backColor: SUBTITLE_STYLES_COLOR_OPTIONS[1].value,
    backColorOpacity: SUBTITLE_STYLES_BACK_COLOR_OPACITY_OPTIONS[0].value,
    outline: SUBTITLE_STYLES_OUTLINE_WIDTH_OPTIONS[2].value,
    shadow: SUBTITLE_STYLES_SHADOW_DEPTH_OPTIONS[0].value,
}

export function vc_getSubtitleStyle<T extends keyof VideoCoreSettings["subtitleCustomization"]>(settings: VideoCoreSettings["subtitleCustomization"] | undefined,
    key: T,
): NonNullable<VideoCoreSettings["subtitleCustomization"][T]> {
    return settings?.[key] ?? vc_subtitleStylesDefaults[key] as any
}

function vc_getSubtitleStyleLabel<T extends keyof VideoCoreSettings["subtitleCustomization"]>(settings: VideoCoreSettings["subtitleCustomization"] | undefined,
    key: T,
): string {
    switch (key) {
        case "fontSize":
            return SUBTITLE_STYLES_FONT_SIZE_OPTIONS.find(o => o.value === vc_getSubtitleStyle(settings, key))?.label ?? ""
        case "outline":
            return SUBTITLE_STYLES_OUTLINE_WIDTH_OPTIONS.find(o => o.value === vc_getSubtitleStyle(settings, key))?.label ?? ""
        case "shadow":
            return SUBTITLE_STYLES_SHADOW_DEPTH_OPTIONS.find(o => o.value === vc_getSubtitleStyle(settings, key))?.label ?? ""
        case "primaryColor":
        case "outlineColor":
        case "backColor":
            return SUBTITLE_STYLES_COLOR_OPTIONS.find(o => o.value === vc_getSubtitleStyle(settings, key))?.label ?? ""
        // case "backColorOpacity":
        //     return `${((vc_getSubtitleStyle(settings, "backColorOpacity")-255) / 255 * 100).toFixed(0)}%`
    }
    return ""
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const CAPTION_STYLES_FONT_SIZE_OPTIONS = [
    { label: "Small", value: 4 },
    { label: "Medium", value: 5 },
    { label: "Large", value: 5.7 },
    { label: "Extra Large", value: 6.1 },
]

const CAPTION_STYLES_TEXT_SHADOW_OPTIONS = [
    { label: "None", value: 0 },
    { label: "Small", value: 2 },
    { label: "Medium", value: 4 },
    { label: "Large", value: 6 },
]

const CAPTION_STYLES_BACKGROUND_OPACITY_OPTIONS = [
    { label: "0%", value: 0 },
    { label: "25%", value: 0.25 },
    { label: "50%", value: 0.5 },
    { label: "70%", value: 0.7 },
    { label: "80%", value: 0.8 },
    { label: "100%", value: 1 },
]

const CAPTION_STYLES_COLOR_OPTIONS = SUBTITLE_STYLES_COLOR_OPTIONS

const vc_captionsStylesDefaults: VideoCoreSettings["captionCustomization"] = {
    fontSize: CAPTION_STYLES_FONT_SIZE_OPTIONS[1].value,
    textColor: CAPTION_STYLES_COLOR_OPTIONS[0].value,
    backgroundColor: SUBTITLE_STYLES_COLOR_OPTIONS[1].value,
    textShadow: CAPTION_STYLES_TEXT_SHADOW_OPTIONS[2].value,
    textShadowColor: CAPTION_STYLES_COLOR_OPTIONS[1].value,
    backgroundOpacity: CAPTION_STYLES_BACKGROUND_OPACITY_OPTIONS[3].value,
}

export function vc_getCaptionStyle<T extends keyof VideoCoreSettings["captionCustomization"]>(settings: VideoCoreSettings["captionCustomization"] | undefined,
    key: T,
): NonNullable<VideoCoreSettings["captionCustomization"][T]> {
    return settings?.[key] ?? vc_captionsStylesDefaults[key] as any
}

function vc_getCaptionStyleLabel<T extends keyof VideoCoreSettings["captionCustomization"]>(settings: VideoCoreSettings["captionCustomization"] | undefined,
    key: T,
): string {
    switch (key) {
        case "fontSize":
            return CAPTION_STYLES_FONT_SIZE_OPTIONS.find(o => o.value === vc_getCaptionStyle(settings, key))?.label ?? ""
        case "textShadow":
            return CAPTION_STYLES_TEXT_SHADOW_OPTIONS.find(o => o.value === vc_getCaptionStyle(settings, key))?.label ?? ""
        case "backgroundColor":
        case "textShadowColor":
        case "textColor":
            return CAPTION_STYLES_COLOR_OPTIONS.find(o => o.value === vc_getCaptionStyle(settings, key))?.label ?? ""
        case "backgroundOpacity":
            return `${(vc_getCaptionStyle(settings, "backgroundOpacity") * 100).toFixed(0)}%`
    }
    return ""
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export function VideoCoreSettingsMenu() {
    const serverStatus = useServerStatus()
    const isMobile = useAtomValue(vc_isMobile)
    const action = useSetAtom(vc_dispatchAction)
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    const playbackRate = useAtomValue(vc_playbackRate)
    const setPlaybackRate = useSetAtom(vc_storedPlaybackRateAtom)
    const [volumeBoost, setVolumeBoost] = useAtom(vc_storedVolumeBoostAtom)
    const isFullscreen = useAtomValue(vc_isFullscreen)
    const containerElement = useAtomValue(vc_containerElement)
    const subtitleManager = useAtomValue(vc_subtitleManager)
    const mediaCaptionsManager = useAtomValue(vc_mediaCaptionsManager)

    const [anime4kOption, setAnime4kOption] = useAtom(vc_anime4kOption)
    const currentAnime4kOption = getAnime4KOptionByValue(anime4kOption)

    const [, setKeybindingsModelOpen] = useAtom(videoCorePreferencesModalAtom)

    const [showChapterMarkers, setShowChapterMarkers] = useAtom(vc_showChapterMarkersAtom)
    const [highlightOPEDChapters, setHighlightOPEDChapters] = useAtom(vc_highlightOPEDChaptersAtom)
    const [beautifyImage, setBeautifyImage] = useAtom(vc_beautifyImageAtom)
    const [autoNext, setAutoNext] = useAtom(vc_autoNextAtom)
    const [autoPlay, setAutoPlay] = useAtom(vc_autoPlayVideoAtom)
    const [autoSkipOPED, setAutoSkipOPED] = useAtom(vc_autoSkipOPEDAtom)

    const [menuOpen, setMenuOpen] = useAtom(vc_menuOpen)
    const [openMenuSection, setOpenMenuSection] = useAtom(vc_menuSectionOpen)
    const [openMenuSubSection, setOpenMenuSubSection] = useAtom(vc_menuSubSectionOpen)

    const { mutate: openInExplorer, isPending: isOpeningInExplorer } = useOpenInExplorer()

    const [settings, setSettings] = useAtom(vc_settings)
    const [useLibassRenderer, setUseLibassRenderer] = useAtom(vc_useLibassRendererAtom)
    const [preferences, setPreferences] = useAtom(mediaCorePreferencesAtom)
    // The native player never registers as active; the preferences modal hides libass there too.
    const isWebPlayer = useAtomValue(vc_activePlayerId) !== null

    const t = useTr()
    const isPhone = isMobile
    // Section titles stay English ids; phones show them translated.
    const phoneLabel = (en: string, de: string) => isPhone ? t(en, de) : undefined
    // Android Back in fullscreen leaves fullscreen natively; the phone sheet must not stay open on the inline player.
    React.useEffect(() => {
        if (isPhone) setMenuOpen(open => open === "settings" ? null : open)
    }, [isFullscreen])

    const [editedSubCustomization, setEditedSubCustomization] = useState<VideoCoreSettings["subtitleCustomization"]>(
        settings.subtitleCustomization || vc_initialSettings.subtitleCustomization,
    )

    const [editedCaptionCustomization, setEditedCaptionCustomization] = useState<VideoCoreSettings["captionCustomization"]>(
        settings.captionCustomization || vc_initialSettings.captionCustomization,
    )

    const [editedSubtitleDelay, setEditedSubtitleDelay] = useState(settings.subtitleDelay ?? 0)

    const [subFontName, setSubFontName] = useState<string>(editedSubCustomization?.fontName || "")

    React.useEffect(() => {
        if (openMenuSection === "Subtitle Styles") {
            setEditedSubCustomization(settings.subtitleCustomization || vc_initialSettings.subtitleCustomization)
        }
        if (openMenuSection === "Caption Styles") {
            setEditedCaptionCustomization(settings.captionCustomization || vc_initialSettings.captionCustomization)
        }
        if (openMenuSection === "Subtitle Delay") {
            setEditedSubtitleDelay(settings.subtitleDelay)
        }
    }, [openMenuSection, settings])

    const handleSaveSettings = (customization?: VideoCoreSettings["subtitleCustomization"]) => {
        const newSettings = {
            ...settings,
            subtitleCustomization: customization || editedSubCustomization,
        }
        setSettings(newSettings)
        subtitleManager?.updateSettings(newSettings)

        // // Go back to submenu after saving from sub-submenu
        // setOpenMenuSubSection(null)
    }

    const handleSaveCaptionSettings = (customization?: VideoCoreSettings["captionCustomization"]) => {
        const newSettings = {
            ...settings,
            captionCustomization: customization || editedCaptionCustomization,
        }
        setSettings(newSettings)
        mediaCaptionsManager?.updateSettings(newSettings)
    }

    const handleSubtitleCustomizationChange = <K extends keyof VideoCoreSettings["subtitleCustomization"]>(
        key: K,
        value: VideoCoreSettings["subtitleCustomization"][K],
    ): void => {
        const newCustomization = {
            ...editedSubCustomization,
            [key]: value,
        }
        setEditedSubCustomization(newCustomization)
        React.startTransition(() => {
            handleSaveSettings(newCustomization)
        })
    }

    const handleCaptionCustomizationChange = <K extends keyof VideoCoreSettings["captionCustomization"]>(
        key: K,
        value: VideoCoreSettings["captionCustomization"][K],
    ): void => {
        const newCustomization = {
            ...editedCaptionCustomization,
            [key]: value,
        }
        setEditedCaptionCustomization(newCustomization)
        React.startTransition(() => {
            handleSaveCaptionSettings(newCustomization)
        })
    }

    const handlePreferredLanguageChange = (key: "preferredSubtitleLanguage" | "preferredAudioLanguage", codes: string): void => {
        const newSettings = { ...settings, [key]: codes }
        setSettings(newSettings)
        subtitleManager?.updateSettings(newSettings)
        mediaCaptionsManager?.updateSettings(newSettings)
    }

    const handleSubtitleDelayChange = (delay: number): void => {
        setEditedSubtitleDelay(delay)
        const newSettings = {
            ...settings,
            subtitleDelay: delay,
        }
        setSettings(newSettings)
        subtitleManager?.updateSettings(newSettings)
        mediaCaptionsManager?.updateSettings(newSettings)
    }

    // Same writes as the preferences modal's save.
    const handleSubtitleBlacklistChange = (blacklist: string): void => {
        const newSettings = { ...settings, preferredSubtitleBlacklist: blacklist }
        setSettings(newSettings)
        subtitleManager?.updateSettings(newSettings)
        mediaCaptionsManager?.updateSettings(newSettings)
        setOpenMenuSection(null)
    }

    const handleSkipPatternsChange = (patterns: string): void => {
        setPreferences(current => ({ ...current, skipPatterns: patterns.trim() }))
        setOpenMenuSection(null)
    }

    // Subtitle translation (phone): server settings, defaults as in the preferences modal.
    const { mutate: patchSetting } = usePatchSetting()
    const mediaPlayerSettings = serverStatus?.settings?.mediaPlayer
    const translateEnabled = mediaPlayerSettings?.vcTranslate ?? false
    const translateProvider = mediaPlayerSettings?.vcTranslateProvider || "google"
    const translateTarget = mediaPlayerSettings?.vcTranslateTargetLanguage || "en"
    const translateApiKey = mediaPlayerSettings?.vcTranslateApiKey || ""
    const translateBaseUrl = mediaPlayerSettings?.vcTranslateBaseUrl || "http://localhost:1234/v1"
    const translateModel = mediaPlayerSettings?.vcTranslateModel || (translateProvider === "openai" ? "gpt-4o-mini" : "local-model")
    const translateUsesOpenAI = translateProvider === "openai" || translateProvider === "openai-compatible"

    /** Patches one mediaPlayer value after the other so each request sees the previous one; other settings stay untouched. */
    const patchMediaPlayer = (changes: [string, string | boolean][], onDone?: () => void): void => {
        const [change, ...rest] = changes
        if (!change) return onDone?.()
        patchSetting({ path: `mediaPlayer.${change[0]}`, value: change[1] }, { onSuccess: () => patchMediaPlayer(rest, onDone) })
    }

    // Same follow-up as the preferences modal after saving.
    const updateShouldTranslate = (enabled: boolean, target: string): void => {
        subtitleManager?.updateShouldTranslate(enabled ? target : null)
        mediaCaptionsManager?.updateShouldTranslate(enabled ? target : null)
    }

    const handleTranslateProviderChange = (provider: string): void => {
        const changes: [string, string | boolean][] = [["vcTranslateProvider", provider]]
        // The modal saves its prefilled fields with the provider; fill the ones this provider needs.
        const storedModel = mediaPlayerSettings?.vcTranslateModel || ""
        if (provider === "openai" && (!storedModel || storedModel === "local-model")) changes.push(["vcTranslateModel", "gpt-4o-mini"])
        if (provider === "openai-compatible") {
            if (!mediaPlayerSettings?.vcTranslateBaseUrl) changes.push(["vcTranslateBaseUrl", "http://localhost:1234/v1"])
            if (!storedModel) changes.push(["vcTranslateModel", "local-model"])
        }
        patchMediaPlayer(changes)
    }

    const handleTranslateModelChange = (model: string): void => {
        const value = translateProvider === "openai" && (!model || model === "local-model") ? "gpt-4o-mini" : model
        patchMediaPlayer([["vcTranslateModel", value]])
        setOpenMenuSubSection(null)
    }

    if (isMiniPlayer) return null

    return (
        <>
            {playbackRate !== 1 && (
                <p
                    className="text-sm text-[--muted] cursor-pointer" onClick={() => {
                    setMenuOpen("settings")
                    React.startTransition(() => {
                        setOpenMenuSection("Playback Speed")
                    })
                }}
                >
                    {`${(playbackRate).toFixed(2)}x`}
                </p>
            )}
            <VideoCoreMenu
                name="settings"
                className={isPhone ? "vc-phone-settings" : undefined}
                // Android Back / Escape steps back one page before it closes the sheet.
                onEscapeKeyDown={isPhone ? (e: KeyboardEvent) => {
                    if (openMenuSubSection) {
                        e.preventDefault()
                        setOpenMenuSubSection(null)
                    } else if (openMenuSection) {
                        e.preventDefault()
                        setOpenMenuSection(null)
                    }
                } : undefined}
                trigger={<VideoCoreControlButtonIcon
                    icons={[
                        ["default", isMobile ? LuSettings : LuChevronUp],
                    ]}
                    state="default"
                    className={isMobile ? "text-xl" : ""}
                    onClick={() => {
                    }}
                />}
            >
                {isPhone ? <VideoCoreMenuSectionBody>
                    <PhoneSettingsHome
                        t={t}
                        open={setOpenMenuSection}
                        playbackRate={playbackRate}
                        volumeBoost={volumeBoost}
                        autoPlay={autoPlay}
                        setAutoPlay={setAutoPlay}
                        autoNext={autoNext}
                        setAutoNext={setAutoNext}
                        autoSkipOPED={autoSkipOPED}
                        setAutoSkipOPED={setAutoSkipOPED}
                        languages={phoneLanguageSummary(settings, t)}
                        subtitleDelay={(subtitleManager || mediaCaptionsManager) ? settings.subtitleDelay : null}
                        subtitleStyles={subtitleManager ? (editedSubCustomization?.enabled ? t("On", "An") : t("Off", "Aus")) : null}
                        captionStyles={!!mediaCaptionsManager}
                        useLibassRenderer={isWebPlayer ? useLibassRenderer : null}
                        setUseLibassRenderer={setUseLibassRenderer}
                        subtitleBlacklist={settings.preferredSubtitleBlacklist}
                        translation={!mediaPlayerSettings ? null : translateEnabled ? translateLanguageLabel(translateTarget) : t("Off", "Aus")}
                        skipPatterns={preferences.skipPatterns}
                    />
                </VideoCoreMenuSectionBody> : <VideoCoreMenuSectionBody>
                    <VideoCoreMenuTitle>Settings</VideoCoreMenuTitle>
                    <VideoCoreMenuOption title="Playback Speed" icon={MdSpeed} value={`${(playbackRate).toFixed(2)}x`} />
                    <VideoCoreMenuOption title="Volume Boost" icon={LuVolume2} value={formatVolumeBoost(volumeBoost)} />
                    <VideoCoreMenuOption title="Auto Play" icon={IoCaretForwardCircleOutline} value={autoPlay ? "On" : "Off"} />
                    <VideoCoreMenuOption title="Auto Next" icon={HiFastForward} value={autoNext ? "On" : "Off"} />
                    <VideoCoreMenuOption title="Skip OP/ED" icon={TbArrowForwardUp} value={autoSkipOPED ? "On" : "Off"} />
                    <VideoCoreMenuOption title="Anime4K" icon={LuSparkles} value={currentAnime4kOption?.label || "Off"} />
                    {(subtitleManager || mediaCaptionsManager) && <VideoCoreMenuOption
                        title="Subtitle Delay"
                        icon={MdOutlineAccessTime}
                        value={`${settings.subtitleDelay.toFixed(1)}s`}
                    />}
                    {subtitleManager && <VideoCoreMenuOption
                        title="Subtitle Styles"
                        icon={MdOutlineSubtitles}
                        value={editedSubCustomization?.enabled ? `On${!!editedSubCustomization?.fontName ? ", Font" : ""}` : "Off"}
                    />}
                    {mediaCaptionsManager && <VideoCoreMenuOption
                        title="Caption Styles"
                        icon={MdOutlineSubtitles}
                    />}
                    <VideoCoreMenuOption title="Player Appearance" icon={LuTvMinimalPlay} />
                    <VideoCoreMenuOption title="Preferences" icon={LuSettings2} onClick={() => setKeybindingsModelOpen(true)} />
                </VideoCoreMenuSectionBody>}
                <VideoCoreMenuSubmenuBody>
                    <VideoCoreMenuOption title="Subtitle Styles" label={phoneLabel("Subtitle styles", "Untertitel-Stil")} icon={MdOutlineSubtitles}>
                        <p className="text-sm text-[--muted] mb-2">Subtitle customization will not override ASS/SSA tracks that contain multiple
                                                                   styles.</p>
                        <VideoCoreSettingSelect
                            options={[
                                { label: "On", value: 1 },
                                { label: "Off", value: 0 },
                            ]}
                            onValueChange={(v: number) => handleSubtitleCustomizationChange("enabled", v === 1)}
                            value={editedSubCustomization.enabled ? 1 : 0}
                        />
                        {editedSubCustomization.enabled && <>
                            <p className="text-[--muted] text-sm my-2">Options</p>
                            {/* Custom fonts are files in the desktop assets folder; phones cannot place them. */}
                            {!isPhone && <VideoCoreMenuSubOption
                                title="Font"
                                icon={LuHeading}
                                parentId="Subtitle Styles"
                                value={!editedSubCustomization.fontName ? "Default" : editedSubCustomization.fontName?.slice(0,
                                    11) + (!!editedSubCustomization.fontName?.length && editedSubCustomization.fontName?.length > 10
                                    ? "..."
                                    : "")}
                            />}
                            <VideoCoreMenuSubOption
                                title="Font Size"
                                icon={VscTextSize}
                                parentId="Subtitle Styles"
                                value={vc_getSubtitleStyleLabel(settings.subtitleCustomization, "fontSize")}
                            />
                            <VideoCoreMenuSubOption
                                title="Text Color"
                                icon={LuPalette}
                                parentId="Subtitle Styles"
                                value={vc_getSubtitleStyleLabel(settings.subtitleCustomization, "primaryColor")}
                            />
                            <VideoCoreMenuSubOption
                                title="Outline"
                                icon={ImFileText}
                                parentId="Subtitle Styles"
                                value={`${vc_getSubtitleStyleLabel(settings.subtitleCustomization,
                                    "outline")}, ${vc_getSubtitleStyleLabel(settings.subtitleCustomization, "outlineColor")}`}
                            />
                            <VideoCoreMenuSubOption
                                title="Shadow"
                                icon={RiShadowLine}
                                parentId="Subtitle Styles"
                                value={`${vc_getSubtitleStyleLabel(settings.subtitleCustomization,
                                    "shadow")}, ${vc_getSubtitleStyleLabel(settings.subtitleCustomization, "backColor")}`}
                            />
                        </>}
                    </VideoCoreMenuOption>
                    <VideoCoreMenuOption title="Caption Styles" label={phoneLabel("Caption styles", "Stil der Bildunterschriften")} icon={MdOutlineSubtitles}>
                        <p className="text-sm text-[--muted] mb-2">This only applies to non-ASS subtitles.</p>
                        {/*<VideoCoreSettingSelect*/}
                        {/*    options={[*/}
                        {/*        { label: "On", value: 1 },*/}
                        {/*        { label: "Off", value: 0 },*/}
                        {/*    ]}*/}
                        {/*    onValueChange={(v: number) => handleCaptionCustomizationChange("enabled", v === 1)}*/}
                        {/*    value={editedCaptionCustomization.enabled ? 1 : 0}*/}
                        {/*/>*/}
                        {/*{editedCaptionCustomization.enabled && <>*/}
                        <p className="text-[--muted] text-sm my-2">Options</p>
                        <VideoCoreMenuSubOption
                            title="Font Size"
                            icon={VscTextSize}
                            parentId="Caption Styles"
                            value={vc_getCaptionStyleLabel(settings.captionCustomization, "fontSize")}
                        />
                        {/*<VideoCoreMenuSubOption title="Font Family" icon={LuHeading} parentId="Caption Styles" />*/}
                        <VideoCoreMenuSubOption
                            title="Text Color"
                            icon={LuPalette}
                            parentId="Caption Styles"
                            value={vc_getCaptionStyleLabel(settings.captionCustomization, "textColor")}
                        />
                        <VideoCoreMenuSubOption
                            title="Background"
                            icon={LuPaintbrush}
                            parentId="Caption Styles"
                            value={`${vc_getCaptionStyleLabel(settings.captionCustomization,
                                "backgroundOpacity")}, ${vc_getCaptionStyleLabel(settings.captionCustomization, "backgroundColor")}`}
                        />
                        {/*<VideoCoreMenuSubOption title="Outline" icon={ImFileText} parentId="Caption Styles" />*/}
                        <VideoCoreMenuSubOption
                            title="Shadow"
                            icon={RiShadowLine}
                            parentId="Caption Styles"
                            value={`${vc_getCaptionStyleLabel(settings.captionCustomization,
                                "textShadow")}, ${vc_getCaptionStyleLabel(settings.captionCustomization, "textShadowColor")}`}
                        />
                        {/*</>}*/}
                    </VideoCoreMenuOption>
                    <VideoCoreMenuOption title="Subtitle Delay" label={phoneLabel("Subtitle delay", "Untertitel-Versatz")} icon={MdOutlineAccessTime}>
                        <p className="text-sm text-[--muted] mb-2">Positive values delay subtitles, negative values advance them.</p>
                        <div className="flex gap-1.5 items-center mt-3">
                            <Button
                                className="px-1 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                onClick={() => handleSubtitleDelayChange(parseFloat((editedSubtitleDelay - 0.5).toFixed(1)))}
                            >
                                −0.5
                            </Button>
                            <Button
                                className="px-1 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                onClick={() => handleSubtitleDelayChange(parseFloat((editedSubtitleDelay - 0.1).toFixed(1)))}
                            >
                                −0.1
                            </Button>
                            <span className="text-sm text-center text-[--muted] px-1 flex-1">
                                {editedSubtitleDelay.toFixed(1)}s
                            </span>
                            <Button
                                className="px-1 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                onClick={() => handleSubtitleDelayChange(parseFloat((editedSubtitleDelay + 0.1).toFixed(1)))}
                            >
                                +0.1
                            </Button>
                            <Button
                                className="px-1 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                onClick={() => handleSubtitleDelayChange(parseFloat((editedSubtitleDelay + 0.5).toFixed(1)))}
                            >
                                +0.5
                            </Button>
                        </div>
                        <VideoCoreSettingSelect
                            options={[
                                { label: "-2.0s", value: -2.0 },
                                { label: "-1.0s", value: -1.0 },
                                { label: "-0.5s", value: -0.5 },
                                { label: "0s", value: 0 },
                                { label: "0.5s", value: 0.5 },
                                { label: "1.0s", value: 1.0 },
                                { label: "2.0s", value: 2.0 },
                            ]}
                            onValueChange={(v: number) => {
                                handleSubtitleDelayChange(v)
                            }}
                            value={[-2.0, -1.0, -0.5, 0, 0.5, 1.0, 2.0].includes(editedSubtitleDelay) ? editedSubtitleDelay : null}
                        />
                    </VideoCoreMenuOption>
                    <VideoCoreMenuOption title="Playback Speed" label={phoneLabel("Playback speed", "Geschwindigkeit")} icon={MdSpeed}>
                        <p className="text-center font-semibold mt-2 select-none">
                            {(playbackRate).toFixed(2)}x
                        </p>
                        <div className="flex gap-1.5 items-center mt-1">
                            <Button
                                className="px-1 pl-4 pr-4 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                aria-label="Decrease playback speed"
                                disabled={playbackRate <= 0.25}
                                onClick={() => setPlaybackRate(Math.max(0.25, Math.round((playbackRate - 0.05) * 100) / 100))}
                            >
                                -
                            </Button>
                            <Slider
                                aria-label="Playback speed"
                                value={[playbackRate]}
                                defaultValue={[1]}
                                min={0.25}
                                max={2}
                                step={0.05}
                                onValueChange={(v) => setPlaybackRate(v[0])}>
                            </Slider>
                            <Button
                                className="px-1 pl-4 pr-4 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                aria-label="Increase playback speed"
                                disabled={playbackRate >= 2}
                                onClick={() => setPlaybackRate(Math.min(2, Math.round((playbackRate + 0.05) * 100) / 100))}
                            >
                                +
                            </Button>
                        </div>
                        <div className="flex gap-1.5 items-center mt-3">
                            <Button
                                className="px-1 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                onClick={() => setPlaybackRate(0.5)}
                            >
                                0.5
                            </Button>
                            <Button
                                className="px-1 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                onClick={() => setPlaybackRate(1)}
                            >
                                1.0
                            </Button>
                            <Button
                                className="px-1 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                onClick={() => setPlaybackRate(1.2)}
                            >
                                1.2
                            </Button>
                            <Button
                                className="px-1 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                onClick={() => setPlaybackRate(1.5)}
                            >
                                1.5
                            </Button>
                            <Button
                                className="px-1 !text-xs flex-1"
                                intent="gray-subtle"
                                size="sm"
                                onClick={() => setPlaybackRate(2)}
                            >
                                2.0
                            </Button>
                        </div>
                    </VideoCoreMenuOption>
                    <VideoCoreMenuOption title="Volume Boost" label={phoneLabel("Volume boost", "Lautstärke-Boost")} icon={LuVolume2}>
                        <VideoCoreSettingSelect
                            options={VOLUME_BOOST_OPTIONS}
                            onValueChange={(v: number) => {
                                setVolumeBoost(v)
                            }}
                            value={VOLUME_BOOST_OPTIONS.some(o => o.value === volumeBoost) ? volumeBoost : null}
                        />
                        {!isPhone && <p className="text-[--muted] text-sm px-2 pt-2">Shift + Up/Down to adjust</p>}
                    </VideoCoreMenuOption>
                    <VideoCoreMenuOption title="Auto Play" icon={IoCaretForwardCircleOutline}>
                        <VideoCoreSettingSelect
                            options={[
                                { label: "On", value: 1 },
                                { label: "Off", value: 0 },
                            ]}
                            onValueChange={(v: number) => {
                                setAutoPlay(!!v)
                            }}
                            value={autoPlay ? 1 : 0}
                        />
                    </VideoCoreMenuOption>
                    <VideoCoreMenuOption title="Auto Next" icon={HiFastForward}>
                        <VideoCoreSettingSelect
                            options={[
                                { label: "On", value: 1 },
                                { label: "Off", value: 0 },
                            ]}
                            onValueChange={(v: number) => {
                                setAutoNext(!!v)
                            }}
                            value={autoNext ? 1 : 0}
                        />
                    </VideoCoreMenuOption>
                    <VideoCoreMenuOption title="Skip OP/ED" icon={TbArrowForwardUp}>
                        <VideoCoreSettingSelect
                            options={[
                                { label: "On", value: 1 },
                                { label: "Off", value: 0 },
                            ]}
                            onValueChange={(v: number) => {
                                setAutoSkipOPED(!!v)
                            }}
                            value={autoSkipOPED ? 1 : 0}
                        />
                    </VideoCoreMenuOption>
                    <VideoCoreMenuOption title="Anime4K" label={phoneLabel("Anime4K", "Anime4K")} icon={LuSparkles}>
                        <p className="text-[--muted] text-sm mb-2">
                            Real-time sharpening. GPU-intensive.
                        </p>
                        <VideoCoreSettingSelect
                            isFullscreen={isFullscreen}
                            containerElement={containerElement}
                            options={anime4kOptions.map(option => ({
                                label: `${option.label}`,
                                value: option.value,
                                moreInfo: option.performance === "heavy" ? "Heavy" : undefined,
                                description: option.description,
                            }))}
                            onValueChange={(value: Anime4KOption) => {
                                setAnime4kOption(value)
                            }}
                            value={anime4kOption}
                        />
                    </VideoCoreMenuOption>
                    {isPhone && <VideoCoreMenuOption title="Default Languages" label={t("Languages", "Sprachen")} icon={MdOutlineSubtitles}>
                        <p className="text-sm text-[--muted] mb-2">{t("Chosen automatically when an episode starts and the stream offers it.",
                            "Wird beim Start einer Folge automatisch gewählt, wenn der Stream sie anbietet.")}</p>
                        <p className="vc-phone-page-label">{t("Subtitles", "Untertitel")}</p>
                        <VideoCoreSettingSelect
                            options={PHONE_LANGUAGES.map(l => ({ label: t(l.en, l.de), value: l.codes }))}
                            onValueChange={(v: string) => handlePreferredLanguageChange("preferredSubtitleLanguage", v)}
                            value={settings.preferredSubtitleLanguage}
                        />
                        <p className="vc-phone-page-label">{t("Audio", "Audio")}</p>
                        <VideoCoreSettingSelect
                            options={PHONE_LANGUAGES.map(l => ({ label: t(l.en, l.de), value: l.codes }))}
                            onValueChange={(v: string) => handlePreferredLanguageChange("preferredAudioLanguage", v)}
                            value={settings.preferredAudioLanguage}
                        />
                    </VideoCoreMenuOption>}
                    {isPhone && <VideoCoreMenuOption title="Subtitle Blacklist" label={t("Subtitle blacklist", "Untertitel-Blacklist")} icon={MdOutlineSubtitles}>
                        <PhoneTextEditor
                            t={t}
                            label={t("Subtitle blacklist", "Untertitel-Blacklist")}
                            help={t("Subtitle tracks with these names are not chosen automatically. Separate names with commas.",
                                "Untertitelspuren mit diesen Namen werden nicht automatisch gewählt. Namen mit Kommas trennen.")}
                            placeholder="signs & songs,signs/songs"
                            value={settings.preferredSubtitleBlacklist}
                            onApply={handleSubtitleBlacklistChange}
                            onCancel={() => setOpenMenuSection(null)}
                        />
                    </VideoCoreMenuOption>}
                    {isPhone && <VideoCoreMenuOption title="Skip Patterns" label={t("Skip patterns", "Skip-Muster")} icon={TbArrowForwardUp}>
                        <PhoneTextEditor
                            t={t}
                            label={t("Skip patterns", "Skip-Muster")}
                            help={t("Extra chapters to skip: comma-separated regular expressions, case is ignored. Opening and ending rules stay active.",
                                "Weitere Kapitel zum Überspringen: reguläre Ausdrücke mit Kommas getrennt, Groß-/Kleinschreibung egal. Opening- und Ending-Regeln bleiben aktiv.")}
                            placeholder="^Intro$,^Outro$,^Preview$"
                            value={preferences.skipPatterns}
                            validate={getSkipPatternError}
                            onApply={handleSkipPatternsChange}
                            onCancel={() => setOpenMenuSection(null)}
                        />
                    </VideoCoreMenuOption>}
                    {isPhone && mediaPlayerSettings && <VideoCoreMenuOption
                        title="Subtitle Translation"
                        label={t("Translate subtitles", "Untertitel übersetzen")}
                        icon={MdTranslate}
                    >
                        <p className="mb-2">{t("Automatically translates subtitle tracks into the chosen language.",
                            "Übersetzt Untertitelspuren automatisch in die gewählte Sprache.")}</p>
                        <PhoneSwitchRow
                            icon={MdTranslate}
                            label={t("Translate subtitles", "Untertitel übersetzen")}
                            checked={translateEnabled}
                            onChange={v => patchMediaPlayer([["vcTranslate", v]], () => updateShouldTranslate(v, translateTarget))}
                        />
                        <p className="vc-phone-page-label">{t("Provider", "Anbieter")}</p>
                        <VideoCoreSettingSelect
                            options={TRANSLATE_PROVIDERS}
                            onValueChange={handleTranslateProviderChange}
                            value={translateProvider}
                        />
                        {translateProvider === "deepl" && <p className="px-2 pt-2">{t("DeepL does not support all target languages.",
                            "DeepL unterstützt nicht alle Zielsprachen.")}</p>}
                        {translateProvider === "openai-compatible" && <VideoCoreMenuSubOption
                            title={t("Base URL", "Basis-URL")}
                            icon={LuLink}
                            parentId="Subtitle Translation"
                            value={phoneShort(translateBaseUrl)}
                        />}
                        {translateUsesOpenAI && <VideoCoreMenuSubOption
                            title={t("Model", "Modell")}
                            icon={LuCpu}
                            parentId="Subtitle Translation"
                            value={phoneShort(translateModel)}
                        />}
                        {/* The key itself is never shown, only whether one is stored. */}
                        {translateProvider !== "google" && <VideoCoreMenuSubOption
                            title={t("API key", "API-Schlüssel")}
                            icon={LuKey}
                            parentId="Subtitle Translation"
                            value={translateApiKey ? t("Set", "Gesetzt") : t("Not set", "Nicht gesetzt")}
                        />}
                        <p className="vc-phone-page-label">{t("Target language", "Zielsprache")}</p>
                        <VideoCoreSettingSelect
                            options={TRANSLATE_LANGUAGES}
                            onValueChange={(v: string) => patchMediaPlayer([["vcTranslateTargetLanguage", v]], () => updateShouldTranslate(translateEnabled, v))}
                            value={translateTarget}
                        />
                    </VideoCoreMenuOption>}
                    <VideoCoreMenuOption title="Player Appearance" label={phoneLabel("Player appearance", "Player-Darstellung")} icon={LuPaintbrush}>
                        <Switch
                            label="Show Chapter Markers"
                            side="right"
                            fieldClass="hover:bg-transparent hover:border-transparent px-0 ml-0 w-full"
                            size="sm"
                            value={showChapterMarkers}
                            onValueChange={setShowChapterMarkers}
                        />
                        <Switch
                            label="Highlight Skipped Chapters"
                            side="right"
                            fieldClass="hover:bg-transparent hover:border-transparent px-0 ml-0 w-full"
                            size="sm"
                            value={highlightOPEDChapters}
                            onValueChange={setHighlightOPEDChapters}
                        />
                        <Switch
                            label="Increase Saturation"
                            side="right"
                            fieldClass="hover:bg-transparent hover:border-transparent px-0 ml-0 w-full"
                            size="sm"
                            value={beautifyImage}
                            onValueChange={setBeautifyImage}
                        />
                    </VideoCoreMenuOption>
                </VideoCoreMenuSubmenuBody>
                <VideoCoreMenuSubSubmenuBody>
                    <VideoCoreMenuSubOption title="Font" icon={VscTextSize} parentId="Subtitle Styles">
                        <div className="">
                            <p className="text-sm mb-2">Custom Font</p>
                            <p className="text-sm text-[--muted] mb-2">
                                Place the font file in the <span
                                className="text-indigo-300 cursor-pointer underline underline-offset-2"
                                onClick={() => {
                                    openInExplorer({ path: upath.normalize(`${serverStatus?.dataDir}/assets`) })
                                }}
                            >Seanime assets directory</span>. The file name must match
                                the font name exactly.
                            </p>
                            <div className="space-y-2">
                                <VideoCoreSettingTextInput
                                    label="File Name"
                                    value={subFontName ?? ""}
                                    onValueChange={(v: string) => setSubFontName(v)}
                                    help="Example: Noto Sans JP.woff2"
                                />
                                <div className="flex w-full">
                                    <Button
                                        size="sm" intent="gray-subtle" onClick={() => {
                                        handleSubtitleCustomizationChange("fontName", subFontName)
                                    }}
                                    >
                                        Save
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </VideoCoreMenuSubOption>
                    <VideoCoreMenuSubOption title="Font Size" icon={LuHeading} parentId="Subtitle Styles">
                        <p className="text-[--muted] text-sm mb-2">Font Size</p>
                        <VideoCoreSettingSelect
                            options={SUBTITLE_STYLES_FONT_SIZE_OPTIONS}
                            onValueChange={(v: number) => handleSubtitleCustomizationChange("fontSize", v)}
                            value={vc_getSubtitleStyle(editedSubCustomization, "fontSize")}
                        />
                    </VideoCoreMenuSubOption>
                    <VideoCoreMenuSubOption title="Text Color" icon={LuPalette} parentId="Subtitle Styles">
                        <VideoCoreSettingSelect
                            options={SUBTITLE_STYLES_COLOR_OPTIONS}
                            onValueChange={(v: string) => handleSubtitleCustomizationChange("primaryColor", v)}
                            value={vc_getSubtitleStyle(editedSubCustomization, "primaryColor")}
                        />
                    </VideoCoreMenuSubOption>
                    <VideoCoreMenuSubOption title="Outline" icon={LuPalette} parentId="Subtitle Styles">
                        <p className="text-[--muted] text-sm mb-2">Outline Width</p>
                        <VideoCoreSettingSelect
                            options={SUBTITLE_STYLES_OUTLINE_WIDTH_OPTIONS}
                            onValueChange={(v: number) => handleSubtitleCustomizationChange("outline", v)}
                            value={vc_getSubtitleStyle(editedSubCustomization, "outline")}
                        />
                        <p className="text-[--muted] text-sm my-2">Outline Color</p>
                        <VideoCoreSettingSelect
                            options={SUBTITLE_STYLES_COLOR_OPTIONS}
                            onValueChange={(v: string) => handleSubtitleCustomizationChange("outlineColor", v)}
                            value={vc_getSubtitleStyle(editedSubCustomization, "outlineColor")}
                        />
                    </VideoCoreMenuSubOption>
                    <VideoCoreMenuSubOption title="Shadow" icon={LuPalette} parentId="Subtitle Styles">
                        <p className="text-[--muted] text-sm mb-2">Shadow Depth</p>
                        <VideoCoreSettingSelect
                            options={SUBTITLE_STYLES_SHADOW_DEPTH_OPTIONS}
                            onValueChange={(v: number) => handleSubtitleCustomizationChange("shadow", v)}
                            value={vc_getSubtitleStyle(editedSubCustomization, "shadow")}
                        />
                        <p className="text-[--muted] text-sm my-2">Shadow Opacity</p>
                        <VideoCoreSettingSelect
                            options={SUBTITLE_STYLES_BACK_COLOR_OPACITY_OPTIONS}
                            onValueChange={(v: number) => handleSubtitleCustomizationChange("backColorOpacity", v)}
                            value={vc_getSubtitleStyle(editedSubCustomization, "backColorOpacity")}
                        />
                        <p className="text-[--muted] text-sm my-2">Shadow Color</p>
                        <VideoCoreSettingSelect
                            options={SUBTITLE_STYLES_COLOR_OPTIONS}
                            onValueChange={(v: string) => handleSubtitleCustomizationChange("backColor", v)}
                            value={vc_getSubtitleStyle(editedSubCustomization, "backColor")}
                        />
                    </VideoCoreMenuSubOption>
                    <VideoCoreMenuSubOption title="Font Size" icon={VscTextSize} parentId="Caption Styles">
                        {/*<p className="text-[--muted] text-sm mb-2">Font size as percentage of video height</p>*/}
                        <VideoCoreSettingSelect
                            options={CAPTION_STYLES_FONT_SIZE_OPTIONS}
                            onValueChange={(v: number) => handleCaptionCustomizationChange("fontSize", v)}
                            value={vc_getCaptionStyle(editedCaptionCustomization, "fontSize")}
                        />
                    </VideoCoreMenuSubOption>
                    {/*<VideoCoreMenuSubOption title="Font Family" icon={LuHeading} parentId="Caption Styles">*/}
                    {/*    /!*<p className="text-[--muted] text-sm mb-2">Font family for captions</p>*!/*/}
                    {/*    <VideoCoreSettingSelect*/}
                    {/*        options={[*/}
                    {/*            { label: "Inter", value: "Inter, Arial, sans-serif" },*/}
                    {/*            { label: "Arial", value: "Arial, sans-serif" },*/}
                    {/*            { label: "Courier", value: "Courier New, monospace" },*/}
                    {/*            { label: "Georgia", value: "Georgia, serif" },*/}
                    {/*            { label: "Times", value: "Times New Roman, serif" },*/}
                    {/*        ]}*/}
                    {/*        onValueChange={(v: string) => handleCaptionCustomizationChange("fontFamily", v)}*/}
                    {/*        value={editedCaptionCustomization.fontFamily ?? "Inter, Arial, sans-serif"}*/}
                    {/*    />*/}
                    {/*</VideoCoreMenuSubOption>*/}
                    <VideoCoreMenuSubOption title="Text Color" icon={LuPalette} parentId="Caption Styles">
                        <VideoCoreSettingSelect
                            options={CAPTION_STYLES_COLOR_OPTIONS}
                            onValueChange={(v: string) => handleCaptionCustomizationChange("textColor", v)}
                            value={vc_getCaptionStyle(editedCaptionCustomization, "textColor")}
                        />
                    </VideoCoreMenuSubOption>
                    <VideoCoreMenuSubOption title="Background" icon={LuPaintbrush} parentId="Caption Styles">
                        <p className="text-[--muted] text-sm my-2">Background Opacity</p>
                        <VideoCoreSettingSelect
                            options={CAPTION_STYLES_BACKGROUND_OPACITY_OPTIONS}
                            onValueChange={(v: number) => handleCaptionCustomizationChange("backgroundOpacity", v)}
                            value={vc_getCaptionStyle(editedCaptionCustomization, "backgroundOpacity")}
                        />
                        <p className="text-[--muted] text-sm mb-2">Background Color</p>
                        <VideoCoreSettingSelect
                            options={CAPTION_STYLES_COLOR_OPTIONS}
                            onValueChange={(v: string) => handleCaptionCustomizationChange("backgroundColor", v)}
                            value={vc_getCaptionStyle(editedCaptionCustomization, "backgroundColor")}
                        />
                    </VideoCoreMenuSubOption>
                    <VideoCoreMenuSubOption title="Shadow" icon={RiShadowLine} parentId="Caption Styles">
                        <p className="text-[--muted] text-sm mb-2">Text shadow</p>
                        <VideoCoreSettingSelect
                            options={CAPTION_STYLES_TEXT_SHADOW_OPTIONS}
                            onValueChange={(v: number) => handleCaptionCustomizationChange("textShadow", v)}
                            value={vc_getCaptionStyle(editedCaptionCustomization, "textShadow")}
                        />
                        <p className="text-[--muted] text-sm my-2">Shadow Color</p>
                        <VideoCoreSettingSelect
                            options={CAPTION_STYLES_COLOR_OPTIONS}
                            onValueChange={(v: string) => handleCaptionCustomizationChange("textShadowColor", v)}
                            value={vc_getCaptionStyle(editedCaptionCustomization, "textShadowColor")}
                        />
                    </VideoCoreMenuSubOption>
                    {isPhone && <VideoCoreMenuSubOption title={t("Base URL", "Basis-URL")} icon={LuLink} parentId="Subtitle Translation">
                        <PhoneTextEditor
                            t={t}
                            label={t("Base URL", "Basis-URL")}
                            help={t("OpenAI-compatible /v1 endpoint, e.g. LM Studio or Ollama.", "OpenAI-kompatibler /v1-Endpunkt, z. B. LM Studio oder Ollama.")}
                            placeholder="http://localhost:1234/v1"
                            value={translateBaseUrl}
                            onApply={v => {
                                patchMediaPlayer([["vcTranslateBaseUrl", v]])
                                setOpenMenuSubSection(null)
                            }}
                            onCancel={() => setOpenMenuSubSection(null)}
                        />
                    </VideoCoreMenuSubOption>}
                    {isPhone && <VideoCoreMenuSubOption title={t("Model", "Modell")} icon={LuCpu} parentId="Subtitle Translation">
                        <PhoneTextEditor
                            t={t}
                            label={t("Model", "Modell")}
                            help={t("Name of the model that translates.", "Name des Modells, das übersetzt.")}
                            placeholder={translateProvider === "openai-compatible" ? "local-model" : "gpt-4o-mini"}
                            value={translateModel}
                            onApply={handleTranslateModelChange}
                            onCancel={() => setOpenMenuSubSection(null)}
                        />
                    </VideoCoreMenuSubOption>}
                    {isPhone && <VideoCoreMenuSubOption title={t("API key", "API-Schlüssel")} icon={LuKey} parentId="Subtitle Translation">
                        <PhoneTextEditor
                            t={t}
                            type="password"
                            label={t("API key", "API-Schlüssel")}
                            help={translateProvider === "openai-compatible"
                                ? t("Optional for local servers. Stored on the server.", "Für lokale Server optional. Wird auf dem Server gespeichert.")
                                : t("Stored on the server.", "Wird auf dem Server gespeichert.")}
                            placeholder={t("Enter your API key", "API-Schlüssel eingeben")}
                            value={translateApiKey}
                            onApply={v => {
                                patchMediaPlayer([["vcTranslateApiKey", v]])
                                setOpenMenuSubSection(null)
                            }}
                            onCancel={() => setOpenMenuSubSection(null)}
                        />
                    </VideoCoreMenuSubOption>}
                </VideoCoreMenuSubSubmenuBody>
            </VideoCoreMenu>
        </>
    )
}

/** Phone language choices; codes match the defaults and the matching used by the subtitle and audio managers. */
const PHONE_LANGUAGES = [
    { en: "Japanese", de: "Japanisch", codes: "jpn,jp,jap,japanese" },
    { en: "German", de: "Deutsch", codes: "de,ger,deu,german" },
    { en: "English", de: "Englisch", codes: "en,eng,english" },
]

/** Translation providers and target languages: the same lists as the preferences modal. */
const TRANSLATE_PROVIDERS = [
    { value: "google", label: "Google Free" },
    { value: "deepl", label: "DeepL" },
    { value: "openai", label: "OpenAI" },
    { value: "openai-compatible", label: "OpenAI Compatible" },
]

const TRANSLATE_LANGUAGES = [
    // DeepL
    { value: "en-US", label: "English (US)" },
    { value: "en-GB", label: "English (UK)" },
    { value: "es", label: "Spanish" },
    { value: "fr", label: "French" },
    { value: "de", label: "German" },
    { value: "it", label: "Italian" },
    { value: "pt-BR", label: "Portuguese (BR)" },
    { value: "pt-PT", label: "Portuguese (PT)" },
    { value: "ru", label: "Russian" },
    { value: "ja", label: "Japanese" },
    { value: "ko", label: "Korean" },
    { value: "zh-hans", label: "Chinese (Simplified)" },
    { value: "zh-hant", label: "Chinese (Traditional)" },
    { value: "ar", label: "Arabic" },
    { value: "tr", label: "Turkish" },
    { value: "pl", label: "Polish" },
    { value: "nl", label: "Dutch" },
    { value: "sv", label: "Swedish" },
    { value: "nb", label: "Norwegian" },
    { value: "da", label: "Danish" },
    { value: "fi", label: "Finnish" },
    { value: "el", label: "Greek" },
    { value: "cs", label: "Czech" },
    { value: "hu", label: "Hungarian" },
    { value: "ro", label: "Romanian" },
    { value: "id", label: "Indonesian" },
    { value: "uk", label: "Ukrainian" },
    { value: "bg", label: "Bulgarian" },
    { value: "sk", label: "Slovak" },
    { value: "sl", label: "Slovenian" },
    { value: "et", label: "Estonian" },
    { value: "lv", label: "Latvian" },
    { value: "lt", label: "Lithuanian" },
    // Not currently supported by DeepL
    { value: "hi", label: "Hindi" },
    { value: "bn", label: "Bengali" },
    { value: "ta", label: "Tamil" },
    { value: "te", label: "Telugu" },
    { value: "mr", label: "Marathi" },
    { value: "kn", label: "Kannada" },
    { value: "ml", label: "Malayalam" },
    { value: "pa", label: "Punjabi" },
    { value: "fa", label: "Persian" },
    { value: "ur", label: "Urdu" },
    { value: "sw", label: "Swahili" },
    { value: "af", label: "Afrikaans" },
    { value: "ms", label: "Malay" },
    { value: "hr", label: "Croatian" },
    { value: "sr", label: "Serbian" },
    { value: "he", label: "Hebrew" },
    { value: "th", label: "Thai" },
    { value: "vi", label: "Vietnamese" },
]

/** The server default "en" is not in the list; show the stored code then. */
function translateLanguageLabel(value: string) {
    return TRANSLATE_LANGUAGES.find(l => l.value === value)?.label ?? value
}

function phoneShort(value: string) {
    return value.length > 20 ? `${value.slice(0, 19)}…` : value
}

function phoneLanguageSummary(settings: VideoCoreSettings, t: Translate) {
    const name = (codes: string) => {
        const match = PHONE_LANGUAGES.find(l => l.codes === codes)
        return match ? t(match.en, match.de) : t("Custom", "Eigene")
    }
    return `${name(settings.preferredSubtitleLanguage)} / ${name(settings.preferredAudioLanguage)}`
}

type PhoneSettingsHomeProps = {
    t: Translate
    open: (section: string) => void
    playbackRate: number
    volumeBoost: number
    autoPlay: boolean
    setAutoPlay: (value: boolean) => void
    autoNext: boolean
    setAutoNext: (value: boolean) => void
    autoSkipOPED: boolean
    setAutoSkipOPED: (value: boolean) => void
    languages: string
    /** null when the stream has no subtitles. */
    subtitleDelay: number | null
    subtitleStyles: string | null
    captionStyles: boolean
    /** null on the native player, which does not use the setting. */
    useLibassRenderer: boolean | null
    setUseLibassRenderer: (value: boolean) => void
    subtitleBlacklist: string
    skipPatterns: string
    /** Target language or Off; null without server settings. */
    translation: string | null
}

/** Short summary of a comma-separated list: how many entries it holds. */
function phoneListSummary(value: string, t: Translate) {
    const count = value.split(",").filter(entry => entry.trim()).length
    return count ? String(count) : t("None", "Keine")
}

/** Android phone: grouped settings, on/off values switch in place, everything else opens its page. */
function PhoneSettingsHome(props: PhoneSettingsHomeProps) {
    const { t, open } = props
    return (
        <div data-vc-phone-settings="home">
            <h2 className="vc-phone-title">{t("Player settings", "Player-Einstellungen")}</h2>
            <div className="vc-phone-groups">
                <PhoneGroup title={t("Playback", "Wiedergabe")}>
                    <PhoneLinkRow icon={MdSpeed} label={t("Speed", "Geschwindigkeit")} value={`${props.playbackRate.toFixed(2)}x`} onClick={() => open("Playback Speed")} />
                    <PhoneSwitchRow icon={IoCaretForwardCircleOutline} label={t("Auto play", "Automatisch abspielen")} checked={props.autoPlay} onChange={props.setAutoPlay} />
                    <PhoneSwitchRow icon={HiFastForward} label={t("Auto next", "Nächste Folge automatisch")} checked={props.autoNext} onChange={props.setAutoNext} />
                    <PhoneSwitchRow icon={TbArrowForwardUp} label={t("Skip OP/ED", "OP/ED überspringen")} checked={props.autoSkipOPED} onChange={props.setAutoSkipOPED} />
                    <PhoneLinkRow icon={TbArrowForwardUp} label={t("Skip patterns", "Skip-Muster")} value={phoneListSummary(props.skipPatterns, t)} onClick={() => open("Skip Patterns")} />
                    <PhoneLinkRow icon={LuVolume2} label={t("Volume boost", "Lautstärke-Boost")} value={formatVolumeBoost(props.volumeBoost)} onClick={() => open("Volume Boost")} />
                </PhoneGroup>
                <PhoneGroup title={t("Language & subtitles", "Sprache & Untertitel")}>
                    <PhoneLinkRow icon={MdOutlineSubtitles} label={t("Languages", "Sprachen")} value={props.languages} onClick={() => open("Default Languages")} />
                    {props.subtitleDelay !== null && <PhoneLinkRow
                        icon={MdOutlineAccessTime}
                        label={t("Delay", "Versatz")}
                        value={`${props.subtitleDelay.toFixed(1)} s`}
                        onClick={() => open("Subtitle Delay")}
                    />}
                    {props.subtitleStyles !== null && <PhoneLinkRow icon={MdOutlineSubtitles} label={t("Style", "Stil")} value={props.subtitleStyles} onClick={() => open("Subtitle Styles")} />}
                    {props.captionStyles && <PhoneLinkRow icon={MdOutlineSubtitles} label={t("Caption style", "Stil der Bildunterschriften")} onClick={() => open("Caption Styles")} />}
                    <PhoneLinkRow
                        icon={MdOutlineSubtitles}
                        label={t("Subtitle blacklist", "Untertitel-Blacklist")}
                        value={phoneListSummary(props.subtitleBlacklist, t)}
                        onClick={() => open("Subtitle Blacklist")}
                    />
                    {props.translation !== null && <PhoneLinkRow
                        icon={MdTranslate}
                        label={t("Translate subtitles", "Untertitel übersetzen")}
                        value={props.translation}
                        onClick={() => open("Subtitle Translation")}
                    />}
                </PhoneGroup>
                <PhoneGroup title={t("Display", "Darstellung")}>
                    <PhoneLinkRow icon={LuTvMinimalPlay} label={t("Player appearance", "Player-Darstellung")} onClick={() => open("Player Appearance")} />
                    {/* Like the preferences modal: applies when the player loads the next stream. */}
                    {props.useLibassRenderer !== null && <PhoneSwitchRow
                        icon={MdOutlineSubtitles}
                        label={t("Subtitle renderer: libass", "Untertitel-Renderer: libass")}
                        checked={props.useLibassRenderer}
                        onChange={props.setUseLibassRenderer}
                    />}
                </PhoneGroup>
            </div>
        </div>
    )
}

function PhoneGroup(props: { title: string, children: React.ReactNode }) {
    const id = React.useId()
    return (
        <section className="vc-phone-group" aria-labelledby={id}>
            <h3 id={id} className="vc-phone-group-title">{props.title}</h3>
            <div className="vc-phone-group-rows">{props.children}</div>
        </section>
    )
}

function PhoneLinkRow(props: { icon: React.ElementType, label: string, value?: string, onClick: () => void }) {
    const Icon = props.icon
    return (
        <button type="button" className="vc-phone-row" data-vc-phone-row="link" onClick={props.onClick}>
            <Icon className="vc-phone-row-icon" aria-hidden />
            <span className="vc-phone-row-label">{props.label}</span>
            {props.value && <span className="vc-phone-row-value">{props.value}</span>}
            <LuChevronRight className="vc-phone-row-chevron" aria-hidden />
        </button>
    )
}

function PhoneSwitchRow(props: { icon: React.ElementType, label: string, checked: boolean, onChange: (value: boolean) => void }) {
    const Icon = props.icon
    return (
        <button
            type="button"
            role="switch"
            aria-checked={props.checked}
            className="vc-phone-row"
            data-vc-phone-row="switch"
            onClick={() => props.onChange(!props.checked)}
        >
            <Icon className="vc-phone-row-icon" aria-hidden />
            <span className="vc-phone-row-label">{props.label}</span>
            <span className="vc-phone-switch" aria-hidden />
        </button>
    )
}

/** Phone text setting page: edits a draft, writes only on Apply. Back and Cancel leave the stored value as it was. */
function PhoneTextEditor(props: {
    t: Translate
    label: string
    help: string
    placeholder: string
    value: string
    type?: "text" | "password"
    validate?: (value: string) => string
    onApply: (value: string) => void
    onCancel: () => void
}) {
    const { t } = props
    const [draft, setDraft] = useState(props.value)
    const error = props.validate?.(draft) || ""
    const id = React.useId()
    const apply = () => {
        if (!error) props.onApply(draft)
    }
    return (
        <div data-vc-phone-settings="editor">
            <p>{props.help}</p>
            <input
                className="vc-phone-input"
                type={props.type ?? "text"}
                autoComplete="off"
                aria-label={props.label}
                aria-invalid={!!error}
                aria-describedby={error ? id : undefined}
                value={draft}
                placeholder={props.placeholder}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                onChange={e => setDraft(e.target.value)}
                // Typing must not reach the player shortcuts.
                onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === "Enter") apply()
                }}
                onInput={e => e.stopPropagation()}
            />
            {!!error && <p id={id} role="alert" className="vc-phone-input-error">{error}</p>}
            <div className="vc-phone-editor-actions">
                <Button intent="gray-subtle" onClick={props.onCancel}>{t("Cancel", "Abbrechen")}</Button>
                <Button intent="primary" disabled={!!error} onClick={apply}>{t("Apply", "Übernehmen")}</Button>
            </div>
        </div>
    )
}
