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
    errorOfSource,
    isNoEntryFound,
    onlineSourceFailure,
    onlineSourceKey,
} from "./onlinestream-source"

describe("why the chosen episode does not play", () => {
    const en = (english: string) => english
    const none = { noPlayableSource: false, sourceError: false, sourceErrorText: undefined, playbackError: null }
    it("a failed source request without the server's reason shows the cycler's error, else a plain text (never endless loading)", () => {
        expect(onlineSourceFailure({ ...none, sourceError: true, playbackError: "The stream did not start in time. Try another server or provider." }, en))
            .toBe("The stream did not start in time. Try another server or provider.")
        expect(onlineSourceFailure({ ...none, sourceError: true }, en)).toBe("The provider could not load this episode. Try another server or provider.")
        expect(onlineSourceFailure({ ...none, sourceError: true, sourceErrorText: "provider: 404" }, en)).toBe("provider: 404")
    })
    it("a source without a playable video, a playback error, or nothing", () => {
        expect(onlineSourceFailure({ ...none, noPlayableSource: true, playbackError: "x" }, en)).toBe("No playable source. Choose another server or provider.")
        expect(onlineSourceFailure({ ...none, playbackError: "broken" }, en)).toBe("broken")
        expect(onlineSourceFailure(none, en)).toBeNull()
    })
})

describe("Retry source", () => {
    const source = { provider: "p", server: "hd-1", dubbed: false, episode: 3, url: "https://cdn.example/1080.m3u8", attempt: 0 }
    it("is a new source key with the same URL, so the old error goes and the stream loads again", () => {
        const before = onlineSourceKey(source)
        const failed = { key: before, message: "The stream did not start in time." }
        expect(errorOfSource(failed, before)).toBe("The stream did not start in time.")
        const retried = onlineSourceKey({ ...source, attempt: 1 })
        expect(retried).not.toBe(before)
        expect(errorOfSource(failed, retried)).toBeNull()
    })
    it("keeps an error with its own source only", () => {
        expect(errorOfSource(null, onlineSourceKey(source))).toBeNull()
        expect(errorOfSource({ key: onlineSourceKey({ ...source, server: "hd-2" }), message: "x" }, onlineSourceKey(source))).toBeNull()
    })
})

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
        const proxied = buildOnlineStream(withHeaders, "http://127.0.0.1:8080", "&token=abc")
        expect(proxied.url).toBe("http://127.0.0.1:8080/api/v1/proxy?url=" + encodeURIComponent(withHeaders.url)
            + "&headers=" + encodeURIComponent(JSON.stringify(withHeaders.headers)) + "&token=abc")
        expect(proxied.subtitles.map(s => [s.label, s.default, s.src.startsWith("http://127.0.0.1:8080/api/v1/proxy?url=")])).toEqual([
            ["English", false, true], ["German", true, true],
        ])

        const direct = buildOnlineStream(src("720p", { subtitles: [{ url: "https://cdn.example/a.vtt", language: "English", isDefault: false }] }), "http://127.0.0.1:8080", "")
        expect(direct.url).toBe("https://cdn.example/720p.m3u8")
        // without a default flag the first subtitle is the default (web isDefaultSubtitleTrack)
        expect(direct.subtitles[0]).toMatchObject({ src: "https://cdn.example/a.vtt", default: true })
        // through the proxy the player gets no headers of its own
        expect(proxied.headers).toBeUndefined()
        expect(direct.headers).toBeUndefined()
    })

    it("without the proxy (core area \"streams\") hands the provider's addresses and headers to the player", () => {
        const withHeaders = src("1080p", {
            headers: { Referer: "https://site.example/", Origin: "https://site.example" },
            subtitles: [{ url: "https://cdn.example/en.vtt", language: "English", isDefault: true }],
        })
        const stream = buildOnlineStream(withHeaders, "http://127.0.0.1:8080", "", true)
        expect(stream.url).toBe("https://cdn.example/1080p.m3u8")
        expect(stream.subtitles[0].src).toBe("https://cdn.example/en.vtt")
        expect(stream.headers).toEqual({ Referer: "https://site.example/", Origin: "https://site.example" })
        // a source without headers clears the ones of the stream before
        expect(buildOnlineStream(src("720p"), "http://127.0.0.1:8080", "", true).headers).toEqual({})
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

describe("no entry at the provider", () => {
    it("is the core's 404 'no matching entry found' only; other failures stay provider errors", () => {
        const failed = (status: number, error: string) => ({ response: { status, data: { error } } })
        expect(isNoEntryFound(failed(404, "kaa: no matching entry found, choose one by hand"))).toBe(true)
        expect(isNoEntryFound(failed(404, "online stream provider not found: kaa"))).toBe(false)
        expect(isNoEntryFound(failed(500, "kaa: findEpisodes failed: the site changed"))).toBe(false)
        expect(isNoEntryFound(new Error("Network Error"))).toBe(false)
        expect(isNoEntryFound(null)).toBe(false)
    })
})
