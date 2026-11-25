// geschrieben nach: lib/app-backup.ts (die Liste der Geräte-Schlüssel stand dort) und docs/SECURITY-AUDIT.md (Befund „Restore schreibt Geräte-Schlüssel“); kein Server-Quelltext

/*
 * Which keys of the app's own store (lib/storage.ts) a backup may carry. Keys that belong to this device or this
 * install stay out in both directions: a backup does not take them along, and a restore does not write them, whatever
 * the file says. The second half matters for a file that was not made by the app: the updater's state (which APK was
 * checked), the client id and the core's own switches are never set from outside.
 */

/** Keys of the store that belong to this device or this install, not to the user's choices */
const DEVICE_KEYS = [
    /^seanime-core-/,
    /^seanime-client-id/,
    /^seanime-mobile-airing-(announced|next|next-check|scheduled)$/,
    /^seanime-mobile-app-update/,
    /^notified-available-app-update$/,
    /^RELEASES-/,
    /^seanime-mobile-legacy-preferences-copied$/,
    /^seanime-mobile-anilist-user$/,
    /^seanime-mobile-language-android$/,
]

export function isDeviceKey(key: string): boolean {
    return DEVICE_KEYS.some(pattern => pattern.test(key))
}

/**
 * Keys the account's sync keeps on each device although a file backup carries them: the app's language is chosen per
 * device (a tablet set to German must not switch the phone). So are the status bar and preloading (they depend on the
 * screen and the network) and the player for files with the external player link (they depend on the installed apps).
 * The file backup is the user's own step and keeps them.
 */
const SYNC_DEVICE_KEYS = [
    /^seanime-mobile-language$/,
    /^sea-ui-settings-show-status-bar$/,
    /^sea-ui-settings-navigation-preload-mode$/,
    /^sea-playback-downloaded-media$/,
    /^sea-playback-external-player-link$/,
    /^sea-playback-external-player-link-encode-path$/,
]

/** isDeviceKey for the account's sync (account-app.ts): what never goes into a sync package and is never taken from one */
export function isSyncDeviceKey(key: string): boolean {
    return isDeviceKey(key) || SYNC_DEVICE_KEYS.some(pattern => pattern.test(key))
}

/** The preferences without the device's own keys: what a backup takes along and what a restore may write */
export function withoutDeviceKeys(preferences: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(preferences).filter(([key]) => !isDeviceKey(key)))
}
