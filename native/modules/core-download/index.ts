// geschrieben nach: Muster des früheren Server-Moduls (lokales Expo-Modul, bis Stufe 8a-1), docs/EIGENER-KERN.md §4o; kein Server-Quelltext
import { NativeModule, requireNativeModule } from "expo"

/*
 * The device's loader for single files (Kotlin, android/): what the module takes and sends, as it crosses the bridge.
 * The app reads it through src/api/client/core-download.ts, which turns it into the core's contract
 * (src/core/download/loader.ts).
 */

type Raw = Record<string, unknown>

type CoreDownloadEvents = {
    progress: (event: Raw) => void
    done: (event: Raw) => void
    failed: (event: Raw) => void
}

export type CoreDownloadOptions = {
    id: string
    url: string
    headers: Record<string, string>
    path: string
    title: string
    /** 0: from the start */
    resumeFrom: number
    /** "": none */
    ifRange: string
    /** 0: not known */
    expectedBytes: number
    /** JSON list of the parts of a request of several parts, "": one file from url */
    parts: string
    /** With parts: keep what an earlier request of this id finished */
    continueParts: boolean
    /** "": the way of the Android version; "work": WorkManager also on Android 14 and later (self test) */
    way: "" | "work"
}

/** wake: the wait asked for with wakeIn() is over */
declare class SeanimeCoreDownloadModule extends NativeModule<CoreDownloadEvents & { wake: (event: Raw) => void }> {
    /** Whether a file inside the app's own storage is there, asked off the app's thread */
    has(path: string): Promise<boolean>
    /** Shows the notice at the end of an episode on the channel `episode-downloads` (named `channel` when it is new); tapping opens `link` */
    notice(id: string, title: string, text: string, channel: string, link: string): Promise<boolean>
    /** The event `wake` after about so many milliseconds, also when the process rests by then; below 0: not any more */
    wakeIn(ms: number): Promise<boolean>
    enqueue(options: CoreDownloadOptions): Promise<void>
    cancel(id: string): Promise<void>
    status(id: string): Promise<Raw | null>
    forget(id: string): Promise<void>
    /** Phase 6f: an ongoing notice and a wake lock hold the process while the torrent client downloads; false: not started (from the background) */
    keepTorrents(on: boolean, title: string): Promise<boolean>
    /** Lower-case hex of a file inside the app's own storage */
    sha256(path: string): Promise<string>
    /** Removes a file or folder inside the app's own storage with everything in it; false when something stayed */
    removeFolder(path: string): Promise<boolean>
}

export type LegacyPreferences = {
    /** AppLanguage.kt "language": "en" | "de" */
    language?: string
    /** Feedback.kt "feedback_haptics" / "feedback_sounds" */
    feedbackHaptics?: boolean
    feedbackSounds?: boolean
    /** notify/AiringNotifier.kt "enabled" and "announced" (JSON {mediaId: episode}) */
    airingEnabled?: boolean
    airingAnnounced?: string
}

export type FeedbackState = {
    hasVibrator: boolean
    /** AudioManager.RINGER_MODE_*: 0 silent, 1 vibrate, 2 normal */
    ringerMode: number
    musicActive: boolean
}

/** Device facts that came with the server module until stage 8a-1; they never needed the server */
type DeviceFacts = {
    /** Settings Seanime Mobile 2.0.33 kept in SharedPreferences (only the keys that exist), see lib/legacy-preferences.ts. */
    legacyPreferences(): LegacyPreferences
    /** Device facts for touch feedback (lib/feedback.ts): vibration motor, ringer on, other audio playing. */
    feedbackState(): FeedbackState
}

export default requireNativeModule<SeanimeCoreDownloadModule & DeviceFacts>("SeanimeCoreDownload")
