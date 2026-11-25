import { describe, expect, it } from "vitest"
import { files } from "../../../test/expo-file-system"
import { bannerFileUri, resolveBanner } from "./home-banner"

const PRESETS = { sakura: 11, cosmos: 12 }

describe("resolveBanner", () => {
    it("gives a bundled picture for a known preset", () => {
        expect(resolveBanner("preset:sakura", PRESETS)).toEqual({ kind: "preset", id: "sakura", asset: 11 })
    })

    it("shows nothing for an unknown preset or an empty value", () => {
        expect(resolveBanner("preset:volcano", PRESETS)).toBeUndefined()
        expect(resolveBanner("preset:toString", PRESETS)).toBeUndefined()
        expect(resolveBanner("", PRESETS)).toBeUndefined()
        expect(resolveBanner("   ", PRESETS)).toBeUndefined()
        expect(resolveBanner(undefined, PRESETS)).toBeUndefined()
        expect(resolveBanner("not a picture", PRESETS)).toBeUndefined()
    })

    it("gives the uri of the own photo on this device", () => {
        files.set("document/home-banner-1.jpg", "jpeg")
        try {
            expect(resolveBanner("file:home-banner-1.jpg", PRESETS)).toEqual({ kind: "file", uri: "document/home-banner-1.jpg" })
        } finally {
            files.delete("document/home-banner-1.jpg")
        }
    })

    it("shows nothing for a photo another device synced here", () => {
        expect(resolveBanner("file:home-banner-2.jpg", PRESETS)).toBeUndefined()
    })

    it("never reads outside the own banner photos", () => {
        files.set("document/secret.txt", "x")
        try {
            expect(bannerFileUri("secret.txt")).toBeUndefined()
            expect(bannerFileUri("home-banner-../secret.txt")).toBeUndefined()
        } finally {
            files.delete("document/secret.txt")
        }
    })

    it("keeps showing an image link saved before the picker", () => {
        expect(resolveBanner(" https://example.org/banner.jpg ", PRESETS)).toEqual({ kind: "link", uri: "https://example.org/banner.jpg" })
        expect(resolveBanner("http://example.org/b.png", PRESETS)).toEqual({ kind: "link", uri: "http://example.org/b.png" })
    })
})
