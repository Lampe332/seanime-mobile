/*
 * The diagnostic report for a bug report (settings → Logs & cache, "Copy diagnostic report" / "Share"): what the app
 * is, the phone, the problems the app sees now and its last log lines. Everything in it goes through privateSafe
 * first: no sign-in, token, key or password, no email address, no link beyond its host, no user name in a file path,
 * no IP address of a home network, no AniList name. English only, it is read by whoever helps. No React Native here,
 * so the filter is proven in Node (diagnostic-report.test.ts); collect-diagnostics.ts gathers the facts on the phone.
 */

export type DiagnosticFacts = {
    /** "Seanime Mobile 4.3.0 (40300)" */
    app: string
    /** app-variants.json: test, release, scratch */
    variant: string
    /** "14 (API 34)" */
    android: string
    /** "Google Pixel 7" */
    device: string
    /** "app en, locale de-DE" */
    language: string
    /** What is not normal now: AniList, the network, recent errors */
    problems: string[]
    logLines: string[]
    /** When the report was made */
    made: number
}

/** A link keeps its scheme and host; its path, query, fragment and any user:password@ go */
function linkHost(link: string): string {
    const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#\s]*)(.*)$/i.exec(link)
    if (!match) return "[link]"
    const host = match[2].split("@").pop() ?? ""
    return `${match[1]}${host}${match[3] ? "/…" : ""}`
}

function escaped(word: string): string {
    return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The text without private data. `privateWords` are names to hide wherever they show (the AniList name); words
 * shorter than 3 letters are left, they would hide parts of ordinary words.
 */
export function privateSafe(text: string, privateWords: (string | null | undefined)[] = []): string {
    let safe = text
        // links (http, intent, vlc, file, content …): only scheme and host
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, linkHost)
        .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [hidden]")
        // JSON Web Tokens (AniList's token is one)
        .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[hidden]")
        // key=value and "key": "value" of secrets
        .replace(/\b(access_token|refresh_token|token|password|passcode|passwd|secret|api[_-]?key|apikey|authorization|cookie|session|auth)(["']?\s*[:=]\s*["']?)(?!\[hidden\])([^\s"'&,;}]+)/gi, "$1$2[hidden]")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi, "[email]")
        // the user's name in a path of a PC (a Nakama host's files): C:\Users\name, /home/name, /Users/name
        .replace(/([A-Za-z]:[\\/]+Users[\\/]+|\/(?:home|Users)\/)[^\\/\s"']+/g, "$1[user]")
        // addresses in a home network or outside; the phone's own 127.0.0.1 tells nothing
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ip => (ip === "127.0.0.1" ? ip : "[ip]"))
        // long runs of letters and digits: keys, hashes, tokens of other kinds
        .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, run => (/\d/.test(run) && /[A-Za-z]/.test(run) ? "[hidden]" : run))
    for (const word of privateWords) {
        const name = word?.trim()
        if (!name || name.length < 3) continue
        safe = safe.replace(new RegExp(escaped(name), "gi"), "[name]")
    }
    return safe
}

/** The report as plain text, every line filtered */
export function diagnosticReport(facts: DiagnosticFacts, privateWords: (string | null | undefined)[] = []): string {
    const lines = [
        "Seanime Mobile diagnostic report",
        `Made: ${new Date(facts.made).toISOString().slice(0, 16).replace("T", " ")} UTC`,
        `App: ${facts.app} (${facts.variant})`,
        `Android: ${facts.android}`,
        `Device: ${facts.device}`,
        `Language: ${facts.language}`,
        "",
        "Problems now:",
        ...(facts.problems.length ? facts.problems.map(problem => `- ${problem}`) : ["- none seen"]),
        "",
        `Last ${facts.logLines.length} log lines:`,
        ...facts.logLines,
    ]
    return lines.map(line => privateSafe(line, privateWords)).join("\n")
}

/** The errors and warnings among the kept log lines, newest last */
export function recentErrors(logLines: string[], count: number): string[] {
    return logLines.filter(line => /^\S+ (error|warn) |\] (error|warning|warn) |toast (error|warning):/.test(line)).slice(-count)
}
