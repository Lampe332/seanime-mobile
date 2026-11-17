import { describe, expect, it } from "vitest"
import { isUnencryptedHost } from "./nakama-host"

describe("isUnencryptedHost", () => {
    it("flags http:// and an address without a scheme (the core adds http://)", () => {
        expect(isUnencryptedHost("http://192.168.1.20:43211")).toBe(true)
        expect(isUnencryptedHost(" HTTP://pc:43211/ ")).toBe(true)
        expect(isUnencryptedHost("127.0.0.1:43211")).toBe(true)
        expect(isUnencryptedHost("my-pc.local")).toBe(true)
    })
    it("leaves https, room links and an empty address alone", () => {
        expect(isUnencryptedHost("https://seanime.example.com")).toBe(false)
        expect(isUnencryptedHost("room://abc")).toBe(false)
        expect(isUnencryptedHost("")).toBe(false)
        expect(isUnencryptedHost("   ")).toBe(false)
    })
})
