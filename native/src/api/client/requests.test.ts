import axios, { type AxiosAdapter, type InternalAxiosRequestConfig, isAxiosError } from "axios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import recorded from "@/core/extensions/fetch-manifest.recorded.json"
import { buildSeaQuery, type SeaError } from "./requests"

// The toast store draws on screen; buildSeaQuery itself never shows one (vitest lifts this above the imports)
vi.mock("@/components/ui/toast/toast-store", () => ({ toast: { error: () => undefined, warning: () => undefined } }))

/*
 * buildSeaQuery (docs/EIGENER-KERN.md �3): an interface the core has is answered there without HTTP, and a failure
 * looks to the hooks like a server error; nothing goes to a server (stage 8b-3).
 */

const FETCH = API_ENDPOINTS.EXTENSIONS.FetchExternalExtensionData
const valid = recorded.cases.find(recordedCase => recordedCase.name === "valid")!
const refused = recorded.cases.find(recordedCase => recordedCase.name === "missing-author")!

/** The server, replaced at axios' own seam: the request is kept and answered like the server answers. */
let toServer: InternalAxiosRequestConfig[] = []
const serverAnswers: AxiosAdapter = async config => {
    toServer.push(config)
    return { data: { data: "from the server" }, status: 200, statusText: "OK", headers: {}, config }
}

/** The network the core reaches: the recording computer's manifests. */
let fetched: string[] = []
function serveRecorded(caseName: string) {
    const recordedCase = recorded.cases.find(candidate => candidate.name === caseName)!
    vi.stubGlobal("fetch", async (url: string) => {
        fetched.push(url)
        const path = url.slice(recorded.origin.length)
        const files = recorded.files as Record<string, string>
        return { text: async () => path in files ? files[path] : JSON.stringify(recordedCase.served) }
    })
}

const savedAdapter = axios.defaults.adapter

beforeEach(() => {
    toServer = []
    fetched = []
    axios.defaults.adapter = serverAnswers
})

afterEach(() => {
    axios.defaults.adapter = savedAdapter
    vi.unstubAllGlobals()
})

describe("buildSeaQuery, answered by the core", () => {

    it("answers from the core without a request to the server, in the recorded form", async () => {
        serveRecorded("valid")
        const data = await buildSeaQuery({ endpoint: FETCH.endpoint, method: FETCH.methods[0], data: { manifestUri: valid.manifestUri } })
        expect(toServer).toEqual([])
        expect(fetched).toEqual([valid.manifestUri, recorded.origin + "/payload.js"])
        // what the server put under "data" for the same manifest
        expect(data).toEqual(valid.body.data)
        expect(Object.keys(data as object)).toEqual(Object.keys(valid.body.data!))
    })

    it("fails like a request to the server: an axios error with status and { error }", async () => {
        serveRecorded("missing-author")
        const error = await buildSeaQuery({ endpoint: FETCH.endpoint, method: "POST", data: { manifestUri: refused.manifestUri } })
            .then(() => null, (thrown: unknown) => thrown)
        expect(toServer).toEqual([])
        expect(isAxiosError(error)).toBe(true)
        const seaError = error as SeaError
        // the fields the hooks read (useServerMutation onError, useServerQuery)
        expect(seaError.response?.status).toBe(refused.status)
        expect(seaError.response?.data).toEqual(refused.body)
        expect(seaError.response?.data.error).toContain("failed sanity check, extension is missing required fields")
    })

    it("turns a fault inside the core into the same form", async () => {
        vi.stubGlobal("fetch", async () => {
            throw new TypeError("Network request failed")
        })
        const error = await buildSeaQuery({ endpoint: FETCH.endpoint, method: "POST", data: { manifestUri: "https://example.com/m.json" } })
            .catch((thrown: SeaError) => thrown)
        expect((error as SeaError).response?.status).toBe(500)
        expect((error as SeaError).response?.data).toEqual({ error: "failed to fetch extension manifest, Network request failed" })
    })

})

describe("buildSeaQuery, area settings", () => {
    const THEME = API_ENDPOINTS.THEME.UpdateTheme
    type StatusAnswer = { version: string, settings: unknown, themeSettings: { id: number, accentColor: string } }

    /** The server with a status of its own, settings and look included */
    function serverHasStatus() {
        axios.defaults.adapter = async config => {
            toServer.push(config)
            const data = { version: "3.10.4", settings: { id: 1 }, themeSettings: { id: 1, accentColor: "the server's" } }
            return { data: { data }, status: 200, statusText: "OK", headers: {}, config }
        }
    }

    it("on: the look is saved in the core without a request to the server", async () => {
        serverHasStatus()
        const theme = await buildSeaQuery<StatusAnswer["themeSettings"]>({ endpoint: THEME.endpoint, method: "PATCH", data: { theme: { accentColor: "#123456" } } })
        expect(toServer).toEqual([])
        expect(theme).toMatchObject({ id: 1, accentColor: "#123456" })
    })

    it("on: a refusal of the core is an axios error with status and { error }", async () => {
        const error = await buildSeaQuery({ endpoint: THEME.endpoint, method: "PATCH", data: { theme: { accentColor: 5 } } }).catch((thrown: SeaError) => thrown)
        expect(isAxiosError(error)).toBe(true)
        expect((error as SeaError).response?.status).toBe(500)
        expect((error as SeaError).response?.data).toEqual({ error: "theme.accentColor must be a text" })
        expect(toServer).toEqual([])
    })
})
