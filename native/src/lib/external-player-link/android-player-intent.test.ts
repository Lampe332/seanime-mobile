import { describe, expect, it } from "vitest"
import { androidPlayerLink, parseIntentLink, playerActivityOf } from "./android-player-presets"

describe("external player intent links", () => {
    it("turns a preset link with the stream into a VIEW intent", () => {
        const link = androidPlayerLink("org.videolan.vlc").replace("{url}", "127.0.0.1:43212/api/v1/directstream/stream?id=1")
        expect(parseIntentLink(link)).toEqual({
            data: "http://127.0.0.1:43212/api/v1/directstream/stream?id=1",
            type: "video/*",
            packageName: "org.videolan.vlc",
            className: "org.videolan.vlc.StartActivity",
        })
    })

    it("targets each preset player by its VIEW activity (a package alone would let Android pick any app)", () => {
        expect(parseIntentLink(androidPlayerLink("com.mxtech.videoplayer.ad").replace("{url}", "h/x"))?.className).toBe("com.mxtech.videoplayer.ad.ActivityScreen")
        expect(playerActivityOf("is.xyz.mpv")).toBe("is.xyz.mpv.MPVActivity")
        expect(playerActivityOf("com.brouken.player")).toBe("com.brouken.player.PlayerActivity")
        expect(playerActivityOf("com.example.unknown")).toBeUndefined()
    })

    it("reads the activity of a custom link from its component, and leaves an unknown package to the system", () => {
        expect(parseIntentLink("intent://h/x#Intent;scheme=https;component=com.example.p/.Play;end")).toEqual({
            data: "https://h/x", type: undefined, packageName: "com.example.p", className: "com.example.p.Play",
        })
        expect(parseIntentLink("intent://h/x#Intent;scheme=http;package=com.example.p;end")).toEqual({
            data: "http://h/x", type: undefined, packageName: "com.example.p",
        })
    })

    it("leaves other links alone", () => {
        expect(parseIntentLink("vlc://http://127.0.0.1/x")).toBeNull()
        expect(parseIntentLink("intent://broken")).toBeNull()
    })
})
