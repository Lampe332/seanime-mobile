export type AniSkipEntryLike = {
    interval: {
        startTime: number
        endTime: number
    }
}

export type NormalizedSkipData<T extends AniSkipEntryLike = AniSkipEntryLike> = {
    op: T | null
    ed: T | null
}

const isValidAniSkipTime = (value: number) => Number.isFinite(value) && value >= 0

export function normalizeAniSkipEntry<T extends AniSkipEntryLike>(entry: T | null | undefined): T | null {
    if (!entry) return null

    const { startTime, endTime } = entry.interval
    if (!isValidAniSkipTime(startTime) || !isValidAniSkipTime(endTime) || endTime <= startTime) {
        return null
    }

    return entry
}

export function normalizeAniSkipData<T extends AniSkipEntryLike>(skipData: NormalizedSkipData<T> | undefined): NormalizedSkipData<T> {
    const op = normalizeAniSkipEntry(skipData?.op)
    let ed = normalizeAniSkipEntry(skipData?.ed)

    if (op && ed && ed.interval.startTime <= op.interval.endTime) {
        ed = null
    }

    return { op, ed }
}