import { describe, expect, it } from "vitest"
import { phoneToastText } from "./phone-toast-text"

const de = (_en: string, de: string) => de
const en = (en: string) => en

describe("phoneToastText", () => {
    it("translates the Nakama host messages", () => {
        expect(phoneToastText("Sending stream to player...", de)).toBe("Stream wird an den Player gesendet …")
        expect(phoneToastText("Failed to connect to Nakama host after multiple attempts.", en)).toBe("Can't reach the Nakama host. The app keeps trying once a minute.")
    })
    it("passes other messages through", () => {
        expect(phoneToastText("Library scanned", de)).toBe("Library scanned")
    })
})
