import { describe, expect, it } from "vitest"
import { keepLogLine, logLineOf, recentLogLines } from "@/lib/helpers/debug"
import { diagnosticReport, privateSafe, recentErrors } from "./diagnostic-report"

/* Everything private below is made up. */

const JWT = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxMzk4NSIsInN1YiI6IjEyMzQ1NiJ9.c2lnbmF0dXJlLXBhcnQtb2YtdGhlLXRva2Vu"
const SECRETS = [
    JWT,
    "s3cr3t-pa55",
    "dbk_9f8e7d6c5b4a39281706f5e4d3c2b1a0",
    "abc123token",
    "nakama-passcode-42",
    "made.up@example.org",
    "MadeUpName",
    "192.168.178.24",
    "/private/path",
    "q=frieren",
    "sessionid=77",
    "nick",
]

const LOG = [
    `[ANILIST] error login failed Authorization: Bearer ${JWT}`,
    `[EXTERNAL PLAYER LINK] info Sending URL to external player intent://192.168.178.24:43211/stream/abc?token=abc123token#Intent;package=org.videolan.vlc;end`,
    `[Core] warn debrid: {"apiKey":"dbk_9f8e7d6c5b4a39281706f5e4d3c2b1a0","status":401}`,
    `settings saved password=s3cr3t-pa55 passcode: nakama-passcode-42`,
    `[ACCOUNT] info signed in as made.up@example.org`,
    `[Core] info AniList viewer MadeUpName, list of MadeUpName loaded`,
    `[NAKAMA] info host file C:\\Users\\nick\\Videos\\Anime\\ep1.mkv and /home/nick/anime/ep2.mkv`,
    `[SEARCH] info https://user:pw@anilist.co/private/path?q=frieren&sessionid=77`,
    `[Core] info changes for AniList: 1 sent, 0 dropped, 0 waiting`,
]

describe("privateSafe", () => {
    it("takes out tokens, keys, passwords, emails, links, user paths, home IPs and the AniList name", () => {
        const safe = LOG.map(line => privateSafe(line, ["MadeUpName"])).join("\n")
        for (const secret of SECRETS) expect(safe, secret).not.toContain(secret)
    })

    it("keeps what explains a problem", () => {
        const safe = LOG.map(line => privateSafe(line, ["MadeUpName"]))
        expect(safe[0]).toBe("[ANILIST] error login failed Authorization: [hidden] [hidden]")
        expect(safe[1]).toBe("[EXTERNAL PLAYER LINK] info Sending URL to external player intent://[ip]:43211/…")
        expect(safe[2]).toContain("\"status\":401")
        expect(safe[4]).toBe("[ACCOUNT] info signed in as [email]")
        expect(safe[5]).toBe("[Core] info AniList viewer [name], list of [name] loaded")
        expect(safe[6]).toBe("[NAKAMA] info host file C:\\Users\\[user]\\Videos\\Anime\\ep1.mkv and /home/[user]/anime/ep2.mkv")
        expect(safe[7]).toBe("[SEARCH] info https://anilist.co/…")
        expect(safe[8]).toBe("[Core] info changes for AniList: 1 sent, 0 dropped, 0 waiting")
        expect(privateSafe("Seanime Mobile 4.3.0 (40300), Android 14 (API 34), 127.0.0.1:43211")).toBe("Seanime Mobile 4.3.0 (40300), Android 14 (API 34), 127.0.0.1:43211")
    })

    it("leaves names shorter than three letters alone", () => {
        expect(privateSafe("an episode", ["an", "", null, undefined])).toBe("an episode")
    })
})

describe("the diagnostic report", () => {
    it("holds the facts and the log, all filtered", () => {
        const report = diagnosticReport({
            app: "Seanime Mobile 4.3.0 (40300)", variant: "release", android: "14 (API 34)", device: "Google Pixel 7", language: "app en, phone de-DE",
            problems: ["AniList sign-in expired", "made.up@example.org could not be reached"], logLines: LOG, made: Date.UTC(2026, 10, 20, 9, 30),
        }, ["MadeUpName"])
        expect(report).toContain("Made: 2026-11-20 09:30 UTC")
        expect(report).toContain("App: Seanime Mobile 4.3.0 (40300) (release)")
        expect(report).toContain("Android: 14 (API 34)")
        expect(report).toContain("Device: Google Pixel 7")
        expect(report).toContain("- AniList sign-in expired")
        expect(report).toContain(`Last ${LOG.length} log lines:`)
        for (const secret of SECRETS) expect(report, secret).not.toContain(secret)
    })

    it("says when it sees no problem", () => {
        const report = diagnosticReport({ app: "a", variant: "test", android: "14", device: "d", language: "en", problems: [], logLines: [], made: 0 })
        expect(report).toContain("- none seen")
    })
})

describe("the kept log lines", () => {
    it("are lines with time and level, cut to a sensible length, the newest kept", () => {
        const time = Date.UTC(2026, 10, 20, 9, 30, 5, 120)
        expect(logLineOf("log", ["[Core] info", "started", { count: 2 }], time)).toBe("09:30:05.120 [Core] info started {\"count\":2}")
        expect(logLineOf("error", [new TypeError("Network request failed")], time)).toBe("09:30:05.120 error TypeError: Network request failed")
        expect(logLineOf("log", ["a\nb"], time)).toBe("09:30:05.120 a b")
        expect(logLineOf("log", ["x".repeat(1000)], time).length).toBe(400)
        for (let i = 0; i < 350; i++) keepLogLine(`line ${i}`)
        expect(recentLogLines()).toHaveLength(300)
        expect(recentLogLines(2)).toEqual(["line 348", "line 349"])
    })

    it("give the errors and warnings for the problems", () => {
        const lines = ["09:00:00.000 [Core] info fine", "09:00:01.000 error TypeError: x", "09:00:02.000 [PLAY MEDIA] warning no file", "09:00:03.000 toast error: AniList is down"]
        expect(recentErrors(lines, 10)).toEqual(lines.slice(1))
        expect(recentErrors(lines, 1)).toEqual(["09:00:03.000 toast error: AniList is down"])
    })
})
