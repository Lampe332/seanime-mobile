import { type WritableAtom, getDefaultStore } from "jotai"
import { RESET, atomWithStorage as jotaiAtomWithStorage, createJSONStorage } from "jotai/utils"
import { createMMKV } from "react-native-mmkv"

/**
 * The app's key-value store, the replacement for the web app's localStorage/sessionStorage. MMKV is synchronous like
 * localStorage, so code that read a value during render keeps working, and the stored values are the same JSON strings
 * under the same keys ("sea-…") as in the web app.
 */
export const storage = createMMKV({ id: "seanime" })

/**
 * A localStorage-shaped view of {@link storage} for code that used getItem/setItem/removeItem. An atomWithStorage set to
 * undefined writes JSON.stringify(undefined), i.e. undefined: the browser stored "undefined", MMKV.set throws (crashed
 * the external player page, medialinks setFilePath(undefined)) → the key goes, so the atom reads its default again.
 */
export const localStore = {
    getItem: (key: string): string | null => storage.getString(key) ?? null,
    setItem: (key: string, value: string) => {
        if (value === undefined) storage.remove(key)
        else storage.set(key, value)
    },
    removeItem: (key: string) => {
        storage.remove(key)
    },
}

/** Values that lived in sessionStorage: kept in memory only, so they end with the app process like a browser session. */
const sessionValues = new Map<string, string>()
export const sessionStore = {
    getItem: (key: string): string | null => sessionValues.get(key) ?? null,
    setItem: (key: string, value: string) => {
        sessionValues.set(key, value)
    },
    removeItem: (key: string) => {
        sessionValues.delete(key)
    },
}

/** Reads a JSON value written by {@link atomWithStorage} outside of React. */
export function readStoredJSON<T>(key: string, fallback: T): T {
    const raw = storage.getString(key)
    if (raw === undefined) return fallback
    try {
        return JSON.parse(raw) as T
    }
    catch {
        return fallback
    }
}

/**
 * jotai's atomWithStorage on MMKV. The value is read on init (MMKV is synchronous), so the first render already shows the
 * stored value; the web app needed `getOnInit` for that and flashed the default elsewhere.
 */
export function atomWithStorage<T>(key: string, initialValue: T) {
    const json = createJSONStorage<T>(() => localStore)
    const made = jotaiAtomWithStorage<T>(key, initialValue, json, { getOnInit: true })
    followStore(key, made, () => json.getItem(key, initialValue))
    return made
}

/** How each stored atom reads its key again, by key (writeStoredValues) */
const followers = new Map<string, (() => void)[]>()

/**
 * Makes an atom follow its key when something other than the atom writes the store: it is then set to `read()`, or reset
 * to its default when the key is gone. An atom reads the store only when it is made and when it is mounted, so without
 * this a value the account sync brought stayed invisible (and was overwritten by the old one at the next change).
 */
export function followStore<T>(key: string, stored: WritableAtom<T, [T | typeof RESET], unknown>, read: () => T): void {
    const reread = () => void getDefaultStore().set(stored, storage.contains(key) ? read() : RESET)
    followers.set(key, [...followers.get(key) ?? [], reread])
}

/** Writes values into the store from outside the atoms (the account sync, a restore) and takes the `removed` keys out */
export function writeStoredValues(values: Record<string, string>, removed: string[]): void {
    for (const [key, value] of Object.entries(values)) storage.set(key, value)
    for (const key of removed) storage.remove(key)
    for (const key of [...Object.keys(values), ...removed]) for (const reread of followers.get(key) ?? []) reread()
}
