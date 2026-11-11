/*
 * Side effect only, imported first by index.ts: jotai's atomWithStorage reads MMKV when its module loads, so the old
 * app's preferences must be in MMKV before any screen or task module is evaluated (legacy-preferences.ts).
 */
import { File, Paths } from "expo-file-system"
import SeanimeServer from "../../modules/seanime-server"
import { copyLegacyPreferences } from "./legacy-preferences"
import { storage } from "./storage"

copyLegacyPreferences(storage, () => SeanimeServer.legacyPreferences())

// The 2.0.33 updater validated the downloaded APK as files/app-update/pending.apk and deleted it only after its own next
// start, which never comes once this app replaced it; the native updater uses other file names there.
try {
    const pending = new File(Paths.document, "app-update", "pending.apk")
    if (pending.exists) pending.delete()
}
catch {
    // nothing to clean up, or the file system is not ready; it only costs space
}
