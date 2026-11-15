import { describe, expect, it } from "vitest"
import { anilistLoginStep, extractAnilistToken, manualAnilistToken } from "./anilist-login-steps"

// a made-up token of the right shape (header.payload.signature), not a real one
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxMzk4NSIsImp0aSI6ImFiYyJ9.c2lnbmF0dXJlX29mX3RoZV90ZXN0X3Rva2Vu"

describe("anilistLoginStep", () => {
    it("starts with the one AniList button", () => {
        expect(anilistLoginStep({ opened: false, token: null, manual: false })).toBe("start")
    })
    it("waits after AniList was opened", () => {
        expect(anilistLoginStep({ opened: true, token: null, manual: false })).toBe("waiting")
    })
    it("offers to connect as soon as a token is there, opened or not", () => {
        expect(anilistLoginStep({ opened: true, token: TOKEN, manual: false })).toBe("found")
        expect(anilistLoginStep({ opened: false, token: TOKEN, manual: false })).toBe("found")
    })
    it("keeps the hand-made field once chosen", () => {
        expect(anilistLoginStep({ opened: false, token: null, manual: true })).toBe("manual")
        expect(anilistLoginStep({ opened: true, token: TOKEN, manual: true })).toBe("manual")
    })
})

describe("extractAnilistToken", () => {
    it("takes the token alone, trimmed", () => {
        expect(extractAnilistToken(`  ${TOKEN}\n`)).toBe(TOKEN)
    })
    it("joins a token broken over lines", () => {
        expect(extractAnilistToken(`${TOKEN.slice(0, 40)}\n${TOKEN.slice(40, 90)} \r\n${TOKEN.slice(90)}`)).toBe(TOKEN)
    })
    it("reads it out of an address", () => {
        expect(extractAnilistToken(`https://example.invalid/auth/callback#access_token=${TOKEN}&token_type=Bearer&expires_in=31536000`)).toBe(TOKEN)
        expect(extractAnilistToken(`app://x?access_token=${encodeURIComponent(TOKEN)}`)).toBe(TOKEN)
    })
    it("ignores other clipboard text", () => {
        expect(extractAnilistToken("")).toBeNull()
        expect(extractAnilistToken(null)).toBeNull()
        expect(extractAnilistToken("Solo Leveling")).toBeNull()
        expect(extractAnilistToken("https://anilist.co/anime/151807")).toBeNull()
        expect(extractAnilistToken("a.b.c")).toBeNull()
        expect(extractAnilistToken("https://x.invalid/#access_token=%E0%A4%A")).toBeNull()
    })
})

describe("manualAnilistToken", () => {
    it("cleans a recognised token and keeps anything else as typed", () => {
        expect(manualAnilistToken(` ${TOKEN.slice(0, 50)}\n${TOKEN.slice(50)} `)).toBe(TOKEN)
        expect(manualAnilistToken("  something-else ")).toBe("something-else")
    })
})
