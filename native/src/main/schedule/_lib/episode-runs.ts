import type { Translate } from "@/lib/app-language"

/**
 * Episodes of one show released together (a batch drop: episodes 4 to 11 at 9:00) as one row, for Discover's schedule
 * tab and the schedule screen. Only the same show at the same time with episode numbers without a gap form a run;
 * everything else stays a row of its own. The rows keep the order of the first episode of each run.
 */

export type EpisodeRun<T> = { key: string, items: T[], from: number, to: number }

export type RunKey = { show: number | string, at: number | string, episode: number }

export function groupEpisodeRuns<T>(items: readonly T[], keyOf: (item: T) => RunKey): EpisodeRun<T>[] {
    const buckets = new Map<string, { item: T, episode: number, index: number }[]>()
    items.forEach((item, index) => {
        const key = keyOf(item)
        const bucket = `${key.show}@${key.at}`
        if (!buckets.has(bucket)) buckets.set(bucket, [])
        buckets.get(bucket)!.push({ item, episode: key.episode, index })
    })
    const runs: (EpisodeRun<T> & { index: number })[] = []
    for (const [bucket, entries] of buckets) {
        const sorted = [...entries].sort((a, b) => a.episode - b.episode || a.index - b.index)
        let run: (EpisodeRun<T> & { index: number }) | null = null
        for (const entry of sorted) {
            if (run && entry.episode === run.to + 1) {
                run.items.push(entry.item)
                run.to = entry.episode
                run.index = Math.min(run.index, entry.index)
                continue
            }
            run = { key: `${bucket}#${entry.episode}`, items: [entry.item], from: entry.episode, to: entry.episode, index: entry.index }
            runs.push(run)
        }
    }
    return runs.sort((a, b) => a.index - b.index).map(run => ({ key: run.key, items: run.items, from: run.from, to: run.to }))
}

/** "Episode 5" / "Folge 5", a run "Episodes 4–11" / "Folgen 4–11" */
export function episodeRunLabel(t: Translate, run: { from: number, to: number }) {
    return run.from === run.to ? t(`Episode ${run.from}`, `Folge ${run.from}`) : t(`Episodes ${run.from}–${run.to}`, `Folgen ${run.from}–${run.to}`)
}
