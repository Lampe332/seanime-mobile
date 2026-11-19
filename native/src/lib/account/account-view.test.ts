// geschrieben nach: lib/account/account-view.ts, lib/account/account-config.ts und Plan „Account + Sync“ (Abschnitte 2, 6.4, 6.6, 7); Werte erfunden

import { describe, expect, it, vi } from "vitest"
import type { ApprovalRequest } from "@/core/account/client"
import { RELEASE_ACCOUNT_API, accountApiBase } from "./account-config"
import { type Translate, translate } from "@/lib/app-language"
import { AccountApiError, MailConfirmationError, RateLimitedError, UnauthorizedError } from "@/core/account/client"
import { UntrustedEscrowError } from "@/core/account/crypto"
import type { ApprovalProgress } from "@/core/account/devices"
import {
    accountDate, accountErrorText, accountPhase, backspaceInCode, codeOf, formatRecoveryCode, formatSas, importFailureText, passwordStrength, repeatMismatch, resendWait,
    startApprovalAttempt, syncedAgo, typeInCode, waitingRequests,
} from "./account-view"

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
    it.each([
        ["en", "11/18/2026", "1/5/2026"],
        ["de", "18.11.2026", "5.1.2026"],
        ["es", "18/11/2026", "5/1/2026"],
        ["ru", "18.11.2026", "05.01.2026"],
        ["zh-Hans", "2026/11/18", "2026/1/5"],
        ["pt-BR", "18/11/2026", "05/01/2026"],
        ["fr", "18/11/2026", "05/01/2026"],
        ["ja", "2026/11/18", "2026/1/5"],
    ])("account date in %s: %s, %s, without Intl", (language, november, january) => {
        const at = (iso: string) => Date.parse(iso) / 1000
        // Hermes on Android gave zh-CN the phone's order; the date must not depend on Intl at all
        vi.stubGlobal("Intl", undefined)
        try {
            expect(accountDate(language, at("2026-11-18T12:00:00.000Z"))).toBe(november)
            expect(accountDate(language, at("2026-01-05T12:00:00.000Z"))).toBe(january)
        }
        finally {
            vi.unstubAllGlobals()
        }
    })
    it("account dates match what CLDR (Intl in Node) writes for each language", () => {
        const day = new Date(2026, 10, 18, 12)
        const tags: Record<string, string> = { "en": "en-US", "de": "de-DE", "es": "es", "ru": "ru-RU", "zh-Hans": "zh-CN", "pt-BR": "pt-BR", "fr": "fr-FR", "ja": "ja-JP" }
        for (const [language, tag] of Object.entries(tags)) {
            const cldr = new Intl.DateTimeFormat(tag, { day: "numeric", month: "numeric", year: "numeric" }).format(day)
            expect(accountDate(language, day.getTime() / 1000), language).toBe(cldr)
        }
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

describe("import result", () => {
    it("only an import that brought the data counts as done", () => {
        expect(importFailureText(en, { state: "updated" })).toBeNull()
        expect(importFailureText(en, { state: "up-to-date" })).toBeNull()
    })
    it.each(["rate-limited", "removed", "signed-out", "rollback-rejected", "key-untrusted", "key-changed", "needs-key"] as const)("%s is a failure with a reason", state => {
        expect(importFailureText(en, { state })).toMatch(/Nothing was imported/)
    })
})

describe("repeated password", () => {
    it("no complaint while the repeat is empty or still a start of the password", () => {
        expect(repeatMismatch("Kettle-Nebula-41", "")).toBe(false)
        expect(repeatMismatch("Kettle-Nebula-41", "Kettle-")).toBe(false)
        expect(repeatMismatch("Kettle-Nebula-41", "Kettle-Nebula-41")).toBe(false)
    })
    it("a typo or a longer repeat is a mismatch", () => {
        expect(repeatMismatch("Kettle-Nebula-41", "Kettle-Nebola")).toBe(true)
        expect(repeatMismatch("Kettle-Nebula-41", "Kettle-Nebula-411")).toBe(true)
    })
})

describe("error texts", () => {
    const wrongLogin = new UnauthorizedError("wrong_credentials", "Wrong email or password", {})
    const sessionGone = new UnauthorizedError("unauthorized", "", {})
    it("a 401 at sign-in is a wrong email or password", () => {
        expect(accountErrorText(en, wrongLogin, "sign-in")).toBe("Wrong email or password.")
        expect(accountErrorText(en, sessionGone, "sign-in")).toBe("Wrong email or password.")
    })
    it("elsewhere a 401 is an ended session, or a wrong password in a step that asked for it", () => {
        expect(accountErrorText(en, sessionGone)).toBe("Your session ended. Sign in again.")
        expect(accountErrorText(en, new AccountApiError(401, "unauthorized", "Sign in first."))).toBe("Your session ended. Sign in again.")
        expect(accountErrorText(en, wrongLogin)).toBe("Wrong password.")
        expect(accountErrorText(en, new AccountApiError(403, "wrong_password", "Wrong password."))).toBe("Wrong password.")
    })
    it("the mailed link mentions Continue only on the sign-in form", () => {
        const mail = new MailConfirmationError("Open the link", {})
        expect(accountErrorText(en, mail, "sign-in")).toMatch(/press Continue\.$/)
        expect(accountErrorText(en, mail)).toMatch(/then try again\.$/)
        expect(accountErrorText(en, mail)).not.toMatch(/Continue/)
    })
})

describe("approval attempt on the new device", () => {
    type Pending = { id: string, ended: boolean }
    const flush = () => new Promise(resolve => setTimeout(resolve, 0))
    function setup(answers: (ApprovalProgress | Error)[]) {
        const pending: Pending = { id: "req-1", ended: false }
        const ended: string[] = []
        const seen: string[] = []
        const errors: unknown[] = []
        let tick: (() => void) | null = null
        const run = startApprovalAttempt<Pending>({
            ask: async () => pending,
            progress: async current => {
                const next = answers.shift() ?? { state: "waiting" }
                if (next instanceof Error) throw next
                if (next.state !== "waiting" && next.state !== "compare") current.ended = true
                return next
            },
            end: async current => void ended.push(current.id),
            wait: (_ms, run) => {
                tick = run
                return () => {
                    tick = null
                }
            },
            onPending: () => undefined,
            onProgress: progress => void seen.push(progress.state),
            onError: error => void errors.push(error),
        })
        return { run, ended, seen, errors, pending, next: async () => {
            tick?.()
            await flush()
        } }
    }

    it("leaving the screen ends the open request on the server, once", async () => {
        const attempt = setup([])
        await flush()
        expect(attempt.seen).toEqual(["waiting"])
        attempt.run.stop()
        attempt.run.stop()
        await flush()
        expect(attempt.ended).toEqual(["req-1"])
        await attempt.next()
        expect(attempt.seen).toEqual(["waiting"])
    })
    it("a request that is still being created ends as soon as it exists", async () => {
        const attempt = setup([])
        attempt.run.stop()
        await flush()
        expect(attempt.ended).toEqual(["req-1"])
        expect(attempt.seen).toEqual([])
    })
    it("a failed check ends the request and reports the error", async () => {
        const attempt = setup([new Error("offline")])
        await flush()
        expect(attempt.errors).toHaveLength(1)
        expect(attempt.ended).toEqual(["req-1"])
    })
    it("an approved, denied or expired request is not ended again", async () => {
        const attempt = setup([{ state: "waiting" }, { state: "approved" }])
        await flush()
        await attempt.next()
        expect(attempt.seen).toEqual(["waiting", "approved"])
        attempt.run.stop()
        await flush()
        expect(attempt.ended).toEqual([])
    })
    it("pause only stops polling (No, different ends the request itself)", async () => {
        const attempt = setup([{ state: "compare", sas: "482913", confirmed: false }])
        await flush()
        attempt.run.pause()
        await attempt.next()
        expect(attempt.seen).toEqual(["compare"])
        expect(attempt.ended).toEqual([])
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

describe("the six boxes of the sign-in code", () => {
    const empty = ["", "", "", "", "", ""]

    it("a digit fills its box and moves on; only digits count", () => {
        expect(typeInCode(empty, 0, "4")).toEqual({ digits: ["4", "", "", "", "", ""], focus: 1 })
        expect(typeInCode(empty, 2, "a")).toEqual({ digits: empty, focus: 2 })
        expect(typeInCode(["4", "", "", "", "", ""], 0, "4x")).toEqual({ digits: ["4", "", "", "", "", ""], focus: 0 })
        // the last box keeps the focus
        expect(typeInCode(["1", "2", "3", "4", "5", ""], 5, "6")).toEqual({ digits: ["1", "2", "3", "4", "5", "6"], focus: 5 })
    })

    it("typing over a filled box keeps the new digit, whichever side the cursor was on", () => {
        expect(typeInCode(["4", "", "", "", "", ""], 0, "47").digits[0]).toBe("7")
        expect(typeInCode(["4", "", "", "", "", ""], 0, "74").digits[0]).toBe("7")
        expect(typeInCode(["4", "", "", "", "", ""], 0, "44")).toEqual({ digits: ["4", "", "", "", "", ""], focus: 1 })
    })

    it("a pasted code spreads over the boxes; a whole one from the first box, wherever it was pasted", () => {
        expect(typeInCode(empty, 3, "012 345")).toEqual({ digits: ["0", "1", "2", "3", "4", "5"], focus: 5 })
        expect(typeInCode(empty, 0, "Your code: 987654.")).toEqual({ digits: ["9", "8", "7", "6", "5", "4"], focus: 5 })
        expect(typeInCode(empty, 2, "12")).toEqual({ digits: ["", "", "1", "2", "", ""], focus: 4 })
        expect(typeInCode(empty, 4, "123")).toEqual({ digits: ["", "", "", "", "1", "2"], focus: 5 })
    })

    it("emptying a box keeps it; Backspace in an empty box clears the one before and moves there", () => {
        const filled = ["1", "2", "3", "", "", ""]
        expect(typeInCode(filled, 2, "")).toEqual({ digits: ["1", "2", "", "", "", ""], focus: 2 })
        expect(backspaceInCode(filled, 3)).toEqual({ digits: ["1", "2", "", "", "", ""], focus: 2 })
        expect(backspaceInCode(filled, 2)).toEqual({ digits: filled, focus: 2 })
        expect(backspaceInCode(empty, 0)).toEqual({ digits: empty, focus: 0 })
    })

    it("the code is whole only with six digits; leading zeros stay", () => {
        expect(codeOf(["0", "0", "1", "2", "3", "4"])).toBe("001234")
        expect(codeOf(["0", "0", "1", "2", "3", ""])).toBeNull()
    })

    it("a new code can be asked for 60 seconds after the last", () => {
        expect(resendWait(null, 5000)).toBe(0)
        expect(resendWait(1000, 1000)).toBe(60)
        expect(resendWait(1000, 60_500)).toBe(1)
        expect(resendWait(1000, 61_000)).toBe(0)
    })

    it("errors of the code steps", () => {
        expect(accountErrorText(en, new UnauthorizedError("invalid_code", "invalid_code", {}), "code")).toBe("That code is wrong or expired.")
        expect(accountErrorText(en, new RateLimitedError("rate_limited", "x", {}, 600), "code")).toBe("Too many codes or tries. Try again in 10 minutes.")
        expect(accountErrorText(en, new RateLimitedError("rate_limited", "x", {}, null), "code")).toBe("Too many codes or tries. Wait a while and try again.")
        expect(accountErrorText(en, new UntrustedEscrowError())).toMatch(/doesn't match your devices/)
        // PUT account/escrow: a wrong password is a 403 there
        expect(accountErrorText(en, new AccountApiError(403, "wrong_password", "x"))).toBe("Wrong password.")
        expect(accountErrorText(en, new AccountApiError(403, "device_required", "x"))).toMatch(/isn't registered/)
    })
})
