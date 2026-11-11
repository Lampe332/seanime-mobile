import { describe, expect, it } from "vitest"
import { checkDownload, DIGEST_MISMATCH, hasReleaseDigest, INSTALL_TIMEOUT_MS, MISSING_DIGEST, interruptedDownload, publicState, reconcile, UpdateTransaction } from "./updater-state"

const now = 1_800_000_000_000
const installing: UpdateTransaction = { status: "installing", version: "3.0.1", fromCode: 31128, installStarted: now - 1000, sha256: "ab" }

describe("update transaction", () => {
    it("is installed only once the package shows a higher versionCode with the release's version", () => {
        expect(reconcile(installing, 31128, "3.0.0", now).status).toBe("installing")
        expect(reconcile(installing, 31129, "3.0.0", now).status).toBe("installing")
        const done = reconcile(installing, 31129, "3.0.1", now)
        expect(done).toEqual({ status: "installed", version: "3.0.1", successUnread: true })
    })
    it("never confirms without a recorded start", () => {
        expect(reconcile({ status: "complete", version: "3.0.1", sha256: "ab" }, 31200, "3.0.1", now).status).toBe("complete")
    })
    it("an installer that never came back fails after 30 minutes", () => {
        const late = { ...installing, installStarted: now - INSTALL_TIMEOUT_MS - 1 }
        expect(reconcile(late, 31128, "3.0.0", now).status).toBe("failed")
        expect(reconcile(installing, 31128, "3.0.0", now).status).toBe("installing")
    })
    it("shows installed until acknowledged, then idle", () => {
        expect(publicState({ status: "installed", version: "3.0.1", successUnread: true }, "3.0.1").status).toBe("installed")
        expect(publicState({ status: "installed", version: "3.0.1", successUnread: false }, "3.0.1").status).toBe("idle")
    })
    it("keeps distinct states instead of treating a download as installed", () => {
        for (const status of ["downloading", "verifying", "complete", "installing", "failed"] as const) {
            expect(publicState({ status, version: "3.0.1" }, "3.0.0").status).toBe(status)
        }
        expect(publicState({ status: "complete", version: "3.0.1", sha256: "ab" }, "3.0.0").verified).toBe(true)
    })
    it("forgets a download that is not newer than the app", () => {
        expect(publicState({ status: "complete", version: "3.0.0" }, "3.0.0").status).toBe("idle")
    })
})

describe("downloaded APK", () => {
    const AB = "ab".repeat(32)
    const CD = "cd".repeat(32)
    it("must have the expected size and digest", () => {
        expect(checkDownload(100, AB, 100, `sha256:${AB.toUpperCase()}`)).toBeNull()
        expect(checkDownload(100, AB, 0, `sha256:${AB}`)).toBeNull()
        expect(checkDownload(99, AB, 100, `sha256:${AB}`)).toMatch("Incomplete")
        expect(checkDownload(0, AB, 0, `sha256:${AB}`)).toMatch("Incomplete")
        expect(checkDownload(100, CD, 100, `sha256:${AB}`)).toBe(DIGEST_MISMATCH)
    })
    it("is never installed without GitHub's digest (r18)", () => {
        expect(checkDownload(100, AB, 100, "")).toBe(MISSING_DIGEST)
        expect(checkDownload(100, AB, 100, "sha256:")).toBe(MISSING_DIGEST)
        expect(checkDownload(100, AB, 100, `md5:${AB}`)).toBe(MISSING_DIGEST)
        expect(hasReleaseDigest(`sha256:${AB}`)).toBe(true)
        expect(hasReleaseDigest(undefined)).toBe(false)
        // the digest GitHub delivered for v2.0.33 on 10.11.2026 (public API, assets[].digest)
        expect(hasReleaseDigest("sha256:4cf87d99e5e69f303f456cae3c47cc54f183d948946ee3245071eb8f8c2e55f8")).toBe(true)
    })
})

describe("interrupted download", () => {
    it("turns a download the app was ended in into a retryable error", () => {
        const running: UpdateTransaction = { status: "downloading", version: "3.0.1", fileName: "Seanime-Mobile-3.0.1.apk", bytes: 5, total: 100 }
        expect(interruptedDownload(running)).toMatchObject({ status: "error", version: "3.0.1", error: "Download interrupted. Try again." })
        expect(interruptedDownload({ ...running, status: "verifying" }).status).toBe("error")
        expect(publicState(interruptedDownload(running), "3.0.0").status).toBe("error")
    })
    it("leaves every other state alone", () => {
        for (const status of ["idle", "complete", "installing", "failed", "installed", "error"] as const) {
            const tx: UpdateTransaction = { status, version: "3.0.1" }
            expect(interruptedDownload(tx)).toBe(tx)
        }
    })
})
