import { describe, expect, it } from "vitest"
import { checkServerAddress } from "./mediaserver-host"

describe("checkServerAddress", () => {
    it("takes https addresses with port and sub path, without the trailing slash", () => {
        expect(checkServerAddress(" https://media.example.org:8920/jellyfin/ ")).toEqual({ ok: true, url: "https://media.example.org:8920/jellyfin", unencrypted: false })
    })

    it("warns for http:// and for an address without scheme, which means http://", () => {
        expect(checkServerAddress("http://192.168.1.20:8096")).toEqual({ ok: true, url: "http://192.168.1.20:8096", unencrypted: true })
        expect(checkServerAddress("192.168.1.20:8096")).toEqual({ ok: true, url: "http://192.168.1.20:8096", unencrypted: true })
    })

    it("refuses empty addresses, other schemes, spaces and user parts", () => {
        for (const typed of ["", "   ", "ftp://host", "http://", "http://my host", "https://user@host", "https://host?x=1"]) {
            expect(checkServerAddress(typed).ok, typed).toBe(false)
        }
    })
})
