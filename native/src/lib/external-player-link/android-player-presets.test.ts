import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ANDROID_PLAYER_PRESETS, androidPlayerLink, androidPlayerPresetOf, parseIntentLink, playerActivityOf, toggledPlayerLink } from "./android-player-presets"
import { ExternalPlayerLink } from "./external-player-link"

beforeEach(() => { vi.stubGlobal("window", { location: { protocol: "http:", host: "127.0.0.1:8080", hostname: "127.0.0.1" } }) })
afterEach(() => { vi.unstubAllGlobals() })

describe("Android external player presets", () => {
    it("send the stream to the player app as an http intent", () => {
        const link = new ExternalPlayerLink(androidPlayerLink("org.videolan.vlc"))
        link.setUrl("http://127.0.0.1:8080/api/v1/mediastream/file?path=abc&token=x")
        expect(link.getFullUrl()).toBe("intent://127.0.0.1:8080/api/v1/mediastream/file?path=abc&token=x#Intent;scheme=http;type=video/*;package=org.videolan.vlc;end")
    })
    it("a stream address cannot name another app, activity or scheme: only the link's own #Intent part counts", () => {
        const link = new ExternalPlayerLink(androidPlayerLink("org.videolan.vlc"))
        link.setUrl("https://stream.example/video.mp4#Intent;component=com.other.app/.Hidden;package=com.other.app;scheme=content;type=text/html;end")
        const intent = parseIntentLink(link.getFullUrl())
        expect(intent).toEqual({
            data: "http://stream.example/video.mp4#Intent;component=com.other.app/.Hidden;package=com.other.app;scheme=content;type=text/html;end",
            type: "video/*",
            packageName: "org.videolan.vlc",
            className: playerActivityOf("org.videolan.vlc"),
        })
    })
    it("still reads a link's own component and package", () => {
        expect(parseIntentLink("intent://192.0.2.5:8080/a.mkv#Intent;scheme=http;type=video/*;component=is.xyz.mpv/.MPVActivity;end")).toEqual({
            data: "http://192.0.2.5:8080/a.mkv", type: "video/*", packageName: "is.xyz.mpv", className: "is.xyz.mpv.MPVActivity",
        })
        expect(parseIntentLink("vlc://http://192.0.2.5/a.mkv")).toBeNull()
    })
    it("name the packages of VLC, MX Player, mpv and Just Player", () => {
        expect(ANDROID_PLAYER_PRESETS.map(preset => preset.packageName)).toEqual(["org.videolan.vlc", "com.mxtech.videoplayer.ad", "is.xyz.mpv", "com.brouken.player"])
    })
    it("recognise a saved preset and nothing else", () => {
        expect(androidPlayerPresetOf(androidPlayerLink("is.xyz.mpv"))?.name).toBe("mpv")
        expect(androidPlayerPresetOf("outplayer://{url}")).toBeUndefined()
        expect(androidPlayerPresetOf("")).toBeUndefined()
    })
    it("tapping the chosen player again chooses none, another player or an own link switches", () => {
        const vlc = androidPlayerLink("org.videolan.vlc")
        expect(toggledPlayerLink("", "org.videolan.vlc")).toBe(vlc)
        expect(toggledPlayerLink(vlc, "org.videolan.vlc")).toBe("")
        expect(toggledPlayerLink(vlc, "is.xyz.mpv")).toBe(androidPlayerLink("is.xyz.mpv"))
        expect(toggledPlayerLink("outplayer://{url}", "org.videolan.vlc")).toBe(vlc)
    })
})

describe("text placeholders in an own intent:// link", () => {
    const own = "intent://{url}#Intent;scheme=http;type=video/*;package=org.videolan.vlc;S.title={mediaTitle};S.sub={subtitleUrl};S.name={formattedTitle};end"

    it("a title or subtitle address cannot add a field", () => {
        const link = new ExternalPlayerLink(own)
        link.setUrl("http://127.0.0.1:8080/a.mkv")
        link.setMediaTitle("Show;package=evil;end")
        link.setEpisodeNumber(3)
        link.setSubtitleUrls(["http://127.0.0.1:8080/s.vtt#Intent;component=com.evil/.X;end"])
        const full = link.getFullUrl()
        expect(full).toBe("intent://127.0.0.1:8080/a.mkv#Intent;scheme=http;type=video/*;package=org.videolan.vlc;S.title=Show%3Bpackage=evil%3Bend;S.sub=http://127.0.0.1:8080/s.vtt%23Intent%3Bcomponent=com.evil/.X%3Bend;S.name=Episode 3 - Show%3Bpackage=evil%3Bend;end")
        expect(parseIntentLink(full)).toEqual({
            data: "http://127.0.0.1:8080/a.mkv",
            type: "video/*",
            packageName: "org.videolan.vlc",
            className: playerActivityOf("org.videolan.vlc"),
        })
    })
    it("other links keep the title as it is", () => {
        const link = new ExternalPlayerLink("outplayer://{url}&title={mediaTitle}")
        link.setUrl("http://127.0.0.1:8080/a.mkv")
        link.setMediaTitle("A;B#C")
        expect(link.getFullUrl()).toBe("outplayer://http://127.0.0.1:8080/a.mkv&title=A;B#C")
    })
})
