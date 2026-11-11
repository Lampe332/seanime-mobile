import { atomWithStorage as jotaiAtomWithStorage, createJSONStorage } from "jotai/utils"
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
    return jotaiAtomWithStorage<T>(key, initialValue, createJSONStorage<T>(() => localStore), { getOnInit: true })
}
