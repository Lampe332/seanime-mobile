// geschrieben nach: account-config.ts (Release nur https, Test/Scratch zusätzlich localhost); Werte erfunden
import { describe, expect, it } from "vitest"
import { accountApiBase, checkAccountUrl } from "./account-config"

describe("account server address", () => {
    it("release talks only https, also at run time", () => {
        expect(accountApiBase("release", "http://localhost:8787")).toBe("https://api.seanimemobile.com")
        expect(checkAccountUrl("release", "https://api.seanimemobile.com/v1/sync/meta")).toBe("https://api.seanimemobile.com/v1/sync/meta")
        expect(() => checkAccountUrl("release", "http://localhost:8787/v1/sync/meta")).toThrow(/https/)
        expect(() => checkAccountUrl("release", "http://api.seanimemobile.com/v1/sync/meta")).toThrow(/https/)
    })

    it("test and scratch builds may use the local server, never plain http elsewhere", () => {
        expect(accountApiBase("test", "http://localhost:8787/")).toBe("http://localhost:8787")
        expect(checkAccountUrl("test", "http://localhost:8787/v1/auth/prelogin")).toBe("http://localhost:8787/v1/auth/prelogin")
        expect(checkAccountUrl("scratch", "http://127.0.0.1:8787/v1/account")).toBe("http://127.0.0.1:8787/v1/account")
        expect(() => checkAccountUrl("test", "http://192.168.1.5:8787/v1/account")).toThrow(/https/)
        expect(() => checkAccountUrl("test", "http://localhost.evil.example/v1/account")).toThrow(/https/)
    })
})
