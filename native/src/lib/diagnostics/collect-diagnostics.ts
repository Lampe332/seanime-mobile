import { coreAnilistSyncState } from "@/api/client/core-switch"
import { getToasts, subscribeToasts } from "@/components/ui/toast/toast-store"
import { getAppLanguage } from "@/lib/app-language"
import { APP_VARIANT, APP_VARIANT_NAME } from "@/lib/app-variant"
import { keepConsoleLines, keepLogLine, logLineOf, recentLogLines } from "@/lib/helpers/debug"
import NetInfo from "@react-native-community/netinfo"
import * as Application from "expo-application"
import { Platform } from "react-native"
import { diagnosticReport, recentErrors } from "./diagnostic-report"

/*
 * The phone's side of the diagnostic report (diagnostic-report.ts): the log lines are kept from the start of the app
 * (startDiagnostics, app/_layout.tsx), the facts are read when the user asks for the report.
 */

/** How many of the kept lines go into a report */
const REPORT_LINES = 150
const REPORT_ERRORS = 10

let started = false

/** Keeps the console lines and the error and warning toasts the user saw; once, at the start of the app */
export function startDiagnostics(): void {
    if (started) return
    started = true
    keepConsoleLines()
    const seen = new Set<string | number>()
    subscribeToasts(() => {
        for (const item of getToasts()) {
            if (seen.has(item.id) || (item.type !== "error" && item.type !== "warning")) continue
            seen.add(item.id)
            if (seen.size > 100) seen.delete(seen.values().next().value!)
            keepLogLine(logLineOf("log", [`toast ${item.type}: ${item.title}`], item.createdAt))
        }
    })
}

function androidFacts(): { android: string, device: string } {
    const constants = Platform.constants as unknown as Record<string, unknown>
    const text = (value: unknown) => (typeof value === "string" ? value : "")
    const release = text(constants.Release)
    const device = [text(constants.Manufacturer), text(constants.Model)].filter(Boolean).join(" ")
    return { android: `${release || "?"} (API ${Platform.Version})`, device: device || Platform.OS }
}

/**
 * The locale the app's process runs in. On Android 13 and newer it follows the per-app language the app hands to
 * Android (android-app-language.ts), so it is not necessarily the phone's own language.
 */
function processLocale(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().locale
    }
    catch {
        return "?"
    }
}

/** What is not normal now: AniList's queue and sign-in, the network, the last errors */
async function problemsNow(lines: string[]): Promise<string[]> {
    const problems: string[] = []
    const sync = await coreAnilistSyncState().catch(() => null)
    if (sync?.signInExpired) problems.push("AniList sign-in expired")
    if (sync && !sync.reachable) problems.push("AniList cannot be reached")
    if (sync?.waiting) problems.push(`AniList: ${sync.waiting} ${sync.waiting === 1 ? "change" : "changes"} waiting`)
    const net = await NetInfo.fetch().catch(() => null)
    if (net?.isConnected === false) problems.push("Offline")
    return [...problems, ...recentErrors(lines, REPORT_ERRORS).map(line => `Recent: ${line}`)]
}

/** The report, filtered; `privateWords`: the AniList name and anything else that names the user */
export async function makeDiagnosticReport(privateWords: (string | null | undefined)[]): Promise<string> {
    const lines = recentLogLines()
    const version = Application.nativeApplicationVersion ?? "?"
    const build = Application.nativeBuildVersion ?? "?"
    return diagnosticReport({
        app: `${APP_VARIANT.name} ${version} (${build})`,
        variant: APP_VARIANT_NAME,
        ...androidFacts(),
        language: `app ${getAppLanguage()}, locale ${processLocale()}`,
        problems: await problemsNow(lines),
        logLines: lines.slice(-REPORT_LINES),
        made: Date.now(),
    }, privateWords)
}
