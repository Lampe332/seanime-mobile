import { describe, expect, it } from "vitest"
import type { MobileOffline_Failure, MobileOffline_Item } from "@/api/generated/types"
import { networkReport, offlineArtworkUrl, offlineFailureText, offlineFileUrl, offlineWaitingText, pendingItems } from "./mobile_offline.helpers"

const de = (_en: string, de: string) => de
const en = (en: string) => en

describe("network report", () => {
    it("reports Wi-Fi, mobile data and offline as the old app's isActiveNetworkMetered", () => {
        expect(networkReport({ isConnected: true, details: { isConnectionExpensive: false } })).toEqual({ connected: true, metered: false })
        expect(networkReport({ isConnected: true, details: { isConnectionExpensive: true } })).toEqual({ connected: true, metered: true })
        expect(networkReport({ isConnected: false, details: null })).toEqual({ connected: false, metered: false })
    })

    it("counts an unknown connection as connected", () => {
        expect(networkReport({ isConnected: null })).toEqual({ connected: true, metered: false })
    })
})

describe("offline URLs", () => {
    it("points to the server's file and artwork routes", () => {
        expect(offlineFileUrl("a".repeat(32), "video.ts")).toBe(`http://127.0.0.1:43212/api/v1/mobile-offline/file/${"a".repeat(32)}/video.ts`)
        expect(offlineArtworkUrl("b".repeat(64) + ".jpg")).toBe(`http://127.0.0.1:43212/api/v1/mobile-offline/artwork/${"b".repeat(64)}.jpg`)
        expect(offlineArtworkUrl(undefined, "https://img.example/cover.jpg")).toBe("https://img.example/cover.jpg")
        expect(offlineArtworkUrl("", "")).toBeUndefined()
    })
})

describe("offline texts and lists", () => {
    it("has a German and English text for every failure", () => {
        const failures: (MobileOffline_Failure | undefined)[] = ["SOURCE_REFUSED", "CONNECTION", "STORAGE_FULL", "SOURCE_UNAVAILABLE", "UNKNOWN", undefined]
        for (const failure of failures) {
            expect(offlineFailureText(failure, de)).not.toBe(offlineFailureText(failure, en))
        }
        expect(offlineWaitingText("wifi", de)).toBe("Wartet auf WLAN")
        expect(offlineWaitingText("", en)).toBe("")
    })

    it("lists everything not ready as pending", () => {
        const items = ["ready", "queued", "failed", "paused"].map(status => ({ status }) as MobileOffline_Item)
        expect(pendingItems(items).map(i => i.status)).toEqual(["queued", "failed", "paused"])
        expect(pendingItems(undefined)).toEqual([])
    })
})
