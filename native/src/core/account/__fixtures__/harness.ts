// geschrieben nach: core/backup/backup.test.ts (Gerät mit eigener Datenbank, Erweiterungsordner und gesichertem Speicher); nur für Tests, Werte erfunden

import { type CoreDatabase, openCoreDatabase } from "../../database/database"
import type { ExtensionPlace } from "../../extensions/manage/installed"
import type { CoreEnvironment } from "../../registry"
import type { SecureStore } from "../session"
import type { Sodium } from "../sodium"

/*
 * Helpers for the account tests. Like the rest of the core this file imports no package (core.test.ts): the tests hand
 * in libsodium-wrappers-sumo, fflate and the SQLite driver.
 */

/** The loaded libsodium, typed as the core's narrow interface (the assignment checks that it fits) */
export async function ready(library: Sodium & { ready: Promise<unknown> }): Promise<Sodium> {
    await library.ready
    const narrow: Sodium = library
    return narrow
}

/** libsodium with a fixed sequence of "random" bytes, for test vectors */
export function fixedRandom(sodium: Sodium, ...chunks: Uint8Array[]): Sodium {
    const queue = [...chunks]
    return new Proxy(sodium, {
        get(target, property, receiver) {
            if (property === "randombytes_buf") {
                return (length: number) => {
                    const next = queue.shift()
                    if (!next || next.length !== length) throw new Error(`no fixed random bytes of length ${length}`)
                    return Uint8Array.from(next)
                }
            }
            return Reflect.get(target, property, receiver)
        },
    })
}

export const bytes = (length: number, start = 0) => Uint8Array.from({ length }, (_, i) => (start + i) & 255)
export const hex = (data: Uint8Array) => Buffer.from(data).toString("hex")
export const unhex = (text: string) => new Uint8Array(Buffer.from(text, "hex"))

export function memoryStore(): SecureStore & { items: Map<string, string> } {
    const items = new Map<string, string>()
    return {
        items,
        getItemAsync: async key => items.get(key) ?? null,
        setItemAsync: async (key, value) => void items.set(key, value),
        deleteItemAsync: async key => void items.delete(key),
    }
}

let counter = 0

/** One device: its core database (`driver` opens the test SQLite by name), extensions folder, secured storage, app preferences */
export function device(driver: (name: string) => unknown, clock: () => number) {
    const name = `account-${++counter}-${Math.random().toString(36).slice(2)}.db`
    let database: Promise<CoreDatabase> | null = null
    const files = new Map<string, string>()
    const secrets = new Map<string, string>()
    const preferences = new Map<string, string>()
    const place = {
        folder: {
            names: async () => [...files.keys()],
            read: async (file: string) => files.get(file) ?? null,
            write: async (file: string, text: string) => void files.set(file, text),
            remove: async (file: string) => void files.delete(file),
            stamp: async (file: string) => (files.has(file) ? `${files.get(file)!.length}.0` : null),
        },
        serverCache: async () => null,
        serverCacheStamp: async () => null,
        writeServerCache: async () => undefined,
    } as unknown as ExtensionPlace
    const environment = {
        database: () => database ??= openCoreDatabase(driver(name) as never, clock),
        secret: async (key: string) => secrets.get(key) ?? null,
        keepSecret: async (key: string, value: string | null) => void (value === null ? secrets.delete(key) : secrets.set(key, value)),
        now: clock,
        extensions: async () => place,
    } as unknown as CoreEnvironment
    return { environment, files, secrets, preferences, db: () => environment.database() }
}
