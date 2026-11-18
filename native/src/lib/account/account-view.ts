// geschrieben nach: Plan „Account + Sync“ (Abschnitte 2, 6.4, 6.6, 8: Passwort min. 10 + Stärke-Check) und core/account/sync.ts (SyncResult-Zustände)

import type { ApprovalRequest } from "@/core/account/client"
import type { SyncResult } from "@/core/account/sync"
import type { Translate } from "@/lib/app-language"

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
    if (minutes < 60) return t(`Synced ${minutes} min ago`, `Vor ${minutes} Min. synchronisiert`)
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t(`Synced ${hours} h ago`, `Vor ${hours} Std. synchronisiert`)
    const days = Math.floor(hours / 24)
    return t(`Synced ${days} ${days === 1 ? "day" : "days"} ago`, `Vor ${days} ${days === 1 ? "Tag" : "Tagen"} synchronisiert`)
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

/** A short, readable reason for a failed account step */
export function accountErrorText(t: Translate, error: unknown): string {
    const status = (error as { status?: number } | null)?.status
    const code = (error as { code?: string } | null)?.code
    const message = error instanceof Error ? error.message : ""
    if (code === "device_removed") return t("This device was removed from the account. Ask on another device to add it again.", "Dieses Gerät wurde aus dem Konto entfernt. Lass es auf einem anderen Gerät neu hinzufügen.")
    if (code === "rotation_pending" || code === "rotation_not_allowed") return t("A removed device is waiting for its key change. Finish it on a device that was signed in before the removal.", "Ein entferntes Gerät wartet auf den Schlüsselwechsel. Schließ ihn auf einem Gerät ab, das schon vor dem Entfernen angemeldet war.")
    if ((error as { name?: string } | null)?.name === "RemovedDeviceListedError") return t("A device you removed is in the account again, so the key was not changed. Someone may be trying to get in: change your password.", "Ein entferntes Gerät ist wieder im Konto, deshalb wurde der Schlüssel nicht gewechselt. Vielleicht versucht jemand reinzukommen: Ändere dein Passwort.")
    if (status === 401 && /password/i.test(message)) return t("Wrong email or password.", "Falsche E-Mail oder falsches Passwort.")
    if (status === 401) return t("Wrong email or password.", "Falsche E-Mail oder falsches Passwort.")
    if (status === 429) return t("Too many tries. Wait a moment and try again.", "Zu viele Versuche. Warte kurz und versuch es noch mal.")
    if (status === 409 && /exist|taken|already/i.test(message)) return t("There is already an account with this email. Sign in instead.", "Mit dieser E-Mail gibt es schon ein Konto. Melde dich an.")
    if (status === undefined && /network|fetch|failed to/i.test(message)) return t("No connection to the account server.", "Keine Verbindung zum Konto-Server.")
    return message || t("Something went wrong.", "Etwas ist schiefgelaufen.")
}
