import { afterEach, describe, expect, it, vi } from "vitest"

describe("server toasts on phones", () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.resetModules()
    })

    async function load(platform: string, language = "en") {
        vi.stubEnv("SEA_PUBLIC_PLATFORM", platform)
        vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(language) })
        vi.resetModules()
        return (await import("./misc-events.listeners")).phoneToastText
    }

    it("says the Nakama messages in the phone's language", async () => {
        const de = await load("mobile", "de")
        expect(de("Failed to connect to Nakama host after multiple attempts.")).toBe("Der Nakama-Host ist nicht erreichbar. Die App versucht es jede Minute weiter.")
        expect(de("Sending stream to player...")).toBe("Stream wird an den Player gesendet …")
    })

    it("keeps other messages and the desktop's as they are", async () => {
        const en = await load("mobile", "en")
        expect(en("Failed to connect to Nakama host after multiple attempts.")).toBe("Can't reach the Nakama host. The app keeps trying once a minute.")
        expect(en("Library scanned")).toBe("Library scanned")
        const desktop = await load("web")
        expect(desktop("Sending stream to player...")).toBe("Sending stream to player...")
    })
})
