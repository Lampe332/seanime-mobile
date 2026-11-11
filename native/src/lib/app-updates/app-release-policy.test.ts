import { describe, expect, it } from "vitest"
import { asset, parseReleases, Release, selectUpdate } from "./app-release-policy"

const release = (v: string, draft = false, prerelease = false): Release => ({
    tag: `v${v}`, body: "- App fixes",
    assets: [asset(`Seanime-Mobile-${v}.apk`, `https://github.com/Lampe332/seanime-mobile/releases/download/v${v}/Seanime-Mobile-${v}.apk`)],
    draft, prerelease,
})

// AppReleasePolicyTest.kt, 1:1
describe("AppReleasePolicy", () => {
    it("newer own APK is offered", () => {
        expect(selectUpdate("1.8.2", [release("1.8.3")])?.version).toBe("1.8.3")
    })
    it("selected asset retains expected bytes and digest for archive validation", () => {
        const r = release("2.0.0")
        const a = { ...r.assets[0], size: 67154647, digest: "sha256:expected" }
        expect(selectUpdate("1.8.8", [{ ...r, assets: [a] }])?.asset).toEqual(a)
    })
    it("release cannot borrow an APK from another version", () => {
        expect(selectUpdate("1.8.8", [{ ...release("2.0.0"), assets: release("1.8.9").assets }])).toBeNull()
    })
    it("same and older are not offered", () => {
        expect(selectUpdate("1.8.2", [release("1.8.2"), release("1.8.1")])).toBeNull()
    })
    it("compares numerically and does not compare backend version", () => {
        expect(selectUpdate("1.9.0", [release("1.10.0")])?.version).toBe("1.10.0")
    })
    it("drafts and prereleases are skipped", () => {
        expect(selectUpdate("1.8.2", [release("2.0.0", true), release("2.1.0", false, true)])).toBeNull()
    })
    it("newest eligible release wins regardless of order", () => {
        expect(selectUpdate("1.8.2", [release("1.8.3"), release("2.0.0")])?.version).toBe("2.0.0")
    })
    it("releases without own APK are skipped", () => {
        expect(selectUpdate("1.8.2", [{ ...release("2.0.0"), assets: [] }])).toBeNull()
    })
    it("desktop and other APK names are rejected", () => {
        expect(selectUpdate("1.8.2", [{
            ...release("2.0.0"),
            assets: [asset("seanime-desktop.apk", "https://github.com/Lampe332/seanime-mobile/releases/download/v2.0.0/seanime-desktop.apk")],
        }])).toBeNull()
    })
    it("foreign repository and insecure urls are rejected", () => {
        const r = release("2.0.0")
        for (const url of [r.assets[0].url.replace("Lampe332", "someone"), r.assets[0].url.replace("https:", "http:"), r.assets[0].url + "?other=1"]) {
            expect(selectUpdate("1.8.2", [{ ...r, assets: [{ ...r.assets[0], url }] }])).toBeNull()
        }
    })
    it("malformed and non-stable versions are rejected", () => {
        for (const v of ["garbage", "1.8.3-beta", "999999999999999.0.0"]) expect(selectUpdate("1.8.2", [release(v)])).toBeNull()
        expect(selectUpdate("unknown", [release("2.0.0")])).toBeNull()
    })
})

describe("GitHub release list", () => {
    it("reads tag, body, flags and assets", () => {
        const [r] = parseReleases([{
            tag_name: "v3.0.0", body: "notes", draft: false, prerelease: false,
            assets: [{ name: "Seanime-Mobile-3.0.0.apk", browser_download_url: "https://x/y.apk", size: 5, digest: "sha256:ab" }],
        }])
        expect(r).toEqual({ tag: "v3.0.0", body: "notes", draft: false, prerelease: false, assets: [asset("Seanime-Mobile-3.0.0.apk", "https://x/y.apk", 5, "sha256:ab")] })
    })
    it("treats missing flags as draft and prerelease (never offered)", () => {
        const [r] = parseReleases([{ tag_name: "v9.0.0" }])
        expect(r.draft && r.prerelease).toBe(true)
    })
    it("rejects an answer that is no list", () => {
        expect(() => parseReleases({ message: "API rate limit exceeded" })).toThrow()
    })
})
