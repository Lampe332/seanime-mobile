// geschrieben nach: Plan „Account + Sync“ (Abschnitte 2, 6.4, 6.6, 8: Passwort min. 10 + Stärke-Check) und core/account/sync.ts (SyncResult-Zustände)

import type { AccountEvent, ApprovalRequest } from "@/core/account/client"
import type { ApprovalProgress } from "@/core/account/devices"
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
        case "code_only_on": return t("Code-only sign-in was turned on", "Nur-Code-Anmeldung wurde eingeschaltet")
        case "code_only_off": return t("Code-only sign-in was turned off", "Nur-Code-Anmeldung wurde ausgeschaltet")
        case "web_edit_on": return t("Edit on the website was turned on", "Auf der Website bearbeiten wurde eingeschaltet")
        case "web_edit_off": return t("Edit on the website was turned off", "Auf der Website bearbeiten wurde ausgeschaltet")
        case "web_unlocked": return t("Your synced data was unlocked on the website", "Deine synchronisierten Daten wurden auf der Website entsperrt")
        case "web_settings_changed": return t("Settings were changed on the website", "Einstellungen wurden auf der Website geändert")
        case "password_reset": return t("The password was reset", "Das Passwort wurde zurückgesetzt")
        case "email_verified": return t("The email address was confirmed", "Die E-Mail-Adresse wurde bestätigt")
        case "sessions_signed_out": return event.deviceName !== null
            ? t(`${event.deviceName} was signed out`, `${event.deviceName} wurde abgemeldet`)
            : t("Other sessions were signed out", "Andere Sitzungen wurden abgemeldet")
        case "signed_in": return signInText(t, event)
        default: return event.kind
    }
}

/** A sign-in in the timeline: how, and which device when the app signed in with the key it already had */
function signInText(t: Translate, event: AccountEvent): string {
    const name = event.deviceName
    switch (event.method) {
        case "password": return name !== null
            ? t(`${name} signed in with the password`, `${name} hat sich mit dem Passwort angemeldet`)
            : t("Signed in with the password", "Mit dem Passwort angemeldet")
        case "code": return name !== null
            ? t(`${name} signed in with a code`, `${name} hat sich mit einem Code angemeldet`)
            : t("Signed in with a code", "Mit einem Code angemeldet")
        case "google": return name !== null
            ? t(`${name} signed in with Google`, `${name} hat sich mit Google angemeldet`)
            : t("Signed in with Google", "Mit Google angemeldet")
        default: return name !== null ? t(`${name} signed in`, `${name} hat sich angemeldet`) : t("Signed in", "Angemeldet")
    }
}

/**
 * What an import that came back without throwing means: null when the account's data is on this device now (the app then
 * starts again), otherwise why nothing was imported. importFromAccount reports these states instead of throwing.
 */
export function importFailureText(t: Translate, result: Pick<SyncResult, "state">): string | null {
    switch (result.state) {
        case "updated":
        case "up-to-date": return null
        case "rate-limited": return t("Too many syncs right now. Nothing was imported. Wait a moment and try again.", "Gerade zu viele Syncs. Nichts wurde importiert. Warte kurz und versuch es noch mal.")
        case "signed-out": return t("Your session ended. Nothing was imported. Sign in again.", "Deine Sitzung ist abgelaufen. Nichts wurde importiert. Melde dich neu an.")
        case "removed": return t("This device was removed from the account. Nothing was imported.", "Dieses Gerät wurde aus dem Konto entfernt. Nichts wurde importiert.")
        case "rollback-rejected": return t("The server sent older data than this device knows. Nothing was imported.", "Der Server schickte ältere Daten, als dieses Gerät kennt. Nichts wurde importiert.")
        case "needs-key":
        case "key-changed":
        case "key-untrusted": return t("This device can't open the account's data with its key. Nothing was imported.", "Dieses Gerät kann die Daten des Kontos mit seinem Schlüssel nicht öffnen. Nichts wurde importiert.")
        default: return t("Nothing was imported. Try again.", "Nichts wurde importiert. Versuch es noch mal.")
    }
}

