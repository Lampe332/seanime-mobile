import { describe, expect, it } from "vitest"
import { playbackInfoSummary, requestErrorSummary, withoutTokens } from "./log-safe"

describe("requestErrorSummary", () => {
    // the shape of an AxiosError: the whole request hangs on it
    const failedLogin = {
        message: "Request failed with status code 500",
        code: "ERR_BAD_RESPONSE",
        config: {
            method: "post",
            url: "http://127.0.0.1:43212/api/v1/auth/login?token=query-secret",
            headers: { "X-Seanime-Token": "password-hash", "X-Seanime-Client-Id-Proof": "proof-secret" },
            data: JSON.stringify({ token: "anilist-secret" }),
        },
        request: { _headers: { "x-seanime-token": "password-hash" } },
        response: { status: 500, data: { error: "could not log in" }, config: { data: JSON.stringify({ token: "anilist-secret" }) } },
    }

    it("keeps what explains the failure", () => {
        expect(requestErrorSummary(failedLogin)).toEqual({
            method: "POST",
            url: "http://127.0.0.1:43212/api/v1/auth/login",
            status: 500,
            code: "ERR_BAD_RESPONSE",
            message: "Request failed with status code 500",
            error: "could not log in",
        })
    })

    it("leaves out the request body, the auth headers and the query", () => {
        const logged = JSON.stringify(requestErrorSummary(failedLogin))
        for (const secret of ["anilist-secret", "password-hash", "proof-secret", "query-secret"]) expect(logged).not.toContain(secret)
    })

    it("copes with errors that are no axios errors", () => {
        expect(requestErrorSummary(new Error("boom")).message).toBe("boom")
        expect(requestErrorSummary(null).message).toBe("null")
        expect(requestErrorSummary({ response: { status: 404, data: "not found" } })).toMatchObject({ status: 404, error: "not found" })
    })
})

describe("withoutTokens", () => {
    it("hides the token of a stream link, plain and URL-encoded, and keeps the rest", () => {
        expect(withoutTokens("http://127.0.0.1:43212/api/v1/mediastream/file?path=abc&token=eyJh.bGc-_9&x=1"))
            .toBe("http://127.0.0.1:43212/api/v1/mediastream/file?path=abc&token=…&x=1")
        expect(withoutTokens("intent://127.0.0.1:43212/stream?token=eyJh.bGc#Intent;scheme=http;end"))
            .toBe("intent://127.0.0.1:43212/stream?token=…#Intent;scheme=http;end")
        expect(withoutTokens("vlc://x?url=http%3A%2F%2F127.0.0.1%2Fs%3Ftoken%3DeyJh.bGc")).toBe("vlc://x?url=http%3A%2F%2F127.0.0.1%2Fs%3Ftoken%3D…")
        expect(withoutTokens("http://127.0.0.1:43212/api/v1/directstream/stream")).toBe("http://127.0.0.1:43212/api/v1/directstream/stream")
    })
})

describe("playbackInfoSummary", () => {
    // the server's "watch" event for a library episode (logcat r17: streamUrl with the server token)
    const watch = {
        id: "abc", streamType: "file", mimeType: "video/x-matroska", contentLength: 123456,
        streamUrl: "http://127.0.0.1:43212/api/v1/directstream/stream?id=abc&token=eyJhbGciOi.secret",
        subtitleTracks: [{ src: "http://127.0.0.1:43212/sub?token=eyJsub" }],
        episode: { episodeNumber: 1 }, media: { id: 105333 }, localFile: { path: "/storage/emulated/0/Anime/Dr. STONE 01.mkv" },
    }

    it("keeps what plays and drops every link", () => {
        expect(playbackInfoSummary(watch)).toEqual({
            id: "abc", streamType: "file", mimeType: "video/x-matroska", contentLength: 123456, mediaId: 105333, episode: 1,
            subtitleTracks: 1, hasStreamUrl: true,
        })
        const text = JSON.stringify(playbackInfoSummary(watch))
        expect(text).not.toMatch(/token|eyJ|http|storage/)
    })
    it("takes anything", () => {
        expect(playbackInfoSummary(null)).toMatchObject({ subtitleTracks: 0, hasStreamUrl: false })
        expect(playbackInfoSummary("x")).toMatchObject({ id: undefined })
    })
})
