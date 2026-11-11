import { storage } from "@/lib/storage"
import { type MediaCorePreferences, mediaCorePreferencesAtom } from "@/main/_features/media-core/media-core-preferences"
import { vc_autoNextAtom } from "@/main/_features/video-core/video-core.atoms"
import { createStore } from "jotai"
import { describe, expect, it } from "vitest"
import {
    filterLogFiles,
    formatBytes,
    keyCheckDetail,
    limitOptions,
    opacityOptions,
    planRestricted,
    sectionFromTab,
    settingsHref,
    withStoredOption,
} from "./settings-phone"

describe("settings links", () => {
    it("opens the area that holds a desktop tab", () => {
        expect(sectionFromTab("torrentstream")).toBe("torrents")
        expect(sectionFromTab("debrid")).toBe("torrents")
        expect(sectionFromTab("onlinestream")).toBe("onlinestream")
        expect(sectionFromTab("external-player-link")).toBe("playback")
        expect(sectionFromTab("local")).toBe("seanime")
    })

    it("opens the list for desktop-only tabs, nothing and keys of Object", () => {
        expect(sectionFromTab("discord")).toBeNull()
        expect(sectionFromTab("")).toBeNull()
        expect(sectionFromTab(undefined)).toBeNull()
        expect(sectionFromTab("constructor")).toBeNull()
    })

    it("builds the link the anime page uses", () => {
        expect(settingsHref("torrentstream")).toBe("/settings?tab=torrentstream")
    })
})

describe("Play the next episode automatically", () => {
    it("is the player's own Auto next (sea-media-core-preferences), not a server value", () => {
        const store = createStore()
        const stored = () => (JSON.parse(storage.getString("sea-media-core-preferences") ?? "{}") as Partial<MediaCorePreferences>).autoNext
        store.set(vc_autoNextAtom, false)
        expect((store.get(mediaCorePreferencesAtom) as MediaCorePreferences).autoNext).toBe(false)
        expect(stored()).toBe(false)
        store.set(vc_autoNextAtom, true)
        expect(stored()).toBe(true)
    })
})

describe("select values", () => {
    it("keeps a stored opacity between the steps", () => {
        const options = opacityOptions(42)
        expect(options).toHaveLength(21)
        expect(options.find(option => option.value === "42")?.label).toBe("42 %")
        expect(opacityOptions(50)).toHaveLength(20)
    })

    it("names limits in KB/s and whole MB/s and keeps a stored one", () => {
        const options = limitOptions([0, 512, 1024], 300, "Unlimited")
        expect(options.map(option => option.label)).toEqual(["Unlimited", "300 KB/s", "512 KB/s", "1 MB/s"])
    })

    it("shows a stored value the options do not list", () => {
        expect(withStoredOption([{ value: "a", label: "A" }], "b").map(option => option.value)).toEqual(["a", "b"])
        expect(withStoredOption([{ value: "a", label: "A" }], "a")).toHaveLength(1)
    })
})

describe("debrid key check", () => {
    it("tells a plan without API access from a refused key", () => {
        expect(planRestricted("403 PLAN_RESTRICTED_FEATURE")).toBe(true)
        expect(planRestricted("invalid api key")).toBe(false)
    })

    it("never shows the key in the detail", () => {
        const failure = { response: { data: { error: "bad key abcd1234 for user" } } }
        expect(keyCheckDetail(failure, "abcd1234")).toBe("bad key ••• for user")
        expect(keyCheckDetail(null, "abcd1234")).toBe("")
        expect(keyCheckDetail({ response: { data: { error: "x".repeat(300) } } }, "")).toHaveLength(240)
    })
})

describe("logs and memory", () => {
    it("filters server and scanner logs", () => {
        const names = ["seanime-2026-11-05.log", "2026-11-05-scan.log"]
        expect(filterLogFiles(names, "server")).toEqual(["seanime-2026-11-05.log"])
        expect(filterLogFiles(names, "scanner")).toEqual(["2026-11-05-scan.log"])
        expect(filterLogFiles(names, "all")).toEqual(names)
    })

    it("formats bytes", () => {
        expect(formatBytes(0)).toBe("0 B")
        expect(formatBytes(1536)).toBe("1.5 KB")
        expect(formatBytes(3 * 1024 * 1024)).toBe("3 MB")
    })
})
