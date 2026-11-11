import { describe, expect, it } from "vitest"
import { autoOpensFor, changelogLines, downloadPercent, installReady, isCriticalUpdate, updateHint, updateNoticeOpens, updateStatusText } from "./update-notice"

const t = (en: string) => en
const check = { fetching: false, loading: false, error: false, hasData: true, starting: false }

describe("updateNoticeOpens", () => {
    it("opens by itself only while the app looks for new versions; a manual check always", () => {
        expect(updateNoticeOpens("automatic", false, true)).toBe(true)
        expect(updateNoticeOpens("automatic", true, true)).toBe(false)
        expect(updateNoticeOpens("manual", true, true)).toBe(true)
        expect(updateNoticeOpens("manual", false, false)).toBe(false)
    })
    // merged from native-e2b's settings-phone.test (settings audit 4d1e48a): a missing setting means on, no release never opens
    it("treats a missing setting as on and never opens without a release", () => {
        expect(updateNoticeOpens("automatic", undefined, true)).toBe(true)
        expect(updateNoticeOpens("automatic", false, false)).toBe(false)
    })
    it("opens once per version", () => {
        expect(autoOpensFor("3.0.1", false, null)).toBe(true)
        expect(autoOpensFor("3.0.1", false, JSON.stringify("3.0.1"))).toBe(false)
        expect(autoOpensFor("3.0.2", false, JSON.stringify("3.0.1"))).toBe(true)
        expect(autoOpensFor("3.0.2", true, null)).toBe(false)
        expect(autoOpensFor(undefined, false, null)).toBe(false)
    })
})

describe("status", () => {
    it("shows the download percent", () => {
        expect(downloadPercent({ status: "downloading", bytes: 50, total: 200 })).toBe(25)
        expect(downloadPercent({ status: "downloading" })).toBeUndefined()
        expect(updateStatusText({ status: "downloading", bytes: 1, total: 4 }, check, t)).toBe("Downloading 25%")
    })
    it("puts the install states before the check", () => {
        expect(updateStatusText({ status: "complete" }, { ...check, fetching: true }, t)).toBe("APK verified. Ready to install.")
        expect(updateStatusText({ status: "idle" }, { ...check, version: "3.0.1" }, t)).toBe("New version available")
        expect(updateStatusText({ status: "idle" }, { ...check, error: true }, t)).toContain("Could not check")
        expect(updateStatusText({ status: "idle" }, check, t)).toBe("Up to date")
        expect(updateStatusText({ status: "idle" }, { ...check, hasData: false }, t)).toBe("Update check unavailable")
    })
    it("offers install for a verified file", () => {
        expect(installReady({ status: "complete" })).toBe(true)
        expect(installReady({ status: "failed", verified: true })).toBe(true)
        expect(installReady({ status: "failed" })).toBe(false)
        expect(updateHint({ status: "permission" }, t)).toContain("Allow Seanime Mobile")
        expect(updateHint({ status: "idle" }, t)).toBeUndefined()
    })
})

describe("changelogLines", () => {
    it("takes the bullet lines before the footer", () => {
        const body = "## What's new?\n\n- 🎉 Downloads: Queue\n  - Pause\n- 🚑️ Player: crash\n---\n- footer"
        const lines = changelogLines(body)
        expect(lines).toEqual(["- 🎉 Downloads: Queue", "  - Pause", "- 🚑️ Player: crash"])
        expect(isCriticalUpdate(lines)).toBe(true)
        expect(changelogLines(undefined)).toEqual([])
    })
})