/* ---- The sign-in code: six boxes, one digit each ---- */

export const CODE_LENGTH = 6
/** How long "Send a new code" waits after a code was sent */
export const CODE_RESEND_SECONDS = 60

export type CodeEdit = { digits: string[], focus: number }

const codeBoxes = (digits: readonly string[]) => Array.from({ length: CODE_LENGTH }, (_, i) => digits[i] ?? "")

/**
 * A box's text changed: only digits count. A box that held a digit and got a second one keeps the new one and moves on;
 * more digits (a pasted or keyboard-filled code) spread over the next boxes, a whole code over all six from the first.
 * An emptied box stays focused (Backspace on an empty box is backspaceInCode).
 */
export function typeInCode(digits: readonly string[], index: number, text: string): CodeEdit {
    const next = codeBoxes(digits)
    if (text === "") {
        next[index] = ""
        return { digits: next, focus: index }
    }
    const previous = next[index]
    let typed = text.replace(/\D/g, "")
    // a letter or a sign: nothing changes
    if (typed === "" || (previous !== "" && typed === previous)) return { digits: next, focus: index }
    if (previous !== "" && typed.length === 2 && typed.includes(previous)) typed = typed.startsWith(previous) ? typed.slice(1) : typed.slice(0, 1)
    const start = typed.length >= CODE_LENGTH ? 0 : index
    const placed = typed.slice(0, CODE_LENGTH - start)
    for (let i = 0; i < placed.length; i++) next[start + i] = placed[i]!
    return { digits: next, focus: Math.min(start + placed.length, CODE_LENGTH - 1) }
}

/** Backspace in an empty box clears the box before it and moves there (a box with a digit is emptied by typeInCode) */
export function backspaceInCode(digits: readonly string[], index: number): CodeEdit {
    const next = codeBoxes(digits)
    if (next[index] !== "" || index === 0) return { digits: next, focus: index }
    next[index - 1] = ""
    return { digits: next, focus: index - 1 }
}

/** The whole code once all six boxes hold a digit, else null */
export function codeOf(digits: readonly string[]): string | null {
    const code = codeBoxes(digits).join("")
    return /^\d{6}$/.test(code) ? code : null
}

/** Seconds until "Send a new code" works again (0: now) */
export function resendWait(sentAt: number | null, now: number): number {
    if (sentAt === null) return 0
    return Math.max(0, Math.ceil((sentAt + CODE_RESEND_SECONDS * 1000 - now) / 1000))
}

/** The new password and its repeat differ (not while the repeat is still a start of the password) */
export function repeatMismatch(password: string, repeat: string): boolean {
    return repeat !== "" && !password.startsWith(repeat)
}

const APPROVAL_POLL_MS = 2000

/**
 * One "Approve on your phone" request on the new device: asks, then polls every 2 s until it is approved, denied or
 * expired. `stop()` (leaving the screen, "Ask again") also ends the request on the server, so no request stays open
 * behind the screen: the server allows 3 open ones, and the other device would keep asking about each. A failure ends it
 * too. `pause()` only stops polling ("No, different" ends the request itself).
 */
