import { describe, expect, it } from "vitest"
import { APP_SCHEME, appLinkTarget, entryLink, LAUNCHER_SHORTCUTS, malAnime, page, sharedTextTarget, shortcutLink } from "./app-links"

// AppLinksTest.kt, 1:1
describe("AppLinks", () => {
    it("widget and shortcut links", () => {
        expect(appLinkTarget("seanime://entry?id=21087")).toEqual(page("/entry?id=21087"))
        expect(appLinkTarget("seanime://open?path=%2Fsearch")).toEqual(page("/search"))
        expect(appLinkTarget("seanime://open?path=/android-downloads")).toEqual(page("/android-downloads"))
        // only the shortcut pages, never any page or address
        expect(appLinkTarget("seanime://open?path=/settings")).toBeNull()
        expect(appLinkTarget("seanime://open?path=https://example.com")).toBeNull()
        expect(appLinkTarget("seanime://entry?id=-1")).toBeNull()
    })

    it("anime pages of AniList and MyAnimeList", () => {
        expect(appLinkTarget("https://anilist.co/anime/21087/One-Punch-Man/")).toEqual(page("/entry?id=21087"))
        expect(appLinkTarget("https://www.anilist.co/anime/21087")).toEqual(page("/entry?id=21087"))
        expect(appLinkTarget("https://myanimelist.net/anime/30276/One_Punch_Man")).toEqual(malAnime(30276))
        expect(appLinkTarget("https://anilist.co/manga/30013")).toBeNull()
        expect(appLinkTarget("https://example.com/anime/21087")).toBeNull()
    })

    it("shared text", () => {
        expect(sharedTextTarget("Schau mal: https://anilist.co/anime/21087/One-Punch-Man/ lol")).toEqual(page("/entry?id=21087"))
        expect(sharedTextTarget("One Punch Man")).toEqual(page("/search?q=One+Punch+Man"))
        expect(sharedTextTarget("https://example.com/video")).toBeNull()
        expect(sharedTextTarget("   ")).toBeNull()
    })
})

describe("links of the native app", () => {
    it("are read back to the same pages under the build's own scheme", () => {
        expect(appLinkTarget(entryLink(21087))).toEqual(page("/entry?id=21087"))
        expect(appLinkTarget(shortcutLink("/schedule"))).toEqual(page("/schedule"))
        expect(entryLink(1).startsWith(`${APP_SCHEME}://`)).toBe(true)
    })
    it("ignore other schemes and hosts", () => {
        expect(appLinkTarget("intent://entry?id=1")).toBeNull()
        expect(appLinkTarget("seanime://settings?path=/")).toBeNull()
        expect(appLinkTarget("seanime://entry?id=12abc")).toBeNull()
        expect(appLinkTarget(undefined)).toBeNull()
    })
    it("keep at most 100 characters of a shared title", () => {
        const target = sharedTextTarget("a".repeat(150))
        expect(target).toEqual(page("/search?q=" + "a".repeat(100)))
    })
})

// MainActivity.publishShortcuts: same rows, pages and system icons as the old app (the device showed them without icons)
describe("launcher shortcuts", () => {
    it("open their page and carry the old system icon", () => {
        expect(LAUNCHER_SHORTCUTS.map(item => [item.id, item.path, item.icon])).toEqual([
            ["search", "/search", "android:drawable/ic_menu_search"],
            ["downloads", "/android-downloads", "android:drawable/stat_sys_download_done"],
            ["schedule", "/schedule", "android:drawable/ic_menu_my_calendar"],
        ])
        for (const item of LAUNCHER_SHORTCUTS) expect(appLinkTarget(shortcutLink(item.path))).toEqual(page(item.path))
    })
})
