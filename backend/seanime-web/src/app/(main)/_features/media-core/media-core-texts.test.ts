import { playerErrorText, playerLoadingText } from "@/app/(main)/_features/media-core/media-core-texts"
import { describe, expect, it } from "vitest"

const de = (_en: string, de: string) => de
const en = (en: string) => en

describe("player texts", () => {
    it("translates the server's loading steps", () => {
        expect(playerLoadingText("Loading stream...", de)).toBe("Stream wird geladen…")
        expect(playerLoadingText("Awaiting stream: 42%", de)).toBe("Warte auf Stream: 42 %")
        expect(playerLoadingText("Awaiting stream: 42%", en)).toBe("Awaiting stream: 42%")
    })

    it("keeps unknown loading texts", () => {
        expect(playerLoadingText("Diesen Torrent teilt gerade niemand.", de)).toBe("Diesen Torrent teilt gerade niemand.")
    })

    it("explains video element errors by code", () => {
        expect(playerErrorText("Video playback error occurred. (Code: 3)", de)).toBe("Dieses Gerät konnte das Video nicht dekodieren.")
        expect(playerErrorText("Video playback error occurred. (Code: unknown)", en)).toBe("The video stopped because of an error.")
    })

    it("uses the stream start wording for server reasons", () => {
        expect(playerErrorText("timeout waiting for torrent info", de)).toContain("Seedern")
        expect(playerErrorText("something else", de)).toBe("something else")
    })
})
