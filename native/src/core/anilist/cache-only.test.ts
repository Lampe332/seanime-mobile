import { describe, expect, it } from "vitest"
import { matchCoreRoute } from "../registry"
import { afterAnilist, anilistWorking, mayAskAnilist, newCacheOnly, toggleCacheOnly } from "./cache-only"
import { type AnilistClient, type HttpFetch, AnilistFailure, askAnilist, newRateLimit } from "./client"

const QUERY = "query { Viewer { id } }"

function clientWith(status: number | "offline", cacheOnly = newCacheOnly()) {
    const sent: string[] = []
    const fetch: HttpFetch = async (_url, init) => {
        sent.push(init.body ?? "")
        if (status === "offline") throw new Error("network down")
        return { status, headers: { get: () => null }, text: async () => status < 500 ? JSON.stringify({ data: { Viewer: { id: 1 } } }) : "down" }
    }
    const client: AnilistClient = { fetch, token: async () => null, now: () => 1_000, rateLimit: newRateLimit(), cacheOnly }
    return { client, sent, cacheOnly }
}

describe("cache-only mode", () => {
    it("the switch turns it on and off; GET answers false while it is on", () => {
        const state = newCacheOnly()
        expect(anilistWorking(state)).toBe(true)
        expect(toggleCacheOnly(state)).toBe(false)
        expect(mayAskAnilist(state)).toBe(false)
        expect(toggleCacheOnly(state)).toBe(true)
        expect(mayAskAnilist(state)).toBe(true)
    })

    it("turned on by the user, nothing goes to AniList", async () => {
        const { client, sent, cacheOnly } = clientWith(200)
        toggleCacheOnly(cacheOnly)
        await expect(askAnilist(client, QUERY, {})).rejects.toBeInstanceOf(AnilistFailure)
        expect(sent).toHaveLength(0)
        toggleCacheOnly(cacheOnly)
        await expect(askAnilist(client, QUERY, {})).resolves.toEqual({ Viewer: { id: 1 } })
        expect(sent).toHaveLength(1)
    })

    it("turns on by itself when AniList fails and off once it answers; turning it off ends it", async () => {
        const offline = clientWith("offline")
        await expect(askAnilist(offline.client, QUERY, {})).rejects.toBeInstanceOf(AnilistFailure)
        expect(anilistWorking(offline.cacheOnly)).toBe(false)
        // still asked (not by the user): the next answer ends it
        const back = clientWith(200, offline.cacheOnly)
        await askAnilist(back.client, QUERY, {})
        expect(back.sent).toHaveLength(1)
        expect(anilistWorking(offline.cacheOnly)).toBe(true)

        const down = clientWith(502)
        await expect(askAnilist(down.client, QUERY, {})).rejects.toBeInstanceOf(AnilistFailure)
        expect(toggleCacheOnly(down.cacheOnly)).toBe(true)
    })

    it("the rate limit says nothing about AniList working", () => {
        const state = newCacheOnly()
        afterAnilist(state, 503)
        afterAnilist(state, 429)
        expect(anilistWorking(state)).toBe(false)
        afterAnilist(state, 404)
        expect(anilistWorking(state)).toBe(true)
    })

    it("the core answers the settings' switch (GET and POST /api/v1/anilist/cache-layer/status)", async () => {
        const get = matchCoreRoute("GET", "/api/v1/anilist/cache-layer/status")
        const post = matchCoreRoute("POST", "/api/v1/anilist/cache-layer/status")
        expect(get && post).toBeTruthy()
        const request = { path: {}, query: null, body: undefined }
        const environment = {} as Parameters<NonNullable<typeof get>["route"]["answer"]>[1]
        const before = await get!.route.answer(request, environment)
        expect(await post!.route.answer(request, environment)).toBe(!before)
        expect(await get!.route.answer(request, environment)).toBe(!before)
        expect(await post!.route.answer(request, environment)).toBe(before)
    })
})
