// geschrieben nach: lib/app-backup-keys.ts; Werte erfunden, keine Anfrage verlässt den Test

import { describe, expect, it } from "vitest"
import { isDeviceKey, isSyncDeviceKey, withoutDeviceKeys } from "./app-backup-keys"

describe("the keys a backup may carry", () => {
    it("keeps the user's choices", () => {
        const choices = {
            "seanime-mobile-language": "\"de\"",
            "marketplace-url": "\"https://example.org/marketplace.json\"",
            "sea-video-core-keybindings": "{}",
        }
        expect(withoutDeviceKeys(choices)).toEqual(choices)
    })

    it("leaves out what belongs to the device or the install: updater state, client id, the core's switches", () => {
        const fromFile = {
            "seanime-mobile-language": "\"en\"",
            "seanime-mobile-app-update": JSON.stringify({ status: "complete", version: "9.9.9", fileName: "Seanime-Mobile-9.9.9.apk", sha256: "0".repeat(64) }),
            "seanime-mobile-app-update-known": "\"9.9.9\"",
            "seanime-client-id": "\"someone-else\"",
            "seanime-client-id-proof": "\"proof\"",
            "seanime-core-write-account": "1234567",
            "RELEASES-get-latest-update": "{}",
            "notified-available-app-update": "\"9.9.9\"",
            "seanime-mobile-airing-next-check": "0",
            "seanime-mobile-legacy-preferences-copied": "true",
            "seanime-mobile-anilist-user": "\"someone\"",
        }
        expect(withoutDeviceKeys(fromFile)).toEqual({ "seanime-mobile-language": "\"en\"" })
    })

    it("the app's language travels in the file backup, never in the account's sync", () => {
        expect(isDeviceKey("seanime-mobile-language")).toBe(false)
        expect(isSyncDeviceKey("seanime-mobile-language")).toBe(true)
        expect(isSyncDeviceKey("seanime-client-id")).toBe(true)
        expect(isSyncDeviceKey("marketplace-url")).toBe(false)
    })

    it("screen, network and installed-app settings travel in the file backup, never in the account's sync", () => {
        const keys = ["sea-ui-settings-show-status-bar", "sea-ui-settings-navigation-preload-mode", "sea-playback-downloaded-media",
            "sea-playback-external-player-link", "sea-playback-external-player-link-encode-path"]
        for (const key of keys) {
            expect(isSyncDeviceKey(key)).toBe(true)
            expect(isDeviceKey(key)).toBe(false)
        }
        expect(isSyncDeviceKey("sea-playback-torrentstream")).toBe(false)
        expect(isSyncDeviceKey("sea-player-seek-forward-seconds")).toBe(false)
    })

    it("matches whole names only where the list says so", () => {
        expect(isDeviceKey("seanime-mobile-airing-next")).toBe(true)
        expect(isDeviceKey("seanime-mobile-airing-notifications")).toBe(false)
        expect(isDeviceKey("my-notified-available-app-update")).toBe(false)
    })
})
