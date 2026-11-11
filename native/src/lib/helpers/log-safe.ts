/*
 * What may go into the log (Logcat, bug reports). console.log prints an object with everything in it, and an axios
 * error carries its request: the auth headers (server password hash, client proof) and the body (the AniList token at
 * login, a debrid key in the settings, the Nakama passcode).
 */

type RequestError = {
    message?: unknown
    code?: unknown
    config?: { method?: unknown, url?: unknown } | null
    response?: { status?: unknown, data?: unknown } | null
}

/** A failed request for the log: method, address without its query, status and the server's error text; never the request. */
export function requestErrorSummary(error: unknown) {
    const e = (error && typeof error === "object" ? error : {}) as RequestError
    const data = e.response?.data
    const serverError = typeof data === "string" ? data : (data as { error?: unknown } | null | undefined)?.error
    return {
        method: typeof e.config?.method === "string" ? e.config.method.toUpperCase() : undefined,
        url: typeof e.config?.url === "string" ? e.config.url.split("?")[0] : undefined,
        status: typeof e.response?.status === "number" ? e.response.status : undefined,
        code: typeof e.code === "string" ? e.code : undefined,
        message: typeof e.message === "string" ? e.message : String(error),
        error: typeof serverError === "string" ? serverError.slice(0, 500) : undefined,
    }
}

type PlaybackInfoLike = {
    id?: unknown
    streamType?: unknown
    mimeType?: unknown
    contentLength?: unknown
    streamUrl?: unknown
    subtitleTracks?: unknown
    episode?: { episodeNumber?: unknown } | null
    media?: { id?: unknown } | null
}

/**
 * The server's "watch" event for the log: what plays, never where from. The stream link carries the server's `token`
 * (library streams) or a debrid/provider address, the subtitle tracks their own links.
 */
export function playbackInfoSummary(payload: unknown) {
    const p = (payload && typeof payload === "object" ? payload : {}) as PlaybackInfoLike
    return {
        id: typeof p.id === "string" ? p.id : undefined,
        streamType: typeof p.streamType === "string" ? p.streamType : undefined,
        mimeType: typeof p.mimeType === "string" ? p.mimeType : undefined,
        contentLength: typeof p.contentLength === "number" ? p.contentLength : undefined,
        mediaId: typeof p.media?.id === "number" ? p.media.id : undefined,
        episode: typeof p.episode?.episodeNumber === "number" ? p.episode.episodeNumber : undefined,
        subtitleTracks: Array.isArray(p.subtitleTracks) ? p.subtitleTracks.length : 0,
        hasStreamUrl: typeof p.streamUrl === "string" && p.streamUrl.length > 0,
    }
}

/** A link for the log without the value of its `token` (the stream links handed to a player app carry one), also URL-encoded. */
export function withoutTokens(text: string): string {
    return text.replace(/(token(?:=|%3D))[A-Za-z0-9._~%-]+/gi, "$1…")
}
