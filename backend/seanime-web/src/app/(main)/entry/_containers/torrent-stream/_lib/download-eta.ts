import type { Translate } from "@/lib/app-language"

export type DownloadSample = { bytes: number, at: number, rate: number }

/**
 * Seconds until the file is complete. The server reports the downloaded bytes and the percentage about once a second;
 * the rate is smoothed so the estimate does not jump with every update. Null until a rate is known.
 */
export function estimateDownload(prev: DownloadSample | null, bytes: number, percent: number, now: number) {
    let rate = prev?.rate ?? 0
    if (prev && now > prev.at && bytes >= prev.bytes) {
        const current = (bytes - prev.bytes) / ((now - prev.at) / 1000)
        rate = prev.rate > 0 ? prev.rate * 0.7 + current * 0.3 : current
    }
    const sample: DownloadSample = { bytes, at: now, rate }
    if (percent <= 0 || percent >= 100 || rate <= 0) return { sample, eta: null }
    const total = bytes * 100 / percent
    return { sample, eta: Math.max(0, (total - bytes) / rate) }
}

export function etaLabel(seconds: number, tr: Translate) {
    if (seconds < 60) return tr("< 1 min left", "< 1 Min. übrig")
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return tr(`≈ ${minutes} min left`, `≈ ${minutes} Min. übrig`)
    const hours = Math.floor(minutes / 60)
    return tr(`≈ ${hours} h ${minutes % 60} min left`, `≈ ${hours} Std. ${minutes % 60} Min. übrig`)
}
