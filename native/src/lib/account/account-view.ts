// geschrieben nach: Plan „Account + Sync“ (Abschnitte 2, 6.4, 6.6, 8: Passwort min. 10 + Stärke-Check) und core/account/sync.ts (SyncResult-Zustände)

import type { AccountEvent, ApprovalRequest } from "@/core/account/client"
import type { SyncResult } from "@/core/account/sync"
import { plural, type Translate } from "@/lib/app-language"
import { format } from "date-fns/format"

/*
 * What the account screens show, without React: which state the account is in, "Synced 2 min ago", how strong a new
 * password is, the approval number in two groups, which approval requests still wait.
 */

export type AccountPhase = "loading" | "signed-out" | "needs-key" | "import" | "ready"

/** The state the screens follow; the last sync's answer decides between "import" and "ready" */
export function accountPhase(input: { loaded: boolean, signedIn: boolean, hasKey: boolean, lastResult: Pick<SyncResult, "state"> | null }): AccountPhase {
    if (!input.loaded) return "loading"
    if (!input.signedIn || input.lastResult?.state === "signed-out" || input.lastResult?.state === "removed") return "signed-out"
    if (!input.hasKey || input.lastResult?.state === "needs-key") return "needs-key"
    if (input.lastResult?.state === "import-available") return "import"
    return "ready"
}

/** "Synced 2 min ago" */
export function syncedAgo(t: Translate, lastSyncAt: number | null, now: number): string {
    if (lastSyncAt === null) return t("Not synced yet", "Noch nicht synchronisiert")
    const minutes = Math.max(0, Math.floor((now - lastSyncAt) / 60_000))
    if (minutes < 1) return t("Synced just now", "Gerade synchronisiert")
    if (minutes < 60) return plural(t, minutes, ["Synced 1 min ago", "Synced {0} min ago"], ["Vor 1 Min. synchronisiert", "Vor {0} Min. synchronisiert"])
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return plural(t, hours, ["Synced 1 h ago", "Synced {0} h ago"], ["Vor 1 Std. synchronisiert", "Vor {0} Std. synchronisiert"])
    const days = Math.floor(hours / 24)
    return plural(t, days, ["Synced 1 day ago", "Synced {0} days ago"], ["Vor 1 Tag synchronisiert", "Vor {0} Tagen synchronisiert"])
}

/**
 * The short date of each app language, as CLDR writes it (what Intl gives in Node). Fixed patterns, not Intl: Hermes on
 * Android formatted zh-CN in the phone's own order ("18.11.2026" on a German phone, where ja gave "2026/11/18").
 * A Map, not an object: scripts/i18n-extract.mjs reads an object with `en` and `de` as a text to translate.
 */
const ACCOUNT_DATE_PATTERNS = new Map([
    ["en", "M/d/yyyy"],
    ["de", "d.M.yyyy"],
    ["es", "d/M/yyyy"],
    ["ru", "dd.MM.yyyy"],
    ["zh-Hans", "yyyy/M/d"],
    ["pt-BR", "dd/MM/yyyy"],
    ["fr", "dd/MM/yyyy"],
    ["ja", "yyyy/M/d"],
])

/** A day of the account screens (a device's last visit, a security event): "11/18/2026", "18.11.2026", "2026/11/18" */
export function accountDate(language: string, seconds: number): string {
    return format(new Date(seconds * 1000), ACCOUNT_DATE_PATTERNS.get(language) ?? "M/d/yyyy")
}

export const MIN_PASSWORD_LENGTH = 10

const COMMON = ["password", "passwort", "123456", "qwertz", "qwerty", "letmein", "iloveyou", "seanime", "anime", "admin", "welcome", "abc123", "111111"]

/**
 * 0 (too short or easy to guess) to 4 (strong). A rough local estimate: length, kinds of characters, and penalties for
 * common words, the email's name, runs and repeats. Nothing leaves the device.
 */
export function passwordStrength(password: string, email = ""): 0 | 1 | 2 | 3 | 4 {
    if (password.length < MIN_PASSWORD_LENGTH) return 0
    const lower = password.toLowerCase()
    const name = email.split("@")[0]?.toLowerCase() ?? ""
    if (COMMON.some(word => lower.includes(word)) || (name.length >= 3 && lower.includes(name))) return 1
    const unique = new Set(password).size
    if (unique <= 3) return 0
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(kind => kind.test(password)).length
    let score = password.length >= 16 ? 3 : password.length >= 12 ? 2 : 1
    if (kinds >= 3) score++
    if (/(.)\1\1/.test(password) || /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(password)) score--
    if (unique < password.length / 2) score--
    return Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4
}

export function strengthLabel(t: Translate, score: 0 | 1 | 2 | 3 | 4): string {
    return [
        t(`At least ${MIN_PASSWORD_LENGTH} characters`, `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen`),
        t("Easy to guess", "Leicht zu erraten"),
        t("Okay", "Geht so"),
        t("Good", "Gut"),
        t("Strong", "Stark"),
    ][score]
}

