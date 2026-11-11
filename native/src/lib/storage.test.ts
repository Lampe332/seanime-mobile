import { describe, expect, it } from "vitest"
import { localStore, storage } from "./storage"

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
