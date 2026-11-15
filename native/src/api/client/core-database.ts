// geschrieben nach: docs/EIGENER-KERN.md §4a (eigene Datenbank) und der Doku von expo-sqlite (prepareAsync, executeForRawResultAsync); kein Server-Quelltext
import type { SqlDriver } from "@/core"
import type { SQLiteBindValue, SQLiteDatabase } from "expo-sqlite"

/*
 * The device side of the core's database: runs one statement of the core on expo-sqlite. The core itself does not know
 * expo-sqlite (it runs in the logic tests without a device); this is the only place that joins the two.
 *
 * The statements run on expo-sqlite's own thread, not on the calling one (its ...Async calls). Measured on the device
 * (docs/EIGENER-KERN.md §4b), saving one setting on the calling thread held it for 20 to 41 ms in one piece: writing
 * to the disk is too slow for the thread the screens' logic runs on.
 */
export function sqlDriverFor(database: Pick<SQLiteDatabase, "prepareAsync">): SqlDriver {
    return async (sql, params, method) => {
        const statement = await database.prepareAsync(sql)
        try {
            const result = await statement.executeForRawResultAsync(params as SQLiteBindValue[])
            if (method === "run") return { rows: [] }
            // "get" wants the one row itself, the others the list of rows; every row is a list of values
            if (method === "get") return { rows: (await result.getFirstAsync() ?? undefined) as unknown as unknown[] }
            return { rows: await result.getAllAsync() }
        }
        finally {
            await statement.finalizeAsync()
        }
    }
}
