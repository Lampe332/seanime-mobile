import { atomWithStorage, readStoredJSON } from "@/lib/storage"
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio"
import * as Haptics from "expo-haptics"
import { Platform } from "react-native"
import SeanimeServer from "../../modules/seanime-server"
import { hapticType, type HapticKind, soundAllowed } from "./feedback-policy"

/*
 * Touch feedback (Feedback.kt), kept for moments that deserve it: a switch, a long press, a jump, an error, and one quiet
 * sound for success moments. expo-haptics' performAndroidHapticsAsync goes through the window like the old app did,
 * follows Android's touch-feedback setting and needs no vibrate permission. Both have a switch in Settings → App →
 * Feedback (E2 2.12); the sound stays off while the phone is silent or anything plays audio (a video, music).
 */
export type { HapticKind } from "./feedback-policy"

const HAPTICS_KEY = "seanime-mobile-feedback-haptics"
const SOUNDS_KEY = "seanime-mobile-feedback-sounds"
const VOLUME = 0.45

export const hapticsEnabledAtom = atomWithStorage<boolean>(HAPTICS_KEY, true)
export const soundsEnabledAtom = atomWithStorage<boolean>(SOUNDS_KEY, true)

/** "tick", "long", "confirm" or "reject"; nothing when turned off in the settings or in Android's touch feedback. */
export function haptic(kind: HapticKind) {
    if (Platform.OS !== "android") return
    const type = hapticType(kind, Number(Platform.Version))
    if (!type || !readStoredJSON(HAPTICS_KEY, true)) return
    void Haptics.performAndroidHapticsAsync(type as Haptics.AndroidHaptics).catch(() => undefined)
}

/** The Pixel Tablet has no vibration motor: its settings hide the Vibration switch. */
export function hasVibrator(): boolean {
    if (Platform.OS !== "android") return false
    try {
        return SeanimeServer.feedbackState().hasVibrator
    }
    catch {
        return false
    }
}

let player: AudioPlayer | null = null

/** "success" is the only sound; it is short and quiet. */
export function playSound(name: "success") {
    if (name !== "success" || Platform.OS !== "android") return
    let allowed = false
    try {
        const state = SeanimeServer.feedbackState()
        allowed = soundAllowed(readStoredJSON(SOUNDS_KEY, true), state.ringerMode, state.musicActive)
    }
    catch {
        allowed = false
    }
    if (!allowed) return
    try {
        if (!player) {
            // a sonification next to whatever else runs, never taking audio focus from it
            void setAudioModeAsync({ interruptionMode: "mixWithOthers", shouldPlayInBackground: false })
            player = createAudioPlayer(require("../../assets/sounds/feedback_success.wav"))
            player.volume = VOLUME
        }
        void player.seekTo(0).then(() => player?.play())
    }
    catch {
        player = null
    }
}

/** A finished action the user waited for (download queued, episode marked as watched): a confirming tick and the quiet success sound. */
export function successFeedback() {
    haptic("confirm")
    playSound("success")
}
