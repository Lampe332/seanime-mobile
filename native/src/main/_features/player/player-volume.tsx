import { useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import Volume from "lucide-react-native/icons/volume"
import Volume1 from "lucide-react-native/icons/volume-1"
import Volume2 from "lucide-react-native/icons/volume-2"
import VolumeOff from "lucide-react-native/icons/volume-off"
import React from "react"
import { type GestureResponderEvent, Pressable, View } from "react-native"
import Animated, { Easing, FadeOut, Keyframe } from "react-native-reanimated"

/*
 * The player's own volume and mute (web media-core-control-bar `MediaCoreVolumeButton` + vc_storedVolume/Muted): the
 * speaker in the top bar opens a pill under it with a mute button and a slider. It is mpv's volume, not the phone's
 * media volume (the right-side swipe stays on that one, as in 2.0.32). Kept with the player preferences
 * (vc_storedVolumeAtom / vc_storedMutedAtom), the volume boost multiplies it.
 */

/** the panel closes after this long without a touch (VOLUME_PANEL_IDLE_MS) */
export const VOLUME_PANEL_IDLE_MS = 3500

/** The slider is linear in loudness: position² = volume (linearToVolume); the first 4 % snap to silence. */
export function volumeFromSlider(position: number) {
    const p = Math.max(0, Math.min(1, position))
    return p < 0.04 ? 0 : p * p
}

export function sliderFromVolume(volume: number, muted: boolean) {
    return muted ? 0 : Math.sqrt(Math.max(0, Math.min(1, volume)))
}

/** mpv's volume (0–100, boosted up to 300 = MPV_OPEN_OPTIONS volume-max) for the stored level and boost */
export function mpvVolume(volume: number, boost = 1) {
    return Math.round(Math.max(0, Math.min(1, volume)) * Math.max(1, Math.min(3, boost)) * 100)
}

function VolumeIcon({ volume, muted, size }: { volume: number, muted: boolean, size: number }) {
    const Icon = muted || volume === 0 ? VolumeOff : volume >= 0.5 ? Volume2 : volume > 0.1 ? Volume1 : Volume
    return <Icon size={size} color="#fff" />
}

/** The speaker in the top bar; its icon follows the level like the web's four states */
export function VolumeButton({ volume, muted, open, iconSize, size = 44, onToggle }: { volume: number, muted: boolean, open: boolean, iconSize: number, size?: number, onToggle: () => void }) {
    const t = useTr()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t("Volume", "Lautstärke")} accessibilityState={{ expanded: open }}
            onPress={onToggle} hitSlop={4}
            className="items-center justify-center rounded-full active:bg-white/15"
            style={({ pressed }) => ({ width: size, height: size, transform: [{ scale: pressed ? 0.92 : 1 }] })}>
            <VolumeIcon volume={volume} muted={muted} size={iconSize} />
        </Pressable>
    )
}

// Glides out of the speaker above its right end (PHONE_VOLUME_PANEL: translate(1.5rem, -6px) scale(.96) → none, 220 ms)
const panelIn = new Keyframe({
    0: { opacity: 0, transform: [{ translateX: 24 }, { translateY: -6 }, { scale: 0.96 }] },
    100: { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }], easing: Easing.bezier(0.23, 1, 0.32, 1) },
}).duration(220)

/**
 * The pill under the speaker: mute button + slider (.vc-volume-panel, 13rem, at most 62 % of the player's width). It is
 * drawn by the player root at the bar's right end, since Android only hands touches to views inside their parent.
 */
export function VolumePanel({ top, right, width, volume, muted, onVolume, onMuted, onClose }: {
    top: number
    right: number
    width: number
    volume: number
    muted: boolean
    onVolume: (volume: number) => void
    onMuted: (muted: boolean) => void
    onClose: () => void
}) {
    const t = useTr()
    const idle = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const keepOpen = React.useCallback(() => {
        if (idle.current) clearTimeout(idle.current)
        idle.current = setTimeout(onClose, VOLUME_PANEL_IDLE_MS)
    }, [onClose])
    React.useEffect(() => {
        keepOpen()
        return () => {
            if (idle.current) clearTimeout(idle.current)
        }
    }, [keepOpen])

    const track = React.useRef(1)
    const setFrom = (event: GestureResponderEvent) => {
        onVolume(volumeFromSlider(event.nativeEvent.locationX / track.current))
        if (muted) onMuted(false)
        keepOpen()
    }
    const level = sliderFromVolume(volume, muted)
    return (
        <Animated.View entering={panelIn} exiting={FadeOut.duration(120)}
            style={{ position: "absolute", top, right, width: Math.min(208, width * 0.62), height: 44, transformOrigin: "100% 0%" }}
            className="flex-row items-center gap-3 rounded-full border border-white/10 bg-[rgba(18,18,20,0.86)] pl-2 pr-4">
            <Pressable accessibilityRole="button" accessibilityLabel={muted ? t("Unmute", "Ton an") : t("Mute", "Stumm")}
                onPress={() => {
                    // unmuting a silent player brings it back at 10 % (onMuteToggle)
                    if (muted && volume === 0) onVolume(0.1)
                    onMuted(!muted)
                    keepOpen()
                }}
                className="h-11 w-11 items-center justify-center">
                <VolumeIcon volume={volume} muted={muted} size={20} />
            </Pressable>
            <View accessibilityRole="adjustable" accessibilityLabel={t("Volume", "Lautstärke")}
                accessibilityValue={{ min: 0, max: 100, now: Math.round(level * 100) }}
                onLayout={event => { track.current = Math.max(1, event.nativeEvent.layout.width) }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={setFrom}
                onResponderMove={setFrom}
                className="h-full flex-1 justify-center">
                <View pointerEvents="none" className="h-1 rounded-full bg-white/25" />
                <View pointerEvents="none" className="absolute left-0 h-1 rounded-full" style={{ width: `${level * 100}%`, backgroundColor: colors.smAccent }} />
                <View pointerEvents="none" className="absolute h-3.5 w-3.5 rounded-full"
                    style={{ left: `${level * 100}%`, marginLeft: -7, backgroundColor: colors.smAccent, boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }} />
            </View>
        </Animated.View>
    )
}
