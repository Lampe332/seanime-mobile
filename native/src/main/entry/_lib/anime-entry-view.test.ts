import { describe, expect, it } from "vitest"
import {
    getAnimeEntryTabs,
    getAutomaticAnimeEntryView,
    getEntryTabSettings,
    getInitialAnimeEntryView,
    isBuiltInAnimeEntryViewAvailable,
    NATIVE_VIEW_READY,
    NOT_READY_VIEWS,
    shownAnimeEntryView,
} from "./anime-entry-view"

const en = (english: string) => english
const status = (on: { torrent?: boolean, debrid?: boolean, online?: boolean, defaultSource?: string } = {}) => ({
    torrentstreamSettings: { enabled: !!on.torrent },
    debridSettings: { enabled: !!on.debrid },
    settings: { library: { enableOnlinestream: !!on.online, defaultPlaybackSource: on.defaultSource ?? "" } },
}) as never

describe("anime page views", () => {
    it("knows which built-in views are on", () => {
        expect(isBuiltInAnimeEntryViewAvailable("library", status(), ["library"])).toBe(true)
        expect(isBuiltInAnimeEntryViewAvailable("onlinestream", status({ online: true }), [])).toBe(true)
        expect(isBuiltInAnimeEntryViewAvailable("onlinestream", status({ online: true }), ["onlinestream"])).toBe(false)
        expect(isBuiltInAnimeEntryViewAvailable("torrentstream", status({ online: true }), [])).toBe(false)
        expect(isBuiltInAnimeEntryViewAvailable("ext:plugin", status({ online: true }), [])).toBe(false)
    })

    it("opens online streaming for an anime outside the library", () => {
        expect(getAutomaticAnimeEntryView({ libraryData: undefined }, status({ online: true }), [])).toBe("onlinestream")
        expect(getAutomaticAnimeEntryView({ libraryData: {} as never }, status({ online: true }), [])).toBe("library")
        expect(getAutomaticAnimeEntryView({ libraryData: undefined }, status(), [])).toBe("library")
    })

    it("prefers the link's tab, then the default source, and keeps upcoming anime in the library", () => {
        const entry = { libraryData: undefined, media: { status: "FINISHED" } } as never
        expect(getInitialAnimeEntryView({ entry, serverStatus: status({ online: true, torrent: true }), hidden: [], tab: "torrentstream" })).toBe("torrentstream")
        expect(getInitialAnimeEntryView({ entry, serverStatus: status({ online: true, torrent: true, defaultSource: "torrentstream" }), hidden: [] })).toBe("torrentstream")
        expect(getInitialAnimeEntryView({ entry, serverStatus: status({ online: true, defaultSource: "debridstream" }), hidden: [] })).toBe("onlinestream")
        expect(getInitialAnimeEntryView({ entry, serverStatus: status({ online: true, defaultSource: "ext:a" }), hidden: [] })).toBe("onlinestream")
        const upcoming = { libraryData: undefined, media: { status: "NOT_YET_RELEASED" } } as never
        expect(getInitialAnimeEntryView({ entry: upcoming, serverStatus: status({ online: true }), hidden: [], tab: "onlinestream" })).toBe("library")
    })

    it("shows tabs only with a streaming source, with short names from three on", () => {
        const entry = { media: { status: "FINISHED" } } as never
        expect(getAnimeEntryTabs(en, entry, status(), [])).toEqual([])
        expect(getAnimeEntryTabs(en, entry, status({ online: true }), []).map(tab => tab.label)).toEqual(["Local library", "Online streaming"])
        expect(getAnimeEntryTabs(en, entry, status({ online: true, torrent: true }), []).map(tab => tab.label)).toEqual(["Library", "Torrent", "Online"])
        expect(getAnimeEntryTabs(en, entry, status({ online: true }), ["onlinestream"])).toEqual([])
        expect(getAnimeEntryTabs(en, { media: { status: "NOT_YET_RELEASED" } } as never, status({ online: true }), [])).toEqual([])
    })

    it("offers online streaming on the page and opens it outside the library (2.15)", () => {
        expect(NATIVE_VIEW_READY).toEqual({ torrentstream: true, debridstream: true, onlinestream: true })
        expect(NOT_READY_VIEWS).toEqual([])
        // the page passes the not-ready views as hidden; none are left, so the automatic view is online like 2.0.33
        const outside = { libraryData: undefined, media: { status: "FINISHED" } } as never
        expect(getInitialAnimeEntryView({ entry: outside, serverStatus: status({ online: true, torrent: true }), hidden: NOT_READY_VIEWS })).toBe("onlinestream")
        const inLibrary = { libraryData: {}, media: { status: "FINISHED" } } as never
        expect(getInitialAnimeEntryView({ entry: inLibrary, serverStatus: status({ online: true }), hidden: NOT_READY_VIEWS })).toBe("library")
        expect(getAnimeEntryTabs(en, outside, status({ online: true }), NOT_READY_VIEWS).map(tab => tab.value)).toEqual(["library", "onlinestream"])
        // hidden in More › Tabs: the library again
        expect(getInitialAnimeEntryView({ entry: outside, serverStatus: status({ online: true }), hidden: [...NOT_READY_VIEWS, "onlinestream"] })).toBe("library")
    })

    it("always lists the three sources in More › Tabs", () => {
        const rows = getEntryTabSettings(en, status({ online: true }))
        expect(rows.map(row => [row.view, row.settingsTab, row.on])).toEqual([
            ["torrentstream", "torrentstream", false], ["debridstream", "debrid", false], ["onlinestream", "onlinestream", true],
        ])
    })
})

describe("shownAnimeEntryView (a page left and shown again)", () => {
    it("shows its stored view while open, and keeps it while hidden after leaving (no rebuild of the hidden page)", () => {
        expect(shownAnimeEntryView("onlinestream", true, false, null)).toBe("onlinestream")
        expect(shownAnimeEntryView("onlinestream", false, true, null)).toBe("onlinestream")
        expect(shownAnimeEntryView("onlinestream", false, true, "library")).toBe("onlinestream")
    })
    it("shown again it starts from its first view at once, the library while the anime loads", () => {
        expect(shownAnimeEntryView("onlinestream", true, true, "onlinestream")).toBe("onlinestream")
        expect(shownAnimeEntryView("onlinestream", true, true, "library")).toBe("library")
        expect(shownAnimeEntryView("onlinestream", true, true, null)).toBe("library")
    })
})
