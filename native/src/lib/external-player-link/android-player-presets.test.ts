import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ANDROID_PLAYER_PRESETS, androidPlayerLink, androidPlayerPresetOf, toggledPlayerLink } from "./android-player-presets"
import { ExternalPlayerLink } from "./external-player-link"

beforeEach(() => { vi.stubGlobal("window", { location: { protocol: "http:", host: "127.0.0.1:8080", hostname: "127.0.0.1" } }) })
afterEach(() => { vi.unstubAllGlobals() })

describe("Android external player presets", () => {
    it("send the stream to the player app as an http intent", () => {
        const link = new ExternalPlayerLink(androidPlayerLink("org.videolan.vlc"))
        link.setUrl("http://127.0.0.1:8080/api/v1/mediastream/file?path=abc&token=x")
        expect(link.getFullUrl()).toBe("intent://127.0.0.1:8080/api/v1/mediastream/file?path=abc&token=x#Intent;scheme=http;type=video/*;package=org.videolan.vlc;end")
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
