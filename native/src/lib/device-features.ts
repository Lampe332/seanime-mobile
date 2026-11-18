// geschrieben nach: docs/IOS-MACHBARKEIT.md §5 (erste iOS-Test-App); keine Vorlage
import { Platform } from "react-native"

/*
 * What the native part of this build can do beyond the shared TypeScript. The loader for downloads (modules/core-download)
 * and the torrent session (modules/core-torrent) exist for Android only so far; the iOS test app hides their entries
 * instead of failing on the first tap.
 */

/** Episode and chapter downloads, the Downloads page */
export const DOWNLOADS_ON_DEVICE = Platform.OS === "android"

/** The app's own torrent client: torrent streaming and torrent downloads (debrid streams do not need it) */
export const TORRENTS_ON_DEVICE = Platform.OS === "android"