export function startApprovalAttempt<P extends { ended: boolean }>(deps: {
    ask: () => Promise<P>
    progress: (pending: P) => Promise<ApprovalProgress>
    /** Ends the request on the server (best effort) */
    end: (pending: P) => Promise<unknown>
    wait: (ms: number, run: () => void) => () => void
    onPending: (pending: P) => void
    onProgress: (progress: ApprovalProgress) => void
    onError: (error: unknown) => void
}): { pause: () => void, stop: () => void } {
    let alive = true
    let pending: P | null = null
    let ended = false
    let cancelTimer = () => undefined as void
    const pause = () => {
        alive = false
        cancelTimer()
    }
    const end = () => {
        if (!pending || pending.ended || ended) return
        ended = true
        void deps.end(pending).catch(() => undefined)
    }
    const poll = async (current: P) => {
        let progress: ApprovalProgress
        try {
            progress = await deps.progress(current)
        }
        catch (error) {
            if (!alive) return
            pause()
            end()
            return deps.onError(error)
        }
        // an approval that arrived while the screen closed still counts: the key is on this device already
        if (!alive && progress.state !== "approved") return
        deps.onProgress(progress)
        if (progress.state === "approved" || progress.state === "denied" || progress.state === "expired") return pause()
        cancelTimer = deps.wait(APPROVAL_POLL_MS, () => void poll(current))
    }
    deps.ask().then(created => {
        pending = created
        if (!alive) return end()
        deps.onPending(created)
        void poll(created)
    }, error => {
        if (!alive) return
        alive = false
        deps.onError(error)
    })
    return {
        pause,
        stop: () => {
            pause()
            end()
        },
    }
}

/**
 * A short, readable reason for a failed account step. `where: "sign-in"`: the sign-in form, the only place where a 401
 * means a wrong email or password and where a Continue button follows the mailed link; elsewhere a 401 is a session that
 * ended (or, in a step that asks for the password again, a wrong password). `where: "code"`: the sign-in code steps, where
 * a 429 says how long to wait.
 */
