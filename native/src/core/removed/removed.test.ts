// geschrieben nach: docs/EIGENER-KERN.md §4r (Phase 7a: bewusst entfernt) und Aufzeichnung der Server-Antworten vom 13.11.2026 (nur die Form); kein Server-Quelltext
import axios, { type AxiosAdapter } from "axios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildSeaQuery } from "@/api/client/requests"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NOT_WITHOUT_THE_SERVER } from "./removed"


vi.mock("@/components/ui/toast/toast-store", () => ({ toast: { error: () => undefined, warning: () => undefined } }))

/*
 * Given up without the server (phase 7a): plugins, Nakama's cloud rooms, Discord and issue reports. Without the server
 * reading is quiet and empty and changing says why not; with it every request goes to the server as before.
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

const quiet: [method: "GET" | "POST", endpoint: string, answer: unknown][] = [
    ["GET", "/api/v1/extensions/plugin-settings", { pinnedTrayPluginIds: [], pluginGrantedPermissions: {} }],
    ["GET", "/api/v1/extensions/list/development", null],
    ["GET", "/api/v1/extensions/list/anime-entry-episode-tabs", null],
    ["GET", "/api/v1/nakama/room/available", false],
    // phase 7f
    ["POST", "/api/v1/custom-source/provider/list/anime", { media: [], page: 1, totalPages: 0, total: 0 }],
    ["POST", "/api/v1/custom-source/provider/list/manga", { media: [], page: 1, totalPages: 0, total: 0 }],
    ["POST", "/api/v1/discord/presence/manga", true],
    ["POST", "/api/v1/discord/presence/cancel", true],
]

const refused: [method: "GET" | "POST" | "DELETE", endpoint: string, what: string][] = [
    // phase 7f
    ["POST", "/api/v1/metadata-provider/filler", "Filler lists are"],
    ["DELETE", "/api/v1/metadata-provider/filler", "Filler lists are"],
    ["POST", "/api/v1/debrid/torrents", "Debrid downloads into a folder are"],
    ["POST", "/api/v1/playback-manager/manual-tracking/start", "Tracking an external player is"],
    ["POST", "/api/v1/extensions/plugin-settings/pinned-trays", "Plugins are"],
    ["POST", "/api/v1/extensions/plugin-permissions/grant", "Plugins are"],
    ["POST", "/api/v1/extensions/playground/run", "The extension playground is"],
    ["POST", "/api/v1/nakama/room/create", "Cloud rooms are"],
    ["POST", "/api/v1/nakama/room/disconnect", "Cloud rooms are"],
    ["POST", "/api/v1/report/issue", "Issue reports are"],
    ["GET", "/api/v1/report/issue/download", "Issue reports are"],
]

describe("without the server", () => {
    it.each(quiet)("%s %s answers quietly", async (method, endpoint, answer) => {
        expect(await buildSeaQuery({ endpoint, method, data: method === "POST" ? {} : undefined })).toEqual(answer)
        expect(toServer).toBe(0)
    })

    it.each(refused)("%s %s says it is not available, through the server's error form", async (method, endpoint, what) => {
        const failure: any = await buildSeaQuery({ endpoint, method, data: {} }).catch((error: any) => error)
        expect(failure.response.status).toBe(503)
        expect(failure.response.data.error).toBe(`${what} ${NOT_WITHOUT_THE_SERVER}`)
        expect(toServer).toBe(0)
    })
})

describe("the plugins' screens without the server", () => {
    const read = (file: string) => readFileSync(join(__dirname, "../../..", file), "utf8")

    it("show no plugin button", () => {
        expect(read("src/main/_features/plugin/plugin-tray.tsx")).toContain("if (isFeatureDisabled(\"PluginTray\") || (!icons.length && !developmentModeExtensions?.length)) return null")
    })

    it("offer no granting of a plugin's permissions", () => {
        expect(read("src/main/extensions/_screens/extensions-phone-sheets.tsx")).toContain("{false && (")
    })
})

describe("the screens of what phase 7f gave up, without the server", () => {
    const read = (file: string) => readFileSync(join(__dirname, "../../..", file), "utf8")

    it("show no filler episodes on the anime page's \"More\"", () => {
        expect(read("src/main/entry/_containers/entry-actions/anime-entry-phone-menu.tsx")).not.toContain("usePopulateFillerData")
    })

    it("offer no browsing of custom sources", () => {
        expect(read("src/main/extensions/_screens/extensions-phone.tsx")).not.toContain("router.push(\"/custom-sources\")")
        expect(read("src/main/extensions/_screens/extensions-phone-sheets.tsx")).not.toContain("extension.type === \"custom-source\" && !invalid")
        expect(read("src/main/search/_screens/search-phone.tsx")).not.toContain("customSources")
    })

    it("offer no debrid download into a folder", () => {
        expect(read("src/main/entry/_containers/torrent-search/torrent-search-phone.tsx")).toContain("const debridOn = false")
    })

    it("offer only refreshing the chosen manga sources", () => {
        expect(read("src/main/manga/_components/manga-source-refresh-sheet.tsx")).toContain(".filter(option => !option.discovery)")
    })
})
