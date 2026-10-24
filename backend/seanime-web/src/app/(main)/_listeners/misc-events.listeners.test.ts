import { afterEach, describe, expect, it, vi } from "vitest"

// The first test pays the cold import of the listener module, which takes over 5 s while the whole suite runs.
describe("server toasts on phones", { timeout: 30_000 }, () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.resetModules()
    })

    async function load(language = "en") {
        vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(language) })
        vi.resetModules()
        return (await import("./misc-events.listeners")).phoneToastText
    }

    it("says the Nakama messages in the phone's language", async () => {
        const de = await load("de")
        expect(de("Failed to connect to Nakama host after multiple attempts.")).toBe("Der Nakama-Host ist nicht erreichbar. Die App versucht es jede Minute weiter.")
        expect(de("Sending stream to player...")).toBe("Stream wird an den Player gesendet …")
    })

    it("keeps other messages as they are", async () => {
        const en = await load("en")
        expect(en("Failed to connect to Nakama host after multiple attempts.")).toBe("Can't reach the Nakama host. The app keeps trying once a minute.")
        expect(en("Library scanned")).toBe("Library scanned")
    })
})
