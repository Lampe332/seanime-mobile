import { languageName } from "@/app/(main)/_features/media-core/media-core-texts"
import { useTr } from "@/lib/app-language"
import { MKVParser_TrackInfo } from "@/api/generated/types"
import { nativePlayer_stateAtom } from "@/app/(main)/_features/native-player/native-player.atoms"
import { vc_audioManager } from "@/app/(main)/_features/video-core/video-core"
import { rememberAnimeTrack } from "@/app/(main)/_features/video-core/video-core-anime-tracks"

import { vc_isFullscreen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_miniPlayer } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_videoElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_containerElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { VideoCoreControlButtonIcon } from "@/app/(main)/_features/video-core/video-core-control-bar"
import { HlsAudioTrack, vc_hlsAudioTracks, vc_hlsCurrentAudioTrack } from "@/app/(main)/_features/video-core/video-core-hls"
import { VideoCoreMenu, VideoCoreMenuBody, VideoCoreMenuTitle, VideoCoreSettingSelect } from "@/app/(main)/_features/video-core/video-core-menu"
import { vc_dispatchAction } from "@/app/(main)/_features/video-core/video-core.utils"
import { useVideoCoreOverlayFeedback } from "@/app/(main)/_features/video-core/video-core-overlay-display"
import { useAtomValue } from "jotai"
import { useSetAtom } from "jotai/react"
import React from "react"
import { LuHeadphones } from "react-icons/lu"

export function VideoCoreAudioMenu() {
    const t = useTr()
    const action = useSetAtom(vc_dispatchAction)
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    const state = useAtomValue(nativePlayer_stateAtom)
    const audioManager = useAtomValue(vc_audioManager)
    const videoElement = useAtomValue(vc_videoElement)
    const isFullscreen = useAtomValue(vc_isFullscreen)
    const containerElement = useAtomValue(vc_containerElement)
    const [selectedTrack, setSelectedTrack] = React.useState<number | null>(null)
    const { showOverlayFeedback } = useVideoCoreOverlayFeedback()

    // Get MKV audio tracks
    const mkvAudioTracks = state.playbackInfo?.mkvMetadata?.audioTracks

    // Get HLS audio tracks
    const hlsAudioTracks = useAtomValue(vc_hlsAudioTracks)
    const hlsCurrentAudioTrack = useAtomValue(vc_hlsCurrentAudioTrack)

    // Determine which audio tracks to use
    const audioTracks = mkvAudioTracks || (hlsAudioTracks.length > 0 ? hlsAudioTracks : null)
    const isHls = !mkvAudioTracks && hlsAudioTracks.length > 0

    function onAudioChange() {
        setSelectedTrack(audioManager?.getSelectedTrackNumberOrNull?.() ?? null)
    }

    React.useEffect(() => {
        if (!videoElement || !audioManager) return

        videoElement?.audioTracks?.addEventListener?.("change", onAudioChange)
        return () => {
            videoElement?.audioTracks?.removeEventListener?.("change", onAudioChange)
        }
    }, [videoElement, audioManager])

    React.useEffect(() => {
        onAudioChange()
    }, [audioManager])

    // Update selected track when HLS audio track changes
    React.useEffect(() => {
        if (isHls && hlsCurrentAudioTrack !== -1) {
            setSelectedTrack(hlsCurrentAudioTrack)
        }
    }, [hlsCurrentAudioTrack, isHls])

    if (isMiniPlayer || !audioTracks?.length || audioTracks.length === 1) return null

    const options = audioTracks.map(track => {
        if (isHls) {
            // HLS track format
            const hlsTrack = track as HlsAudioTrack
            return {
                label: hlsTrack.name || languageName(hlsTrack.language, t) || t(`Track ${hlsTrack.id + 1}`, `Spur ${hlsTrack.id + 1}`),
                value: hlsTrack.id,
                moreInfo: otherThan(hlsTrack.name, languageName(hlsTrack.language, t)),
            }
        } else {
            // Event track format
            const eventTrack = track as MKVParser_TrackInfo
            return {
                label: eventTrack.name || languageName(eventTrack.language || eventTrack.languageIETF, t) || t(`Track ${eventTrack.number}`, `Spur ${eventTrack.number}`),
                value: eventTrack.number,
                moreInfo: otherThan(eventTrack.name, languageName(eventTrack.language || eventTrack.languageIETF, t)),
            }
        }
    })

    return (
        <VideoCoreMenu
            name="audio"
            trigger={<VideoCoreControlButtonIcon
                icons={[
                    ["default", LuHeadphones],
                ]}
                state="default"
                onClick={() => {

                }}
            />}
        >
            <VideoCoreMenuTitle>{t("Audio", "Ton")}</VideoCoreMenuTitle>
            <VideoCoreMenuBody>
                <VideoCoreSettingSelect
                    isFullscreen={isFullscreen}
                    containerElement={containerElement}
                    options={options}
                    onValueChange={(value: number) => {
                        const chosen = isHls
                            ? (audioTracks as HlsAudioTrack[]).find(track => track.id === value)
                            : (audioTracks as MKVParser_TrackInfo[]).find(track => track.number === value)
                        rememberAnimeTrack(state.playbackInfo?.media?.id, "audio", chosen?.language)
                        audioManager?.selectTrack(value)
                        action({ type: "seek", payload: { time: -1 } })
                        // Without the audioTracks API there is no change event to update the selection
                        onAudioChange()
                        // Says what is playing now over the picture (the pill fades in, video-core-phone-settings.css)
                        const label = options.find(option => option.value === value)?.label
                        if (label) showOverlayFeedback({ message: `${t("Audio", "Ton")}: ${label}`, duration: 1400 })
                    }}
                    value={selectedTrack || 0}
                />
            </VideoCoreMenuBody>
        </VideoCoreMenu>
    )
}

/** The language as extra info only beside a track name that does not already say it ("Japanese" · "Japanese") */
function otherThan(name: string | undefined, language: string) {
    return name && language && name.toLowerCase() !== language.toLowerCase() ? language : undefined
}
