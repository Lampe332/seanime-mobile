import { estimateDownload, etaLabel } from "@/app/(main)/entry/_containers/torrent-stream/_lib/download-eta"
import { describe, expect, it } from "vitest"

const MB = 1_000_000
const de = (_en: string, de: string) => de

describe("estimateDownload", () => {
    it("has no estimate before a second report", () => {
        expect(estimateDownload(null, 200 * MB, 20, 0).eta).toBeNull()
    })

    it("estimates from the bytes gained between reports", () => {
        const first = estimateDownload(null, 200 * MB, 20, 0)
        const second = estimateDownload(first.sample, 210 * MB, 21, 1000)
        // 10 MB/s, 1000 MB total, 790 MB left
        expect(second.sample.rate).toBeCloseTo(10 * MB)
        expect(second.eta).toBeCloseTo(79)
    })

    it("smooths a sudden change in speed", () => {
        const a = estimateDownload(null, 0, 1, 0)
        const b = estimateDownload(a.sample, 10 * MB, 2, 1000)
        const c = estimateDownload(b.sample, 40 * MB, 4, 2000)
        expect(c.sample.rate).toBeCloseTo(16 * MB)
    })

    it("stops estimating once the file is complete", () => {
        const a = estimateDownload(null, 900 * MB, 90, 0)
        expect(estimateDownload(a.sample, 1000 * MB, 100, 1000).eta).toBeNull()
    })
})

describe("etaLabel", () => {
    it("reads naturally", () => {
        expect(etaLabel(30, de)).toBe("< 1 Min. übrig")
        expect(etaLabel(79, de)).toBe("≈ 1 Min. übrig")
        expect(etaLabel(3 * 3600 + 20 * 60, de)).toBe("≈ 3 Std. 20 Min. übrig")
    })
})
