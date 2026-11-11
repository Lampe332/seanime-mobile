import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { serverNeedsStart } from "./server-restart"

describe("server restart on return", () => {
    it("starts the server again only when nothing runs", () => {
        expect(serverNeedsStart("stopped")).toBe(true)
        expect(serverNeedsStart("error")).toBe(true)
        expect(serverNeedsStart("idle")).toBe(true)
        for (const state of ["starting", "retrying", "ready"]) expect(serverNeedsStart(state)).toBe(false)
    })

    it("is asked whenever the app comes to the front (client-providers.tsx)", () => {
        const source = readFileSync(join(__dirname, "../../main/client-providers.tsx"), "utf8")
        expect(source).toMatch(/AppState\.addEventListener\("change"[\s\S]{0,160}serverNeedsStart\(SeanimeServer\.getStatus\(\)\.state\)[\s\S]{0,40}SeanimeServer\.start\(\)/)
    })

    it("knows every state the native module reports", () => {
        const kotlin = readFileSync(join(__dirname, "../../../modules/seanime-server/android/src/main/java/com/seanime/server/SeanimeServerService.kt"), "utf8")
        const reported = new Set([...kotlin.matchAll(/ServerState\.update\("([a-z]+)"/g)].map(match => match[1]))
        reported.add("idle")
        for (const state of reported) expect(["starting", "retrying", "ready", "stopped", "error", "idle"]).toContain(state)
    })
})