export function accountErrorText(t: Translate, error: unknown, where?: "sign-in" | "code"): string {
    const status = (error as { status?: number } | null)?.status
    const code = (error as { code?: string } | null)?.code
    const message = error instanceof Error ? error.message : ""
    const signIn = where === "sign-in"
    if (code === "invalid_code") return t("That code is wrong or expired.", "Der Code ist falsch oder abgelaufen.")
    if (status === 429 && where === "code") {
        const retryAfter = (error as { retryAfter?: number | null } | null)?.retryAfter
        if (typeof retryAfter === "number" && retryAfter > 0) {
            const minutes = Math.ceil(retryAfter / 60)
            return plural(t, minutes, ["Too many codes or tries. Try again in 1 minute.", "Too many codes or tries. Try again in {0} minutes."],
                ["Zu viele Codes oder Versuche. Versuch es in 1 Minute noch mal.", "Zu viele Codes oder Versuche. Versuch es in {0} Minuten noch mal."])
        }
        return t("Too many codes or tries. Wait a while and try again.", "Zu viele Codes oder Versuche. Warte eine Weile und versuch es noch mal.")
    }
    if ((error as { name?: string } | null)?.name === "UntrustedEscrowError") return t("The server sent a key that doesn't match your devices, so this device didn't take it. Sign in with your password or approve this device on another one.",
        "Der Server hat einen Schlüssel geschickt, der nicht zu deinen Geräten passt, deshalb hat dieses Gerät ihn nicht genommen. Melde dich mit deinem Passwort an oder gib dieses Gerät auf einem anderen frei.")
    if (code === "device_required") return t("This device isn't registered in the account yet. Sync once, then try again.", "Dieses Gerät ist noch nicht im Konto eingetragen. Synchronisiere einmal und versuch es dann noch mal.")
    // a step that wants a sign-in within the last 10 minutes (Google accounts have no password to ask for instead)
    if (code === "reauth_required") return t("For your safety this needs a fresh sign-in. Sign out, sign in again, then try once more.",
        "Zu deiner Sicherheit braucht das eine frische Anmeldung. Melde dich ab und wieder an, dann versuch es noch mal.")
    if (code === "no_key") return t("Your account has no key yet. Sync once, then try again.", "Dein Konto hat noch keinen Schlüssel. Synchronisiere einmal und versuch es dann noch mal.")
    if (code === "device_removed") return t("This device was removed from the account. Ask on another device to add it again.", "Dieses Gerät wurde aus dem Konto entfernt. Lass es auf einem anderen Gerät neu hinzufügen.")
    if (code === "confirm_by_mail") return signIn
        ? t("Someone tried a lot of wrong passwords for this email lately. If yours was right, a sign-in link is in your inbox now. Open it, then press Continue.",
            "Für diese E-Mail wurden zuletzt viele falsche Passwörter probiert. Wenn deins stimmt, liegt jetzt ein Anmelde-Link in deinem Postfach. Öffne ihn und tippe dann auf Weiter.")
        : t("Someone tried a lot of wrong passwords for this email lately. If yours was right, a sign-in link is in your inbox now. Open it, then try again.",
            "Für diese E-Mail wurden zuletzt viele falsche Passwörter probiert. Wenn deins stimmt, liegt jetzt ein Anmelde-Link in deinem Postfach. Öffne ihn und versuch es dann noch mal.")
    if (code === "start_fresh_wait") {
        const retryAfter = (error as { body?: { retryAfter?: unknown } } | null)?.body?.retryAfter
        if (typeof retryAfter === "number" && retryAfter > 0) {
            const hours = Math.ceil(retryAfter / 3600)
            return plural(t, hours,
                ["Start fresh waits 24 hours after a sign-in with a code or a password reset, to protect your data. Try again in 1 hour.",
                    "Start fresh waits 24 hours after a sign-in with a code or a password reset, to protect your data. Try again in {0} hours."],
                ["Neu anfangen geht zum Schutz deiner Daten erst 24 Stunden nach einer Anmeldung mit Code oder dem Zurücksetzen des Passworts. Versuch es in 1 Stunde noch mal.",
                    "Neu anfangen geht zum Schutz deiner Daten erst 24 Stunden nach einer Anmeldung mit Code oder dem Zurücksetzen des Passworts. Versuch es in {0} Stunden noch mal."])
        }
        return t("Start fresh waits 24 hours after a sign-in with a code or a password reset, to protect your data. Try again later.",
            "Neu anfangen geht zum Schutz deiner Daten erst 24 Stunden nach einer Anmeldung mit Code oder dem Zurücksetzen des Passworts. Versuch es später noch mal.")
    }
    if (code === "owner_required") return t("Sign in with your password, use your recovery code or approve this device on another one.", "Melde dich mit deinem Passwort an, nutze deinen Wiederherstellungscode oder gib dieses Gerät auf einem anderen frei.")
    if (code === "approvals_paused") return t("The numbers didn't match three times, so approving devices is paused for an hour. Your password and recovery code still work.",
        "Die Zahlen passten dreimal nicht, deshalb sind Freigaben eine Stunde pausiert. Passwort und Wiederherstellungscode gehen weiter.")
    if (code === "device_set_mismatch") return t("The device list changed in the meantime. Open it again and pick.", "Die Geräteliste hat sich inzwischen geändert. Öffne sie neu und wähle aus.")
    if ((error as { name?: string } | null)?.name === "UntrustedDevicesError") return t("Only a device that one of yours added, and that is still signed in, can keep the key.", "Nur ein Gerät, das eines deiner Geräte hinzugefügt hat und noch angemeldet ist, kann den Schlüssel behalten.")
    if (status === 401 && signIn) return t("Wrong email or password.", "Falsche E-Mail oder falsches Passwort.")
    if ((status === 401 && code === "wrong_credentials") || code === "wrong_password") return t("Wrong password.", "Falsches Passwort.")
    if (status === 401) return t("Your session ended. Sign in again.", "Deine Sitzung ist abgelaufen. Melde dich neu an.")
    if (status === 429) return t("Too many tries. Wait a moment and try again.", "Zu viele Versuche. Warte kurz und versuch es noch mal.")
    if (status === 409 && /exist|taken|already/i.test(message)) return t("There is already an account with this email. Sign in instead.", "Mit dieser E-Mail gibt es schon ein Konto. Melde dich an.")
    if (status === undefined && /network|fetch|failed to/i.test(message)) return t("No connection to the account server.", "Keine Verbindung zum Konto-Server.")
    return message || t("Something went wrong.", "Etwas ist schiefgelaufen.")
}
