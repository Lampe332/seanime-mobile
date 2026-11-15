// geschrieben nach: Plan „Eigener Kern" Stufe 1b (Kern ohne Gerät testbar: gleiche Abfrage-Schicht auf dem Gerät und im Test) und der Drizzle-Doku (sqlite-proxy); kein Server-Quelltext

import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy"
import { bringUpToDate, type SqlDriver } from "./migrations"
import * as schema from "./schema"

/*
 * The core's own database. The core does not know which SQLite it talks to: it is handed a function that runs one
 * statement (SqlDriver). On the device that is expo-sqlite (api/client/core-database.ts), in the logic tests Node's own
 * SQLite; schema, steps and queries are the same in both.
 */

export type CoreDatabase = SqliteRemoteDatabase<typeof schema>

/** Waiting in the database's line, seen by the watch of the screens' thread (blocking.ts `waiting`) */
export type LineWait = <T>(pending: Promise<T>) => Promise<T>

/**
 * Brings the database up to date (migrations.ts) and returns it ready for queries. `waitInLine` is how work waits for
 * the work before it in the line (inOrder); left out where nobody measures.
 */
export async function openCoreDatabase(driver: SqlDriver, now: () => number, waitInLine?: LineWait): Promise<CoreDatabase> {
    await bringUpToDate(driver, now())
    const database = drizzle(driver, { schema })
    if (waitInLine) lineWaits.set(database, waitInLine)
    return database
}

/** The last work in a database's line, and whether it is done */
type Line = { last: Promise<unknown>, done: boolean }

const lines = new WeakMap<CoreDatabase, Line>()
const lineWaits = new WeakMap<CoreDatabase, LineWait>()

/**
 * Runs pieces of work on one database strictly one after the other. The database has one connection; two answers of
 * the core that read, decide and write at the same time would otherwise run into each other's transaction.
 *
 * Work that has to wait for the work before it really waits (its statements run on the database's thread): that wait
 * goes through `waitInLine`, so the watch does not count what the screens run meanwhile as the core's (5a-2b: a
 * player message behind another request's statement held its piece open 15-101 ms "until sql", docs/EIGENER-KERN.md
 * §4p). Is the work before already done, nothing is waited for and the work goes on in the same piece.
 */
export function inOrder<T>(database: CoreDatabase, work: () => Promise<T>): Promise<T> {
    const before = lines.get(database)
    const line: Line = { last: Promise.resolve(), done: false }
    // marked done before its promise settles, so the next work of the same caller does not count as waiting
    const run = async () => {
        try {
            return await work()
        }
        finally {
            line.done = true
        }
    }
    const wait = lineWaits.get(database)
    const turn = !before || before.done ? Promise.resolve() : wait ? wait(before.last) : before.last
    const result = turn.then(run, run)
    line.last = result.catch(() => undefined)
    lines.set(database, line)
    return result
}
