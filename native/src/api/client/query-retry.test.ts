import { describe, expect, it } from "vitest"
import { QUERY_RETRY_DELAY_MS, shouldRetryQuery } from "./query-retry"

const withStatus = (status: number) => ({ response: { status } })

describe("query retry", () => {
    it("retries a failed read once", () => {
        expect(shouldRetryQuery(0, new Error("Network Error"))).toBe(true)
        expect(shouldRetryQuery(1, new Error("Network Error"))).toBe(false)
        expect(shouldRetryQuery(0, withStatus(500))).toBe(true)
        expect(shouldRetryQuery(0, withStatus(502))).toBe(true)
        expect(QUERY_RETRY_DELAY_MS).toBeLessThanOrEqual(2000)
    })

    it("does not retry answers that stay the same: 4xx, auth, rate limit, missing core code", () => {
        for (const status of [400, 401, 403, 404, 429, 501, 503]) {
            expect(shouldRetryQuery(0, withStatus(status))).toBe(false)
        }
    })
})
