import { describe, expect, it, vi } from "vitest"
import { CoreError } from "../errors"
import { type FetchText, fetchExtensionManifest } from "./fetch-manifest"
import recorded from "./fetch-manifest.recorded.json"

/*
 * The server's answers to 98 manifests, good and broken, recorded at the test app (scripts/record-server.mjs
 * manifest-cases). The core is given the same manifests and has to answer the same.
 */

type RecordedCase = {
    name: string
    manifestUri: string
    served: unknown
    status: number
    body: { data?: unknown, error?: string }
}

const cases = recorded.cases as RecordedCase[]
const files = recorded.files as Record<string, string>

/** The recording computer's file server again: the case's manifest, the two payload files, "not found" for the rest. */
function networkOf(recordedCase: RecordedCase): FetchText {
    return async url => {
        if (!url.startsWith(recorded.origin + "/")) throw new TypeError("Network request failed")
        const path = url.slice(recorded.origin.length)
        if (path in files) return { text: async () => files[path] }
        const served = recordedCase.served
        if (!path.endsWith("/manifest.json") || typeof served === "number") return { text: async () => "not found" }
        return { text: async () => typeof served === "string" ? served : JSON.stringify(served) }
    }
}

/** Texts the server wrote itself are the same word for word; where its runtime spoke, only the fixed beginning is. */
function isOwnText(message: string): boolean {
    return message.startsWith("failed sanity check, ")
        || message === "downloaded payload is empty"
        || message === "cannot install development mode extensions for security reasons"
}

describe("fetchExtensionManifest against the recorded server answers", () => {
    it("has the recording at hand", () => {
        expect(cases.length).toBe(98)
        expect(cases.filter(recordedCase => recordedCase.status === 200).length).toBe(44)
    })

    for (const recordedCase of cases) {
        if (recordedCase.status === 200) {
            it(`${recordedCase.name}: same manifest as the server`, async () => {
                const manifest = await fetchExtensionManifest(recordedCase.manifestUri, networkOf(recordedCase))
                expect(manifest).toEqual(recordedCase.body.data)
                // also the same fields in the same order, none added and none missing
                expect(JSON.stringify(manifest)).toBe(JSON.stringify(recordedCase.body.data))
            })
        } else {
            it(`${recordedCase.name}: same refusal as the server`, async () => {
                const error = await fetchExtensionManifest(recordedCase.manifestUri, networkOf(recordedCase)).then(() => null, (thrown: unknown) => thrown)
                expect(error).toBeInstanceOf(CoreError)
                const coreError = error as CoreError
                expect(coreError.status).toBe(recordedCase.status)
                const expected = recordedCase.body.error!
                if (isOwnText(expected)) expect(coreError.message).toBe(expected)
                else expect(coreError.message.split(", ")[0]).toBe(expected.split(", ")[0])
            })
        }
    }
})

describe("fetchExtensionManifest", () => {
    const manifest = {
        id: "probe", name: "Probe", version: "1.2.3", language: "typescript", type: "manga-provider", author: "someone",
        payloadURI: "https://example.com/code.ts",
    }

    it("asks for the manifest and then for the code, nothing else", async () => {
        const asked: string[] = []
        const result = await fetchExtensionManifest("https://example.com/manifest.json", async url => {
            asked.push(url)
            return { text: async () => url.endsWith(".json") ? JSON.stringify(manifest) : "class Provider {}" }
        })
        expect(asked).toEqual(["https://example.com/manifest.json", "https://example.com/code.ts"])
        expect(result.payload).toBe("class Provider {}")
        expect(result.readme).toBe("")
    })

    it("counts the code in bytes when it names what is missing", async () => {
        const error = await fetchExtensionManifest("https://example.com/manifest.json", async url => ({
            text: async () => url.endsWith(".json") ? JSON.stringify({ ...manifest, id: "" }) : "größer",
        })).catch((thrown: unknown) => thrown)
        expect((error as CoreError).message).toContain("Payload: 8")
    })

    it("gives up on an address that never answers", async () => {
        const never: FetchText = (_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("Aborted")))
        })
        vi.useFakeTimers()
        try {
            const pending = fetchExtensionManifest("https://example.com/manifest.json", never).catch((thrown: unknown) => thrown)
            await vi.advanceTimersByTimeAsync(30_000)
            const error = await pending
            expect(error).toBeInstanceOf(CoreError)
            expect((error as CoreError).message).toBe("failed to fetch extension manifest, Aborted")
        }
        finally {
            vi.useRealTimers()
        }
    })
})
