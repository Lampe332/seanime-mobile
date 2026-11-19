// geschrieben nach: S22 device test 4.2.0 E (five `core?torrent=client-check&do=remove` links in a row, only the first acted)

/**
 * Test links that change something (test and scratch app) run one after another: a link that comes while the one
 * before still runs (a removal waits until its files are gone) waits for its turn instead of running into it. `onWait`
 * hears how many runs are ahead (0: it runs at once), so the log shows every link that arrived. A run that fails does
 * not stop the ones after it.
 */
export function inTurns() {
    let last: Promise<unknown> = Promise.resolve()
    let ahead = 0
    return <Result>(work: () => Promise<Result>, onWait: (ahead: number) => void): Promise<Result> => {
        onWait(ahead)
        ahead++
        const run = last.then(work).finally(() => {
            ahead--
        })
        last = run.catch(() => undefined)
        return run
    }
}