/** "482913" as "482 913" */
export function formatSas(sas: string): string {
    return sas.length === 6 ? `${sas.slice(0, 3)} ${sas.slice(3)}` : sas
}

/** The recovery code in groups of four, easier to copy by hand */
export function formatRecoveryCode(code: string): string {
    return (code.toUpperCase().replace(/[\s-]/g, "").match(/.{1,4}/g) ?? []).join(" ")
}

/** Requests an old device can still answer, oldest first */
export function waitingRequests(requests: ApprovalRequest[], now: number): ApprovalRequest[] {
    return requests
        .filter(request => (request.status === "pending" || request.status === "nonce" || request.status === "revealed") && request.expiresAt > now)
        .sort((a, b) => a.createdAt - b.createdAt)
}

/** I5: one line per security event of the account (the kinds of account-server/src/mail.ts SecurityMail) */
export function eventText(t: Translate, event: AccountEvent): string {
    const name = event.deviceName ?? t("A device", "Ein Gerät")
    switch (event.kind) {
        case "new_device": return t(`${name} was added`, `${name} wurde hinzugefügt`)
        case "device_removed": return t(`${name} was removed`, `${name} wurde entfernt`)
        case "device_signed_out": return t(`${name} signed out`, `${name} hat sich abgemeldet`)
        case "key_rotated": return t("The encryption key was changed", "Der Schlüssel wurde gewechselt")
        case "recovery_changed": return t("A new recovery code was saved", "Ein neuer Wiederherstellungscode wurde gespeichert")
        case "password_changed": return t("The password was changed", "Das Passwort wurde geändert")
        case "google_linked": return t("Google sign-in was added", "Google-Anmeldung wurde hinzugefügt")
        case "google_unlinked": return t("Google sign-in was removed", "Google-Anmeldung wurde entfernt")
        case "start_fresh": return t("The account started fresh", "Das Konto hat neu angefangen")
        case "approvals_paused": return t("Approvals were paused after numbers didn't match", "Freigaben wurden pausiert, weil Zahlen nicht passten")
        default: return event.kind
    }
}

/** A short, readable reason for a failed account step */
export function accountErrorText(t: Translate, error: unknown): string {
    const status = (error as { status?: number } | null)?.status
    const code = (error as { code?: string } | null)?.code
    const message = error instanceof Error ? error.message : ""
    if (code === "device_removed") return t("This device was removed from the account. Ask on another device to add it again.", "Dieses Gerät wurde aus dem Konto entfernt. Lass es auf einem anderen Gerät neu hinzufügen.")
    if (code === "confirm_by_mail") return t("Someone tried a lot of wrong passwords for this email lately. If yours was right, a sign-in link is in your inbox now. Open it, then press Continue.",
        "Für diese E-Mail wurden zuletzt viele falsche Passwörter probiert. Wenn deins stimmt, liegt jetzt ein Anmelde-Link in deinem Postfach. Öffne ihn und tippe dann auf Weiter.")
    if (code === "owner_required") return t("Sign in with your password, use your recovery code or approve this device on another one.", "Melde dich mit deinem Passwort an, nutze deinen Wiederherstellungscode oder gib dieses Gerät auf einem anderen frei.")
    if (code === "approvals_paused") return t("The numbers didn't match three times, so approving devices is paused for an hour. Your password and recovery code still work.",
        "Die Zahlen passten dreimal nicht, deshalb sind Freigaben eine Stunde pausiert. Passwort und Wiederherstellungscode gehen weiter.")
    if (code === "device_set_mismatch") return t("The device list changed in the meantime. Open it again and pick.", "Die Geräteliste hat sich inzwischen geändert. Öffne sie neu und wähle aus.")
    if ((error as { name?: string } | null)?.name === "UntrustedDevicesError") return t("Only a device that one of yours added, and that is still signed in, can keep the key.", "Nur ein Gerät, das eines deiner Geräte hinzugefügt hat und noch angemeldet ist, kann den Schlüssel behalten.")
    if (status === 401 && /password/i.test(message)) return t("Wrong email or password.", "Falsche E-Mail oder falsches Passwort.")
    if (status === 401) return t("Wrong email or password.", "Falsche E-Mail oder falsches Passwort.")
    if (status === 429) return t("Too many tries. Wait a moment and try again.", "Zu viele Versuche. Warte kurz und versuch es noch mal.")
    if (status === 409 && /exist|taken|already/i.test(message)) return t("There is already an account with this email. Sign in instead.", "Mit dieser E-Mail gibt es schon ein Konto. Melde dich an.")
    if (status === undefined && /network|fetch|failed to/i.test(message)) return t("No connection to the account server.", "Keine Verbindung zum Konto-Server.")
    return message || t("Something went wrong.", "Etwas ist schiefgelaufen.")
}
