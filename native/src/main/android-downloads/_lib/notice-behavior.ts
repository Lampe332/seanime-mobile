/** `data.kind` of the download notices (download-notifications.ts). */
export const DOWNLOAD_NOTICE_KIND = "episode-download"

/**
 * How a notification shows while the app is open. expo-notifications has one handler for the whole app (set in index.ts);
 * a second `setNotificationHandler` replaces the first. Download notices go to the list without a banner (the Downloads
 * tab shows the same); every other notification (new episode, the test notification) shows like any other, as the old
 * app's natively posted ones did. Before, the download notices set their own handler on the first notice of a session,
 * which then hid new-episode notifications completely while the app was open.
 */
export function foregroundNoticeBehavior(kind: unknown) {
    if (kind === DOWNLOAD_NOTICE_KIND) return { shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }
}
