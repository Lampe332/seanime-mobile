// Vitest runs in Node, which cannot load expo-sqlite's native module. Node has SQLite built in; this alias hands out the
// few calls the app makes (api/client/core-database.ts) on top of it, so the tests run the real statements of the core's
// database against a real SQLite. Every database lives in memory; one opened under the same name again is the same
// database, like a file on the device (forgetDatabases() starts over).
import { DatabaseSync, type SQLInputValue } from "node:sqlite"

const opened = new Map<string, DatabaseSync>()

export function forgetDatabases() {
    for (const database of opened.values()) database.close()
    opened.clear()
}

export function openDatabaseSync(name: string) {
    let database = opened.get(name)
    if (!database) {
        database = new DatabaseSync(":memory:")
        opened.set(name, database)
    }
    const connection = database
    return {
        async prepareAsync(source: string) {
            const statement = connection.prepare(source)
            statement.setReturnArrays(true)
            return {
                async executeForRawResultAsync(params: SQLInputValue[]) {
                    const rows = statement.all(...params) as unknown as unknown[][]
                    return { getAllAsync: async () => rows, getFirstAsync: async () => rows[0] ?? null }
                },
                async finalizeAsync() {},
            }
        },
    }
}

export const openDatabaseAsync = async (name: string) => openDatabaseSync(name)
