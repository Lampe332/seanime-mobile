// geschrieben nach: docs/EIGENER-KERN.md §4p (Phase 5c-1: ohne Server) und dem App-Code in native/src (buildSeaQuery, Links, Adressen des Servers); kein Server-Quelltext
import axios, { type AxiosAdapter, isAxiosError } from "axios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildSeaQuery } from "@/api/client/requests"
import { offlineArtworkUrl, offlineFileUrl } from "@/api/hooks/mobile_offline.helpers"
import { appLinkTarget } from "@/lib/app-links"
import { getAssetUrl } from "@/lib/server/assets"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NEEDS_THE_SERVER, streamFileAddress, withoutServerError } from "./without-server"


vi.mock("@/components/ui/toast/toast-store", () => ({ toast: { error: () => undefined, warning: () => undefined } }))

/*
 * The app without its server (phase 5c-1): the switch comes from a link of the test and scratch app only; what only
 * the server could answer fails at once with a clear text; addresses on the server are left out.
 */

let toServer = 0
const answering: AxiosAdapter = async config => {
    toServer++
    return { data: { data: "from the server" }, status: 200, statusText: "OK", headers: {}, config }
}
const savedAdapter = axios.defaults.adapter

beforeEach(() => {
    toServer = 0
    axios.defaults.adapter = answering
})

afterEach(() => {
    axios.defaults.adapter = savedAdapter
})

describe("the switch", () => {
    it("has no link any more since stage 8b-1, in no app", () => {
        expect(appLinkTarget("seanime-scratch://core?server=off", "scratch")).toBeNull()
        expect(appLinkTarget("seanime-native://core?server=on", "test")).toBeNull()
        expect(appLinkTarget("seanime://core?server=off", "release")?.kind).not.toBe("core-server")
    })

})

describe("requests only the server could answer", () => {
    it("fail at once without it, as a server error with status 503 and a clear text", async () => {
        const started = Date.now()
        const failure: any = await buildSeaQuery({ endpoint: "/api/v1/torrent-client/details", method: "GET" }).catch((error: any) => error)
        expect(Date.now() - started).toBeLessThan(1000)
        expect(isAxiosError(failure)).toBe(true)
        expect(failure.response.status).toBe(503)
        expect(failure.response.data.error).toBe(`GET /api/v1/torrent-client/details ${NEEDS_THE_SERVER}`)
        expect(toServer).toBe(0)
    })

    // debrid into a folder, filler and custom sources are given up in phase 7f (core/removed/removed.test.ts); watch parties are not built (7e)
    for (const [method, endpoint] of [["POST", "/api/v1/directory-selector"], ["POST", "/api/v1/nakama/watch-party/join"], ["GET", "/api/v1/metadata-provider/filler"], ["POST", "/api/v1/directstream/subs/convert-subs"]] as const) {
        it(`${method} ${endpoint} fails at once without it`, async () => {
            const failure: any = await buildSeaQuery({ endpoint, method }).catch((error: any) => error)
            expect(failure.response.data.error).toContain(NEEDS_THE_SERVER)
            expect(toServer).toBe(0)
        })
    }
})

describe("addresses on the server", () => {
    it("are left out without it; whole addresses and the app's own files stay", () => {
        expect(getAssetUrl("picture.png")).toBe("")
        expect(getAssetUrl("https://example.org/a.png")).toBe("https://example.org/a.png")
        expect(offlineFileUrl("not-saved", "video.mp4")).toBe("")
        expect(offlineArtworkUrl("not-saved.jpg", "https://example.org/cover.jpg")).toBe("https://example.org/cover.jpg")
        expect(streamFileAddress("/api/v1/sub.vtt")).toBeNull()
        expect(streamFileAddress("https://example.org/sub.vtt")).toBe("https://example.org/sub.vtt")
        expect(streamFileAddress("file:///data/sub.vtt")).toBe("file:///data/sub.vtt")
        expect(withoutServerError("GET /api/v1/logs").message).toBe(`GET /api/v1/logs ${NEEDS_THE_SERVER}`)
    })
})

describe("background queries without a screen of their own (phase 5c-2)", () => {
    // which query, in which file: plugin button (anime page, every top bar), manga source refresh (Home, lists,
    // chapters); found on the tablet: Nakama rooms (every start), plugin episode tabs (settings). Cache-only mode
    // (settings, every 10 s) left the list: the core answers it (core/anilist/cache-only.ts)
    const background: [file: string, endpoint: string, enabled: string][] = [
        ["src/api/hooks/extensions.hooks.ts", "GetPluginSettings", "enabled: onlyWithServer()"],
        ["src/api/hooks/extensions.hooks.ts", "ListDevelopmentModeExtensions", "enabled: onlyWithServer()"],
        ["src/api/hooks/nakama.hooks.ts", "NakamaRoomsAvailable", "enabled: onlyWithServer()"],
        ["src/api/hooks/extensions.hooks.ts", "ListAnimeEntryEpisodeTabExtensions", "enabled: onlyWithServer()"],
    ]
    it.each(background)("%s: %s is asked only with the server", (file, endpoint, enabled) => {
        const source = readFileSync(join(__dirname, "../../..", file), "utf8")
        const query = source.slice(source.indexOf(`${endpoint}.endpoint`))
        const end = query.indexOf("})")
        expect(end).toBeGreaterThan(0)
        expect(query.slice(0, end)).toContain(enabled)
    })
})
