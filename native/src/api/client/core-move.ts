// geschrieben nach: docs/EIGENER-KERN.md §4c (Umzug), §6 (wo die Dateien des Servers im App-Sandkasten liegen) und der Doku von expo-file-system (File), expo-sqlite (deserializeDatabaseAsync) und expo-secure-store; kein Server-Quelltext
import type { OldData, SecretStore } from "@/core"
import { File, Paths } from "expo-file-system"
import * as SecureStore from "expo-secure-store"
import { type SQLiteDatabase, deserializeDatabaseAsync } from "expo-sqlite"

/*
 * The device side of the move (core/move/move.ts): where the server's files lie and how they are read without touching
 * them. The server keeps its data in the app's own files folder: `seanime.db` and `cache/<bucket>.cache`.
 *
 * The database file is never opened in place (SQLite would be free to write to it, and the server has it open): its
 * bytes are read and opened as a database in memory. Nothing is written to the server's files, and no copy of them is
 * left on the disk.
 */

const OLD_DATABASE = "seanime.db"

export function openOldData(): { old: OldData, close: () => Promise<void> } {
    let opened: Promise<SQLiteDatabase | null> | null = null
    const database = () => opened ??= (async () => {
        const file = new File(Paths.document, OLD_DATABASE)
        return file.exists ? deserializeDatabaseAsync(await file.bytes()) : null
    })()
    return {
        old: {
            // the table names are the ones the core asks for (OldTable), never text from outside
            rows: async table => (await database())?.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table}`) ?? null,
            cacheFile: async bucket => {
                const file = new File(Paths.document, "cache", `${bucket}.cache`)
                return file.exists ? file.text() : null
            },
        },
        close: async () => {
            const database = await opened?.catch(() => null)
            await database?.closeAsync()
        },
    }
}

/** The device's secured storage: values encrypted with a key of the Android Keystore, readable by this app only */
export const secretStore: SecretStore = {
    read: name => SecureStore.getItemAsync(name),
    write: (name, value) => SecureStore.setItemAsync(name, value),
    forget: name => SecureStore.deleteItemAsync(name),
}
