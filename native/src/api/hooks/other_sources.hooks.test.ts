import { describe, expect, it } from "vitest"
import { matchCoreRoute } from "@/core/registry"
import { otherSourcesSearchRequest } from "./other_sources.hooks"

describe("the search in the other sources", () => {
    it("asks the core's route with the trimmed query", () => {
        const request = otherSourcesSearchRequest("  Dreamland ")
        expect(matchCoreRoute(request.method, request.endpoint)).toBeTruthy()
        expect(request).toMatchObject({ method: "POST", data: { query: "Dreamland" }, enabled: true, muteError: true })
        // the same title in other letters is the same question
        expect(otherSourcesSearchRequest("dreamland").queryKey).toEqual(request.queryKey)
    })

    it("does not ask without a query or when switched off", () => {
        expect(otherSourcesSearchRequest("   ").enabled).toBe(false)
        expect(otherSourcesSearchRequest("Dreamland", false).enabled).toBe(false)
    })
})
