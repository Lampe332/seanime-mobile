import { getDefaultStore } from "jotai"
import { describe, expect, it } from "vitest"
import { atomWithStorage, localStore, storage, writeStoredValues } from "./storage"

describe("localStore", () => {
    it("removes the key for an undefined value instead of handing it to MMKV (atomWithStorage set to undefined)", () => {
        localStore.setItem("sea-test-undefined", JSON.stringify("x"))
        expect(storage.contains("sea-test-undefined")).toBe(true)
        // jotai's JSON storage writes JSON.stringify(undefined) === undefined; MMKV.set throws on it at runtime
        localStore.setItem("sea-test-undefined", JSON.stringify(undefined) as unknown as string)
        expect(storage.contains("sea-test-undefined")).toBe(false)
        expect(localStore.getItem("sea-test-undefined")).toBeNull()
    })
})

describe("values written into the store from outside (account sync, restore)", () => {
    it("reach the atoms that hold them, mounted or not, without a restart", () => {
        const store = getDefaultStore()
        const theme = atomWithStorage("sea-test-theme", "dark")
        const volume = atomWithStorage("sea-test-volume", 1)
        store.set(theme, "blue")
        expect(store.get(volume)).toBe(1)
        const seen: string[] = []
        const stop = store.sub(theme, () => seen.push(store.get(theme)))

        // another device changed both: the sync writes them into the store
        writeStoredValues({ "sea-test-theme": JSON.stringify("light"), "sea-test-volume": "0.4" }, [])
        expect(storage.getString("sea-test-theme")).toBe("\"light\"")
        expect(store.get(theme)).toBe("light")
        expect(seen).toEqual(["light"])
        expect(store.get(volume)).toBe(0.4)
        stop()

        // removed on another device: back to the default, and the key is not written again
        writeStoredValues({}, ["sea-test-theme"])
        expect(store.get(theme)).toBe("dark")
        expect(storage.contains("sea-test-theme")).toBe(false)
        expect(store.get(volume)).toBe(0.4)
    })
})
