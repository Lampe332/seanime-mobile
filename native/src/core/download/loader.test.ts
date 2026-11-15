// geschrieben nach: docs/EIGENER-KERN.md §4o (nativer Lader, Phase 4b-A); kein Server-Quelltext
import { describe, expect, it } from "vitest"
import { type LoaderRequest, type LoaderStatus, continuedRequest, rangeOutcome, readLoaderEvent, readLoaderStatus, worthAnotherTry } from "./loader"

const request: LoaderRequest = { id: "a", url: "https://example.org/file.bin", headers: { Referer: "https://example.org/" }, path: "/data/x/file.bin", title: "File" }

function status(change: Partial<LoaderStatus>): LoaderStatus {
    return { id: "a", state: "cancelled", bytes: 1000, total: 4000, validator: "\"v1\"", failure: null, ...change }
}

describe("the loader's events", () => {
    it("reads progress, with an unknown total as null", () => {
        expect(readLoaderEvent("progress", { id: "a", bytes: 10.9, total: 40 })).toEqual({ type: "progress", id: "a", bytes: 10, total: 40 })
        expect(readLoaderEvent("progress", { id: "a", bytes: 10, total: 0 })).toEqual({ type: "progress", id: "a", bytes: 10, total: null })
        expect(readLoaderEvent("progress", { id: "a", bytes: -1, total: 40 })).toBeNull()
        expect(readLoaderEvent("progress", { id: "a", bytes: Number.NaN })).toBeNull()
    })

    it("reads done, never with more kept bytes than the file has", () => {
        expect(readLoaderEvent("done", { id: "a", bytes: 4000, resumedFrom: 1000 })).toEqual({ type: "done", id: "a", bytes: 4000, resumedFrom: 1000 })
        expect(readLoaderEvent("done", { id: "a", bytes: 4000 })).toEqual({ type: "done", id: "a", bytes: 4000, resumedFrom: 0 })
        expect(readLoaderEvent("done", { id: "a", bytes: 4000, resumedFrom: 9000 })).toEqual({ type: "done", id: "a", bytes: 4000, resumedFrom: 4000 })
        expect(readLoaderEvent("done", { id: "a" })).toBeNull()
    })

    it("reads failed, an unknown kind as UNKNOWN and status 0 as none", () => {
        expect(readLoaderEvent("failed", { id: "a", kind: "SOURCE_REFUSED", httpStatus: 403, message: "HTTP 403" })).toEqual({ type: "failed", id: "a", kind: "SOURCE_REFUSED", httpStatus: 403, message: "HTTP 403" })
        expect(readLoaderEvent("failed", { id: "a", kind: "CONNECTION", httpStatus: 0, message: "timeout" })).toEqual({ type: "failed", id: "a", kind: "CONNECTION", httpStatus: null, message: "timeout" })
        expect(readLoaderEvent("failed", { id: "a", kind: "SOMETHING_NEW", message: 5 })).toEqual({ type: "failed", id: "a", kind: "UNKNOWN", httpStatus: null, message: "" })
        for (const kind of ["STORAGE_FULL", "CANCELLED", "UNKNOWN"] as const) expect(readLoaderEvent("failed", { id: "a", kind })).toMatchObject({ kind })
    })

    it("drops what is not an event of a download", () => {
        expect(readLoaderEvent("progress", null)).toBeNull()
        expect(readLoaderEvent("progress", [1])).toBeNull()
        expect(readLoaderEvent("progress", { bytes: 1 })).toBeNull()
        expect(readLoaderEvent("done", { id: "", bytes: 1 })).toBeNull()
        expect(readLoaderEvent("other", { id: "a", bytes: 1 })).toBeNull()
    })
})

