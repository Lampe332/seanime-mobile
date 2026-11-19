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

// docs/EIGENER-KERN.md: the core's test links have no screen; only the test and scratch apps take them
describe("core links", () => {
    it("takes the core's links in the test and scratch apps, under their own schemes", () => {
        expect(appLinkTarget("seanime-scratch://core?move=again", "scratch")).toEqual({ kind: "core-move" })
        expect(appLinkTarget("seanime-native://core?move=again", "test")).toEqual({ kind: "core-move" })
        expect(appLinkTarget("seanime-native://core?memory=report", "test")).toEqual({ kind: "core-memory" })
        expect(appLinkTarget("seanime-scratch://core?memory=report", "scratch")).toEqual({ kind: "core-memory" })
        expect(appLinkTarget("seanime-native://core?memory=all", "test")).toBeNull()
        expect(appLinkTarget("seanime://core?memory=report", "release")).toBeNull()
    })

    it("opens the first-start preview only in the test and scratch apps, never in the release", () => {
        expect(appLinkTarget("seanime-scratch://dev/intro", "scratch")).toEqual({ kind: "dev-intro" })
        expect(appLinkTarget("seanime-native://dev/intro", "test")).toEqual({ kind: "dev-intro" })
        expect(appLinkTarget("seanime://dev/intro", "release")).toBeNull()
        // the chapter check's test trigger (Updates): test and scratch only
        expect(appLinkTarget("seanime-scratch://dev/check-updates", "scratch")).toEqual({ kind: "dev-check-updates" })
        expect(appLinkTarget("seanime-native://dev/check-updates", "test")).toEqual({ kind: "dev-check-updates" })
        expect(appLinkTarget("seanime://dev/check-updates", "release")).toBeNull()
        // a new-chapter notification opens the manga page
        expect(appLinkTarget("seanime://manga?id=30013", "release")).toEqual({ kind: "page", path: "/manga/entry?id=30013" })
        expect(appLinkTarget("seanime://manga?id=abc", "release")).toBeNull()
        // the outage switch for showing the sync hint: test and scratch only, never in the release
        expect(appLinkTarget("seanime-scratch://dev/anilist-down?on=1", "scratch")).toEqual({ kind: "core-anilist", reachable: false })
        expect(appLinkTarget("seanime-native://dev/anilist-down?on=0", "test")).toEqual({ kind: "core-anilist", reachable: true })
        expect(appLinkTarget("seanime://dev/anilist-down?on=1", "release")).toBeNull()
        expect(appLinkTarget("seanime-scratch://dev/anilist-down?on=yes", "scratch")).toBeNull()
        expect(appLinkTarget("seanime-scratch://dev/intro/more", "scratch")).toBeNull()
        expect(appLinkTarget("seanime-scratch://dev/other", "scratch")).toBeNull()
        expect(appLinkTarget("https://anilist.co/dev/intro", "scratch")).toBeNull()
    })

    it("takes no area or server switch any more, and nothing unknown (stage 8b-1: the core always answers)", () => {
        expect(appLinkTarget("seanime-native://core?area=extensions&on=1", "test")).toBeNull()
        expect(appLinkTarget("seanime-scratch://core?server=off", "scratch")).toBeNull()
        expect(appLinkTarget("seanime-native://core?library=check&media=105333", "test")).toBeNull()
        expect(appLinkTarget("seanime-native://core?move=now", "test")).toBeNull()
        expect(appLinkTarget("seanime://core?move=again", "release")).toBeNull()
        expect(appLinkTarget("https://anilist.co/core?move=again", "test")).toBeNull()
    })

    it("names the write account and cuts AniList off only in the test and scratch apps, never in the release", () => {
        for (const [scheme, variant] of [["seanime-native", "test"], ["seanime-scratch", "scratch"]]) {
            expect(appLinkTarget(`${scheme}://core?write-account=1234567`, variant)).toEqual({ kind: "core-write-account", account: 1234567 })
            expect(appLinkTarget(`${scheme}://core?write-account=none`, variant)).toEqual({ kind: "core-write-account", account: null })
            expect(appLinkTarget(`${scheme}://core?anilist=down`, variant)).toEqual({ kind: "core-anilist", reachable: false })
            expect(appLinkTarget(`${scheme}://core?anilist=up`, variant)).toEqual({ kind: "core-anilist", reachable: true })
            expect(appLinkTarget(`${scheme}://core?move=again`, variant)).toEqual({ kind: "core-move" })
            expect(appLinkTarget(`${scheme}://core?sandbox=selftest`, variant)).toEqual({ kind: "core-sandbox-selftest" })
            expect(appLinkTarget(`${scheme}://core?sandbox=practice`, variant)).toEqual({ kind: "core-sandbox-practice" })
            expect(appLinkTarget(`${scheme}://core?sandbox=other`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?cast=discover`, variant)).toEqual({ kind: "core-cast-check" })
            expect(appLinkTarget(`${scheme}://core?cast=outlet-check`, variant)).toEqual({ kind: "core-cast-outlet-check" })
            expect(appLinkTarget(`${scheme}://core?cast=play`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?streams=check&media=21,x,105333&query=dr.%20stone`, variant)).toEqual({ kind: "core-streams-check", mediaIds: [21, 105333], query: "dr. stone", searchOnly: [] })
            expect(appLinkTarget(`${scheme}://core?streams=check&media=21&query=x&searchonly=a,,b`, variant)).toEqual({ kind: "core-streams-check", mediaIds: [21], query: "x", searchOnly: ["a", "b"] })
            expect(appLinkTarget(`${scheme}://core?streams=check`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?manga=check&media=30&provider=p&query=a%20b`, variant)).toEqual({ kind: "core-manga-check", mediaId: 30, provider: "p", query: "a b" })
            expect(appLinkTarget(`${scheme}://core?manga=write&media=30&provider=p`, variant)).toEqual({ kind: "core-manga-write", mediaId: 30, provider: "p" })
            expect(appLinkTarget(`${scheme}://core?manga=download&media=30&provider=p&count=2`, variant)).toEqual({ kind: "core-manga-download", mediaId: 30, provider: "p", count: 2, remove: false })
            expect(appLinkTarget(`${scheme}://core?manga=remove&media=30&provider=p`, variant)).toEqual({ kind: "core-manga-download", mediaId: 30, provider: "p", count: 1, remove: true })
            expect(appLinkTarget(`${scheme}://core?manga=check&media=30`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?manga=other&media=30&provider=p`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?download=selftest&url=http%3A%2F%2F127.0.0.1%3A4000%2Ffile.bin%3Fr%3D2000&referer=https%3A%2F%2Fexample.org%2F`, variant))
                .toEqual({ kind: "core-download-selftest", url: "http://127.0.0.1:4000/file.bin?r=2000", referer: "https://example.org/", sha256: "", size: null, stopAt: 25, way: "" })
            expect(appLinkTarget(`${scheme}://core?download=selftest&url=https%3A%2F%2Fexample.org%2Ff&sha256=${"AB".repeat(32)}&size=1048576&stop=0&way=work`, variant))
                .toEqual({ kind: "core-download-selftest", url: "https://example.org/f", referer: "", sha256: "ab".repeat(32), size: 1048576, stopAt: 0, way: "work" })
            expect(appLinkTarget(`${scheme}://core?offline=check&url=http%3A%2F%2F127.0.0.1%3A4000%2Fhls%2Fmaster.m3u8&subtitle=http%3A%2F%2F127.0.0.1%3A4000%2Fsub.vtt&sha256=${"AB".repeat(32)}&size=2048`, variant))
                .toEqual({ kind: "core-offline-check", url: "http://127.0.0.1:4000/hls/master.m3u8", type: "m3u8", referer: "", subtitle: "http://127.0.0.1:4000/sub.vtt", sha256: "ab".repeat(32), size: 2048, mediaId: 1, provider: "", episode: 1, title: "Download check", keep: false, cover: "", banner: "", image: "", episodeTitle: "", description: "" })
            // the pictures and texts the screens send along; an address that is not http(s) is dropped
            expect(appLinkTarget(`${scheme}://core?offline=check&media=105333&provider=some-provider&episode=3&title=A+title&keep=1&cover=https%3A%2F%2Fimg.example%2Fc.png&image=ftp%3A%2F%2Fimg.example%2Fe.png&etitle=First&text=It+begins`, variant))
                .toEqual({ kind: "core-offline-check", url: "", type: "m3u8", referer: "", subtitle: "", sha256: "", size: null, mediaId: 105333, provider: "some-provider", episode: 3, title: "A title", keep: true, cover: "https://img.example/c.png", banner: "", image: "", episodeTitle: "First", description: "It begins" })
            expect(appLinkTarget(`${scheme}://core?offline=check&url=ftp%3A%2F%2Fexample.org%2Ff`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?offline=check&media=105333`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?offline=remove&id=105333-1-sub`, variant)).toEqual({ kind: "core-offline-remove", id: "105333-1-sub" })
            expect(appLinkTarget(`${scheme}://core?offline=remove&id=..%2Fx`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?offline=list`, variant)).toEqual({ kind: "core-offline-list" })
            expect(appLinkTarget(`${scheme}://core?download=selftest&url=https%3A%2F%2Fexample.org%2Ff&sha256=abc&size=-1&stop=250&way=job`, variant))
                .toEqual({ kind: "core-download-selftest", url: "https://example.org/f", referer: "", sha256: "", size: null, stopAt: 25, way: "" })
            expect(appLinkTarget(`${scheme}://core?download=selftest&url=file%3A%2F%2Fx`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?download=selftest`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?download=other&url=https%3A%2F%2Fexample.org%2Ff`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?download=selftest&url=https%3A%2F%2Fexample.org%2Ff`, "release")).toBeNull()
            expect(appLinkTarget(`${scheme}://core?extensions=install&url=https%3A%2F%2Fexample.org%2Fm.json`, variant)).toEqual({ kind: "core-install-check", url: "https://example.org/m.json" })
            expect(appLinkTarget(`${scheme}://core?extensions=install&url=file%3A%2F%2Fx`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?streams=mapping&media=21&provider=p&query=dr&entry=ry`, variant)).toEqual({ kind: "core-mapping-check", mediaId: 21, provider: "p", query: "dr", entry: "ry" })
            expect(appLinkTarget(`${scheme}://core?streams=mapping&media=21`, variant)).toBeNull()
            expect(appLinkTarget(`${scheme}://core?streams=check&media=21`, "release")).toBeNull()
            expect(appLinkTarget(`${scheme}://core?cast=discover`, "release")).toBeNull()
            expect(appLinkTarget(`${scheme}://core?cast=outlet-check`, "release")).toBeNull()
            expect(appLinkTarget(`${scheme}://core?manga=check&media=30&provider=p`, "release")).toBeNull()
            expect(appLinkTarget(`${scheme}://core?extensions=install&url=https%3A%2F%2Fexample.org%2Fm.json`, "release")).toBeNull()
            expect(appLinkTarget(`${scheme}://core?streams=mapping&media=21&provider=p`, "release")).toBeNull()
        }
        for (const scheme of ["seanime", "seanime-native", "seanime-scratch"]) {
            for (const query of ["write-account=1234567", "write-account=none", "anilist=down", "anilist=up", "move=again", "sandbox=selftest", "sandbox=practice"]) {
                expect(appLinkTarget(`${scheme}://core?${query}`, "release")).toBeNull()
            }
        }
    })
})

// 4.2.0 E (S22): a client-check link the app could not read went to Home without a word
describe("torrent client-check links", () => {
    const HASH = "c9e15763f722f23e98a29decdfae341b98d53056"
    it("takes each step with its hash", () => {
        expect(appLinkTarget(`seanime-native://core?torrent=client-check&do=remove&hash=${HASH}`, "test"))
            .toEqual({ kind: "core-torrent-client-check", step: "remove", hash: HASH, file: "", peerHost: "", peerPort: 0, folder: "check" })
    })

    it("refuses a link it cannot read with the reason, instead of dropping it", () => {
        expect(appLinkTarget("seanime-native://core?torrent=client-check&do=remove", "test"))
            .toEqual({ kind: "core-check-refused", check: "torrent client-check", reason: "remove needs hash=<40 hex>" })
        expect(appLinkTarget(`seanime-native://core?torrent=client-check&do=delete&hash=${HASH}`, "test"))
            .toEqual({ kind: "core-check-refused", check: "torrent client-check", reason: "unknown step \"delete\"" })
        expect(appLinkTarget("seanime-native://core?torrent=client-check&do=add&peer=127.0.0.1:9&folder=x", "test"))
            .toEqual({ kind: "core-check-refused", check: "torrent client-check", reason: "add needs file=<.torrent base64url> and peer=<IP>:<port>" })
        // the release takes no core link at all
        expect(appLinkTarget(`seanime://core?torrent=client-check&do=remove&hash=${HASH}`, "release")).toBeNull()
    })
})
