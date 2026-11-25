import { describe, expect, it } from "vitest"
import { type MediaServerStatus, readingFinished, STATUS_READING_POLL_MS, statusRefetchInterval } from "./mediaserver.hooks"

const status = (reading: boolean): MediaServerStatus => ({
    signedIn: true, serverName: "Made", username: "made", url: "https://media.example", sendProgress: true,
    reading, series: reading ? 0 : 4, matched: reading ? 0 : 2, unmatched: [], leftOutSeries: 0, leftOut: [], lastReadAt: reading ? null : 1, problem: "",
})

describe("the media server status on the settings page", () => {
    it("is asked again every two seconds while the server is read, and no more once it is done", () => {
        expect(STATUS_READING_POLL_MS).toBe(2000)
        expect(statusRefetchInterval(status(true))).toBe(STATUS_READING_POLL_MS)
        expect(statusRefetchInterval(status(false))).toBe(false)
        expect(statusRefetchInterval(undefined)).toBe(false)
    })

    it("reloads the library only when a running reading ends", () => {
        expect(readingFinished(true, false)).toBe(true)
        expect(readingFinished(true, true)).toBe(false)
        expect(readingFinished(false, false)).toBe(false)
        expect(readingFinished(false, true)).toBe(false)
    })
})