describe("the loader's status", () => {
    it("reads a download on its way", () => {
        expect(readLoaderStatus({ id: "a", state: "running", bytes: 1000, total: 4000, validator: "\"v1\"", kind: "", httpStatus: 0, message: "" }))
            .toEqual({ id: "a", state: "running", bytes: 1000, total: 4000, validator: "\"v1\"", failure: null })
        expect(readLoaderStatus({ id: "a", state: "interrupted", bytes: 1000, total: 0, validator: "" }))
            .toEqual({ id: "a", state: "interrupted", bytes: 1000, total: null, validator: null, failure: null })
    })

    it("carries the failure only for a failed one and for a stop by the user", () => {
        expect(readLoaderStatus({ id: "a", state: "failed", bytes: 0, total: 0, kind: "SOURCE_REFUSED", httpStatus: 404, message: "HTTP 404" })?.failure)
            .toEqual({ kind: "SOURCE_REFUSED", httpStatus: 404, message: "HTTP 404" })
        expect(readLoaderStatus({ id: "a", state: "cancelled", bytes: 5, kind: "CANCELLED", message: "stopped" })?.failure).toEqual({ kind: "CANCELLED", httpStatus: null, message: "stopped" })
        // a record that failed once and was cancelled by the app later still has the old kind: not a failure
        expect(readLoaderStatus({ id: "a", state: "cancelled", bytes: 5, kind: "CONNECTION" })?.failure).toBeNull()
        expect(readLoaderStatus({ id: "a", state: "done", bytes: 5, kind: "CONNECTION" })?.failure).toBeNull()
    })

    it("knows no state of its own invention", () => {
        expect(readLoaderStatus(null)).toBeNull()
        expect(readLoaderStatus({ id: "a", state: "paused", bytes: 1 })).toBeNull()
        expect(readLoaderStatus({ state: "done", bytes: 1 })).toBeNull()
    })
})

describe("going on after a stop", () => {
    it("keeps the part on disk and sends the source's mark along", () => {
        expect(continuedRequest(request, status({}))).toEqual({ ...request, resumeFrom: 1000, ifRange: "\"v1\"" })
        expect(continuedRequest(request, status({ state: "interrupted", validator: null }))).toEqual({ ...request, resumeFrom: 1000 })
        expect(continuedRequest(request, status({ state: "failed", total: null }))).toEqual({ ...request, resumeFrom: 1000, ifRange: "\"v1\"" })
        // the whole file is on disk: the loader asks and the source answers 416 with the same length
        expect(continuedRequest(request, status({ bytes: 4000 }))).toEqual({ ...request, resumeFrom: 4000, ifRange: "\"v1\"" })
    })

    it("starts from the beginning when there is nothing to keep", () => {
        expect(continuedRequest(request, null)).toEqual(request)
        expect(continuedRequest(request, status({ bytes: 0 }))).toEqual(request)
        expect(continuedRequest(request, status({ bytes: 5000 }))).toEqual(request)
        expect(continuedRequest(request, status({ state: "done" }))).toEqual(request)
        expect(continuedRequest(request, status({ state: "running" }))).toEqual(request)
        expect(continuedRequest(request, status({ id: "b" }))).toEqual(request)
    })

    it("drops an older offset of the request itself", () => {
        expect(continuedRequest({ ...request, resumeFrom: 77, ifRange: "\"old\"" }, null)).toEqual(request)
        expect(continuedRequest({ ...request, resumeFrom: 77, ifRange: "\"old\"" }, status({ validator: null }))).toEqual({ ...request, resumeFrom: 1000 })
    })

    it("names what the source made of the range", () => {
        expect(rangeOutcome(0, { resumedFrom: 0 })).toBe("whole")
        expect(rangeOutcome(1000, { resumedFrom: 1000 })).toBe("continued")
        // 200 instead of 206: a source without ranges, or the file changed (If-Range)
        expect(rangeOutcome(1000, { resumedFrom: 0 })).toBe("started-over")
    })
})

describe("whether another try is worth it", () => {
    it("says yes to a broken connection and to refusals of the moment", () => {
        expect(worthAnotherTry({ kind: "CONNECTION", httpStatus: null })).toBe(true)
        for (const httpStatus of [408, 425, 429, 500, 502, 503, 504]) expect(worthAnotherTry({ kind: "SOURCE_REFUSED", httpStatus }), String(httpStatus)).toBe(true)
    })

    it("says no to refusals of the address, a full storage, a stop by the user and the unknown", () => {
        for (const httpStatus of [400, 401, 403, 404, 410, 416]) expect(worthAnotherTry({ kind: "SOURCE_REFUSED", httpStatus }), String(httpStatus)).toBe(false)
        expect(worthAnotherTry({ kind: "SOURCE_REFUSED", httpStatus: null })).toBe(false)
        expect(worthAnotherTry({ kind: "STORAGE_FULL", httpStatus: null })).toBe(false)
        expect(worthAnotherTry({ kind: "CANCELLED", httpStatus: null })).toBe(false)
        expect(worthAnotherTry({ kind: "UNKNOWN", httpStatus: null })).toBe(false)
    })
})
