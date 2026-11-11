import type { AL_BaseAnime, Onlinestream_Episode, Onlinestream_EpisodeSource, Onlinestream_VideoSource } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import {
    buildOnlineStream,
    chooseVideoSource,
    episodeServers,
    needsProxy,
    onlineDownloadRequest,
    playableVideoSources,
    preferredOnlineSubtitle,
} from "./onlinestream-source"

const src = (quality: string, extra: Partial<Onlinestream_VideoSource> = {}): Onlinestream_VideoSource =>
    ({ server: "hd-1", url: `https://cdn.example/${quality}.m3u8`, quality, type: "m3u8", ...extra })

describe("online stream sources", () => {
    it("keeps only playable, distinct sources of the server and lists every server", () => {
        const source: Onlinestream_EpisodeSource = {
            number: 1,
            servers: [{ server: "hd-2", status: "unavailable", error: "embed only" }],
            videoSources: [src("1080p"), src("1080p"), src("720p", { url: " " }), src("720p", { server: "hd-3" })],
        }
        expect(playableVideoSources(source, "hd-1").map(s => s.quality)).toEqual(["1080p"])
        expect(episodeServers(source)).toEqual(["hd-2", "hd-1", "hd-3"])
        expect(episodeServers(undefined)).toEqual([])
    })

    it("picks the stored quality, then its resolution, then auto, then the best one", () => {
        const sources = [src("360p"), src("720p - Group"), src("1080p"), src("auto")]
        expect(chooseVideoSource(sources, "hd-1", "720P - group")?.quality).toBe("720p - Group")
        expect(chooseVideoSource(sources, "hd-1", "720p - Other")?.quality).toBe("720p - Group")
        expect(chooseVideoSource(sources, "hd-1", "480p")?.quality).toBe("auto")
        expect(chooseVideoSource([src("360p"), src("1080p")], "hd-1", undefined)?.quality).toBe("1080p")
        expect(chooseVideoSource([src("720p"), src("720p default")], "hd-1", undefined)?.quality).toBe("720p default")
        expect(chooseVideoSource([], "hd-1", "1080p")).toBeUndefined()
    })

    it("plays sources with headers through the proxy with the token, others directly", () => {
        const withHeaders = src("1080p", {
            headers: { Referer: "https://site.example/" },
            subtitles: [{ url: "https://cdn.example/en.vtt", language: "English", isDefault: false }, { url: "https://cdn.example/de.vtt", language: "German", isDefault: true }],
        })
        expect(needsProxy(withHeaders)).toBe(true)
        const proxied = buildOnlineStream(withHeaders, "http://127.0.0.1:43212", "&token=abc")
        expect(proxied.url).toBe("http://127.0.0.1:43212/api/v1/proxy?url=" + encodeURIComponent(withHeaders.url)
            + "&headers=" + encodeURIComponent(JSON.stringify(withHeaders.headers)) + "&token=abc")
        expect(proxied.subtitles.map(s => [s.label, s.default, s.src.startsWith("http://127.0.0.1:43212/api/v1/proxy?url=")])).toEqual([
            ["English", false, true], ["German", true, true],
        ])

        const direct = buildOnlineStream(src("720p", { subtitles: [{ url: "https://cdn.example/a.vtt", language: "English", isDefault: false }] }), "http://127.0.0.1:43212", "")
        expect(direct.url).toBe("https://cdn.example/720p.m3u8")
        // without a default flag the first subtitle is the default (web isDefaultSubtitleTrack)
        expect(direct.subtitles[0]).toMatchObject({ src: "https://cdn.example/a.vtt", default: true })
    })

    it("saves an episode from the provider URL, never the player's proxy URL with the token", () => {
        const media = { id: 21, title: { userPreferred: "One Piece" }, coverImage: { large: "https://img/c.jpg" }, bannerImage: "https://img/b.jpg" } as AL_BaseAnime
        const episode: Onlinestream_Episode = { number: 7, title: "Seven", image: "https://img/e7.jpg", description: "…" }
        const source = src("1080p", { headers: { Referer: "https://site.example/" }, subtitles: [{ url: "https://cdn.example/en.vtt", language: "English", isDefault: true }] })
        const request = onlineDownloadRequest({ media, episode, source, dubbed: true })
        expect(request).toMatchObject({
            url: "https://cdn.example/1080p.m3u8", type: "m3u8", headers: { Referer: "https://site.example/" }, mediaId: 21, episode: "7", dubbed: true,
            quality: "1080p", title: "One Piece", coverUrl: "https://img/c.jpg", bannerUrl: "https://img/b.jpg", episodeTitle: "Seven",
            episodeImageUrl: "https://img/e7.jpg", subtitles: [{ url: "https://cdn.example/en.vtt", language: "English", isDefault: true }],
        })
        expect(JSON.stringify(request)).not.toMatch(/token|\/api\/v1\/proxy|127\.0\.0\.1/)
        expect(onlineDownloadRequest({ media, episode: { number: 5.5 }, source, dubbed: false })).toBeNull()
        expect(onlineDownloadRequest({ media, episode, source: src("720p", { type: "mp4", url: "https://cdn.example/a.mp4" }), dubbed: false })?.type).toBe("mp4")
    })

    it("applies the subtitle saved for the anime once mpv lists the tracks", () => {
        const tracks = [
            { id: 1, type: "audio", lang: "jpn", title: "" },
            { id: 1, type: "sub", lang: "English", title: "English" },
            { id: 2, type: "sub", lang: "German", title: "German" },
        ]
        expect(preferredOnlineSubtitle(tracks, { language: "german", label: "German" })).toBe(2)
        expect(preferredOnlineSubtitle(tracks, { off: true })).toBe(-1)
        // nothing saved or nothing matching: the player's usual choice runs
        expect(preferredOnlineSubtitle(tracks, undefined)).toBeNull()
        expect(preferredOnlineSubtitle(tracks, { language: "French" })).toBeNull()
    })
})
