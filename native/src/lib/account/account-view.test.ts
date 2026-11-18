// geschrieben nach: lib/account/account-view.ts, lib/account/account-config.ts und Plan „Account + Sync“ (Abschnitte 2, 6.4, 6.6, 7); Werte erfunden

import { describe, expect, it } from "vitest"
import type { ApprovalRequest } from "@/core/account/client"
import { RELEASE_ACCOUNT_API, accountApiBase } from "./account-config"
import { type Translate, translate } from "@/lib/app-language"
import { accountDate, accountPhase, formatRecoveryCode, formatSas, passwordStrength, syncedAgo, waitingRequests } from "./account-view"

const en = (english: string) => english

describe("account states", () => {
    const base = { loaded: true, signedIn: true, hasKey: true, lastResult: null }
    it("not signed in", () => {
        expect(accountPhase({ ...base, signedIn: false, hasKey: false })).toBe("signed-out")
        expect(accountPhase({ ...base, loaded: false })).toBe("loading")
    })
    it("signed in and synced", () => {
        expect(accountPhase(base)).toBe("ready")
        expect(accountPhase({ ...base, lastResult: { state: "uploaded" } })).toBe("ready")
    })
    it("import available after signing in to an account with data", () => {
        expect(accountPhase({ ...base, lastResult: { state: "import-available" } })).toBe("import")
    })
    it("approval open: signed in without the key", () => {
        expect(accountPhase({ ...base, hasKey: false })).toBe("needs-key")
        expect(accountPhase({ ...base, lastResult: { state: "needs-key" } })).toBe("needs-key")
    })
    it("a session the server ended counts as signed out", () => {
        expect(accountPhase({ ...base, lastResult: { state: "signed-out" } })).toBe("signed-out")
    })
})

describe("approval requests", () => {
    const request = (id: string, status: ApprovalRequest["status"], createdAt: number, expiresAt = 10_000): ApprovalRequest => ({
        id, deviceName: "Galaxy Tab", devicePub: "", commitment: "", approverNonce: null, approverPub: null, reveal: null, status, createdAt, expiresAt,
    })
    it("keeps the ones still waiting, oldest first", () => {
        const list = [request("b", "nonce", 20), request("a", "pending", 10), request("c", "approved", 5), request("d", "denied", 6), request("e", "pending", 7, 500)]
        expect(waitingRequests(list, 1000).map(item => item.id)).toEqual(["a", "b"])
    })
    it("shows the number in two groups", () => {
        expect(formatSas("482913")).toBe("482 913")
    })
})

describe("texts", () => {
    const now = Date.parse("2026-11-18T10:00:00.000Z")
    it("Synced … ago", () => {
        expect(syncedAgo(en, null, now)).toBe("Not synced yet")
        expect(syncedAgo(en, now - 20_000, now)).toBe("Synced just now")
        expect(syncedAgo(en, now - 2 * 60_000, now)).toBe("Synced 2 min ago")
        expect(syncedAgo(en, now - 3 * 3_600_000, now)).toBe("Synced 3 h ago")
        expect(syncedAgo(en, now - 26 * 3_600_000, now)).toBe("Synced 1 day ago")
        expect(syncedAgo(en, now - 50 * 3_600_000, now)).toBe("Synced 2 days ago")
    })
    it("Synced … ago in German and from a catalog with plural forms", () => {
        const de = (_english: string, german: string) => german
        expect(syncedAgo(de, now - 60_000, now)).toBe("Vor 1 Min. synchronisiert")
        expect(syncedAgo(de, now - 50 * 3_600_000, now)).toBe("Vor 2 Tagen synchronisiert")
        const ru: Translate = (english, german) => translate("ru", english, german)
        expect(syncedAgo(ru, now - 22 * 86_400_000, now)).toBe("Синхронизировано 22 дня назад")
        expect(syncedAgo(ru, now - 25 * 86_400_000, now)).toBe("Синхронизировано 25 дней назад")
    })
    it("account dates follow the app language", () => {
        const seconds = Date.parse("2026-01-05T12:00:00.000Z") / 1000
        expect(accountDate("en", seconds)).toBe("1/5/2026")
        expect(accountDate("de", seconds)).toBe("5.1.2026")
        expect(accountDate("fr", seconds)).toBe("05/01/2026")
    })
    it("recovery code in groups of four", () => {
        expect(formatRecoveryCode("abcdefghijklmnopqrstuvwxyz")).toBe("ABCD EFGH IJKL MNOP QRST UVWX YZ")
    })
})

describe("password strength", () => {
    it("needs at least 10 characters", () => {
        expect(passwordStrength("Ab1!xyz")).toBe(0)
    })
    it("common words and the email's name are easy to guess", () => {
        expect(passwordStrength("password1234")).toBe(1)
        expect(passwordStrength("mariamaria77x", "maria@example.com")).toBe(1)
    })
    it("long, varied passwords are strong", () => {
        expect(passwordStrength("Kettle-Nebula-41-Orbit")).toBe(4)
        expect(passwordStrength("aaaaaaaaaaaa")).toBe(0)
    })
})

describe("account server address", () => {
    it("the release always uses the real server", () => {
        expect(accountApiBase("release", "http://127.0.0.1:8787")).toBe(RELEASE_ACCOUNT_API)
        expect(RELEASE_ACCOUNT_API).toBe("https://api.seanimemobile.com")
    })
    it("test builds may use this device over plain http, other hosts only over https", () => {
        expect(accountApiBase("test", "http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787")
        expect(accountApiBase("scratch", "https://staging.example.com/")).toBe("https://staging.example.com")
        expect(accountApiBase("test", "http://192.168.1.20:8787")).toBe(RELEASE_ACCOUNT_API)
        expect(accountApiBase("test", undefined)).toBe(RELEASE_ACCOUNT_API)
    })
})
