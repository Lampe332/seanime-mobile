import { languageName } from "@/app/(main)/_features/media-core/media-core-texts"
import { useTr } from "@/lib/app-language"
import { nativePlayer_stateAtom } from "@/app/(main)/_features/native-player/native-player.atoms"
import { vc_subtitleManager } from "@/app/(main)/_features/video-core/video-core"
import { vc_mediaCaptionsManager } from "@/app/(main)/_features/video-core/video-core"
import { rememberAnimeTrack } from "@/app/(main)/_features/video-core/video-core-anime-tracks"
import { vc_menuOpen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_menuSectionOpen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isFullscreen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_miniPlayer } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_videoElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_containerElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { VideoCoreControlButtonIcon } from "@/app/(main)/_features/video-core/video-core-control-bar"
import { MediaCaptionsTrack } from "@/app/(main)/_features/video-core/video-core-media-captions"
import { VideoCoreMenu, VideoCoreMenuBody, VideoCoreMenuTitle, VideoCoreSettingSelect } from "@/app/(main)/_features/video-core/video-core-menu"
import { NormalizedTrackInfo } from "@/app/(main)/_features/video-core/video-core-subtitles"
import { vc_dispatchAction } from "@/app/(main)/_features/video-core/video-core.utils"
import { useVideoCoreOverlayFeedback } from "@/app/(main)/_features/video-core/video-core-overlay-display"
import { IconButton } from "@/components/ui/button"
import { useAtomValue } from "jotai"
import { useSetAtom } from "jotai/react"
import React from "react"
import { LuCaptions, LuPaintbrush } from "react-icons/lu"

export type VideoCoreSubtitleSelection = {
    language?: string
    label?: string
} | null

