// geschrieben nach: Plan „Eigener Kern" Stufe 1c (nichts über 8 ms am Stück im Faden der Oberfläche) und docs/EIGENER-KERN.md §4b; eigene Messung, keine Vorlage

/*
 * The core runs on the thread that also runs the screens' logic. This watch measures how long the core holds that
 * thread in one piece, so a call that grows too heavy is seen (and the core can move to a thread of its own before a
 * screen stutters).
 *
 * A piece starts when core code starts running and ends where it really waits: for the network, the server or a
 * statement of the database, or at the end of the call. Those waits are the functions wrapped with `waiting`. Only what
 * really waits may be wrapped: waiting for something that is already there (a statement run on the calling thread) does
 * not free the thread, the code after it runs at once, and so it has to count into the piece. That is how the watch
 * found the first database driver, which ran its statements on the calling thread (docs/EIGENER-KERN.md §4b).
 *
 * Work that is long by itself (shaping a list collection of a megabyte) cannot wait for anything. It calls `pause`
 * between its small steps: once the piece has run for half of what is allowed, the pause really waits (a timer), the
 * screens get the thread, and the work goes on in a new piece. Not while the app is not in front: no screen needs the
 * thread then, and React Native's timers stand still, so a pause that waited for one hung until the app was opened
 * (docs/EIGENER-KERN.md §4o, 4b-C1K). The piece then goes on and is measured as one.
 */

/** The plan's limit: nothing longer than this in one piece on the screens' thread */
export const LONGEST_PIECE_MS = 8

/** A pause lets the thread go once the piece has run this long: half of the limit, so the step after it still fits */
export const PAUSE_AFTER_MS = LONGEST_PIECE_MS / 2

/**
 * A request asked by a hook starts here, before its piece opens. The hook asks from inside the screens' work (a page
 * that mounts, its effects): that work goes on in the same turn once the call returned at the core's first step, and
 * an open piece counted it as the core's until the core reached its first wait (3g: 54.2 ms "after start, until file
 * names" when playback started on the S22, docs/EIGENER-KERN.md §4m). The core starts in a promise job, after that turn.
 * One promise job is not enough while the app is in front: the caller goes on in promise jobs of its own (a query
 * library, React's work after a mount), and those ran inside the core's open piece; the watch's `afterCallersTurn`
 * waits for a timer there (8-ms run, docs/EIGENER-KERN.md §4r).
 */
export function afterCallersTurn(): Promise<void> {
    return Promise.resolve()
}

/** Where a piece ran: after which wait it began, at which it ended, and its named sections (`mark`) */
export type PieceWhere = {
    /** The wait the piece came back from ("start" when the call began it) */
    from: string
    /** The wait the piece ended at ("end" when the call was done) */
    until: string
    /** The piece cut at every `mark`: the first section is named by `from`, the others by their mark */
    sections: { name: string, milliseconds: number }[]
}

export type BlockingWatch = {
    /** Core code starts running; `what` names the request for the report */
    enter: (what: string) => void
    /** Core code stops running: it waits, or it is done */
    leave: () => void
    /** The same function, with its waiting seen by the watch. What it does before it waits counts as the core's. */
    waiting: <Args extends unknown[], Result>(wait: (...args: Args) => Promise<Result>, name?: string) => (...args: Args) => Promise<Result>
    /** A named measuring point inside a piece: the time from here to the next point (or the end) is reported under `name` */
    mark: (name: string) => void
    /**
     * Between the steps of long work: lets the thread go when the piece has run for PAUSE_AFTER_MS, else returns at
     * once. `part` names the work that follows, for the report.
     */
    pause: (part?: string) => Promise<void>
    /**
     * Before a request's first piece: in front a timer, so the caller's turn and its promise jobs are over before the
     * core starts; not in front (timers stand still) one promise job, like `afterCallersTurn`.
     */
    afterCallersTurn: () => Promise<void>
}

export type BlockingWatchParts = {
    /** A clock in milliseconds, finer than whole ones (performance.now) */
    now: () => number
    /** Every finished piece: how long the thread was held, and by which request */
    onPiece: (milliseconds: number, what: string, where: PieceWhere) => void
    /** Really gives the thread away for a moment (a timer of 0 ms) */
    free: () => Promise<void>
    /** Whether the app is in front, where its timers run; missing: always (the tests, the sandbox) */
    inFront?: () => boolean
}

export function createBlockingWatch({ now, onPiece, free, inFront = () => true }: BlockingWatchParts): BlockingWatch {
    type Piece = { start: number, what: string, part?: string, from: string, marks: [string, number][] }
    let piece: Piece | null = null
    /** The request that ran last, for work that goes on after another request's end closed the piece */
    let last = ""
    /**
     * A wait that ended. Its core code runs only once every wait it depends on ended (`Promise.all` over several reads
     * goes on after the last one), so the piece is opened when that code next reaches the watch, from the moment the
     * last of them ended: the piece does not stay open while the others are still waited for, and what the screens run
     * in that time is not counted as the core's (docs/EIGENER-KERN.md §4l, 3e-2).
     *
     * The code that goes on after a wait runs in the same turn of the thread (promise jobs). A wait that ended with no
     * such code coming to the watch (a sandbox closed by its idle timer, a close nobody goes on after) is forgotten at
     * the next turn: else the next core code that reached the watch from elsewhere opened its piece at that old moment,
     * and the free time in between counted as the core's (3f-4: 2351 ms "after sandbox close, until join" when a second
     * idle timer closed its sandbox, docs/EIGENER-KERN.md §4m).
     */
    let resumed: { at: number, what: string, part?: string, from: string } | null = null

    function claim() {
        if (piece || !resumed) return
        piece = { start: resumed.at, what: resumed.what, part: resumed.part, from: resumed.from, marks: [] }
        resumed = null
    }

    function enter(what: string, part?: string, from = "start") {
        piece ??= { start: now(), what, part, from, marks: [] }
        if (what) last = what
    }

    function leave(until = "end") {
        claim()
        if (!piece) return
        const { start, what, part, from, marks } = piece
        piece = null
        const end = now()
        // a wait that ended while this piece ran: its code can only have gone on after it
        if (resumed && resumed.at < end) resumed.at = end
        const points: [string, number][] = [[from, start], ...marks, ["", end]]
        const sections = points.slice(0, -1).map(([name, at], index) => ({ name, milliseconds: points[index + 1][1] - at }))
        onPiece(end - start, part ? `${what} (${part})` : what, { from, until, sections })
    }

    const waiting: BlockingWatch["waiting"] = (wait, name = wait.name || "a wait") => async (...args) => {
        claim()
        const what = piece?.what ?? last
        const part = piece?.part
        const pending = wait(...args)
        leave(name)
        try {
            return await pending
        }
        finally {
            if (piece) enter(what, part, name)
            else {
                const ended = { at: now(), what, part, from: name }
                resumed = ended
                void free().then(() => {
                    if (resumed === ended) resumed = null
                })
            }
        }
    }
    const letGo = waiting(free, "pause")

    return {
        enter: what => enter(what),
        leave: () => leave(),
        mark: name => {
            claim()
            piece?.marks.push([name, now()])
        },
        waiting,
        pause: async part => {
            claim()
            // requests run into each other: the end of another one may have closed the piece this work runs in
            enter(last)
            // not in front: no timer to wait for, the work goes on in this piece
            if (piece && now() - piece.start >= PAUSE_AFTER_MS && inFront()) await letGo()
            claim()
            if (piece && part !== undefined) piece.part = part
        },
        afterCallersTurn: () => inFront() ? free() : afterCallersTurn(),
    }
}