export function VideoCoreSubtitleMenu({ inline, onPreferenceChange }: {
    inline?: boolean
    onPreferenceChange?: (selection: VideoCoreSubtitleSelection) => void
}) {
    const t = useTr()
    const action = useSetAtom(vc_dispatchAction)
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    const state = useAtomValue(nativePlayer_stateAtom)
    const subtitleManager = useAtomValue(vc_subtitleManager)
    const mediaCaptionsManager = useAtomValue(vc_mediaCaptionsManager)
    const videoElement = useAtomValue(vc_videoElement)
    const isFullscreen = useAtomValue(vc_isFullscreen)
    const containerElement = useAtomValue(vc_containerElement)
    const [selectedTrack, setSelectedTrack] = React.useState<number | null>(null)
    const { showOverlayFeedback } = useVideoCoreOverlayFeedback()

    const setMenuOpen = useSetAtom(vc_menuOpen)
    const setMenuSectionOpen = useSetAtom(vc_menuSectionOpen)

    const [subtitleTracks, setSubtitleTracks] = React.useState<NormalizedTrackInfo[]>([])
    const [mediaCaptionsTracks, setMediaCaptionsTracks] = React.useState<MediaCaptionsTrack[]>([])

    function onTextTrackChange() {
        setSubtitleTracks(p => subtitleManager?.getTracks?.() ?? p)
    }

    function onTrackChange(trackNumber: number | null) {
        setSelectedTrack(trackNumber)
    }

    const firstRender = React.useRef(true)

    React.useEffect(() => {
        if (!videoElement) return

        /**
         * MKV subtitle tracks
         */
        if (subtitleManager) {
            if (firstRender.current) {
                // firstRender.current = false
                onTrackChange(subtitleManager?.getSelectedTrackNumberOrNull?.() ?? null)
            }

            // Listen for subtitle track changes
            subtitleManager.setTrackChangedEventListener(onTrackChange)

            // Listen for when the subtitle tracks are mounted
            subtitleManager.setTracksLoadedEventListener(tracks => {
                setSubtitleTracks(tracks)
            })
        } else if (mediaCaptionsManager) {
            /**
             * Media captions tracks
             */
            if (firstRender.current) {
                // firstRender.current = false
                setSelectedTrack(mediaCaptionsManager.getSelectedTrackIndexOrNull?.() ?? null)
            }

            // Listen for subtitle track changes
            mediaCaptionsManager.setTrackChangedEventListener(onTrackChange)

            mediaCaptionsManager.setTracksLoadedEventListener(tracks => {
                setMediaCaptionsTracks(tracks)
            })
        }
    }, [videoElement, subtitleManager, mediaCaptionsManager])

    React.useEffect(() => {
        onTextTrackChange()
    }, [subtitleManager])

    // Get active manager
    const activeManager = subtitleManager || mediaCaptionsManager
    const activeTracks = subtitleManager ? subtitleTracks : mediaCaptionsTracks

    if (isMiniPlayer || !activeTracks?.length) return null

    return (
        <VideoCoreMenu
            name="subtitle"
            trigger={<VideoCoreControlButtonIcon
                icons={[
                    ["default", LuCaptions],
                ]}
                state="default"
                onClick={() => {

                }}
            />}
        >
            <VideoCoreMenuTitle>{t("Subtitles", "Untertitel")}{" "}
                <IconButton
                    intent="gray-link" size="md"
                    aria-label={t("Subtitle style", "Untertitel-Stil")}
                    onClick={() => {
                        setMenuOpen("settings")
                        React.startTransition(() => {
                            setMenuSectionOpen("Subtitle Styles")
                        })
                    }}
                    icon={<LuPaintbrush />}
                    className="absolute right-2 top-[calc(50%-1rem)]"
                /></VideoCoreMenuTitle>
            <VideoCoreMenuBody>
                <VideoCoreSettingSelect
                    isFullscreen={isFullscreen}
                    containerElement={containerElement}
                    options={[
                        {
                            label: "Off",
                            value: -1,
                        },
                        ...subtitleTracks.map(track => {
                            // MKV subtitle tracks
                            return {
                                label: track.label || languageName(track.language || track.languageIETF, t) || t(`Track ${track.number}`, `Spur ${track.number}`),
                                value: track.number,
                                moreInfo: track.language && track.language !== track.label
                                    ? `${languageName(track.language, t)}${track.codecID ? " · " + getSubtitleTrackType(track.codecID) : ``}`
                                    : undefined,
                            }
                        }),
                        ...mediaCaptionsTracks.map(track => {
                            return {
                                label: track.label,
                                value: track.number,
                                moreInfo: track.language && track.language !== track.label ? track.language?.toUpperCase() : undefined,
                            }
                        }),
                    ]}
                    onValueChange={(value: number) => {
                        // Says which subtitles show now over the picture (the pill fades in, video-core-phone-settings.css)
                        const chosen = value === -1 ? t("Off", "Aus") : activeTracks.find(track => track.number === value)
                        const label = typeof chosen === "string" ? chosen
                            : chosen && (chosen.label || languageName(chosen.language, t) || t(`Track ${chosen.number}`, `Spur ${chosen.number}`))
                        if (label) showOverlayFeedback({ message: `${t("Subtitles", "Untertitel")}: ${label}`, duration: 1400 })
                        if (value === -1) {
                            activeManager?.setNoTrack()
                            setSelectedTrack(null)
                            onPreferenceChange?.(null)
                            rememberAnimeTrack(state.playbackInfo?.media?.id, "subtitle", "none")
                            return
                        }
                        if (subtitleManager) {
                            subtitleManager.selectTrack(value)
                        } else if (mediaCaptionsManager) {
                            mediaCaptionsManager.selectTrack(value)
                            setSelectedTrack(value)
                        }
                        const track = activeTracks.find(track => track.number === value)
                        if (track) {
                            rememberAnimeTrack(state.playbackInfo?.media?.id, "subtitle", track.language)
                            onPreferenceChange?.({
                                language: track.language,
                                label: track.label,
                            })
                        }
                    }}
                    value={selectedTrack ?? -1}
                />
            </VideoCoreMenuBody>
        </VideoCoreMenu>
    )
}

function getSubtitleTrackType(codecID: string) {
    switch (codecID) {
        case "S_TEXT/ASS":
            return "ASS"
        case "S_TEXT/SSA":
            return "SSA"
        case "S_TEXT/UTF8":
            return "TEXT"
        case "S_TEXT/WEBVTT":
        case "D_WEBVTT/SUBTITLES":
            return "VTT"
        case "S_HDMV/PGS":
            return "PGS"
    }
    return "unknown"
}
