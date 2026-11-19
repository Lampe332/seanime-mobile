// geschrieben nach: core/account/client.ts (send, REQUEST_TIMEOUT_MS, TRANSFER_TIMEOUT_MS, LOGOUT_TIMEOUT_MS) und flows.ts signOut; Werte erfunden

import { createRequire } from "node:module"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { AccountClient, type HttpFetch, LOGOUT_TIMEOUT_MS, REQUEST_TIMEOUT_MS, TRANSFER_TIMEOUT_MS } from "./client"
import type { AccountDeps } from "./devices"
import { signOut } from "./flows"
import { AccountSession } from "./session"
import type { Sodium } from "./sodium"
import { bytes, memoryStore, ready } from "./__fixtures__/harness"

let sodium: Sodium
beforeAll(async () => {
    sodium = await ready(createRequire(import.meta.url)("libsodium-wrappers-sumo"))
})

/** A server that takes the request and never answers */
const silent: HttpFetch = () => new Promise(() => undefined)

/** Whether `work` has failed like a dropped connection by now */
async function failed(work: Promise<unknown>): Promise<boolean> {
    let dropped = false
    work.catch(error => {
        dropped = error instanceof TypeError && error.message === "Network request failed"
    })
    await vi.advanceTimersByTimeAsync(0)
    return dropped
}

describe("a server that does not answer (F6)", () => {
    beforeEach(() => void vi.useFakeTimers())
    afterEach(() => void vi.useRealTimers())

    it("every request fails like a dropped connection after its time; the package gets longer, the sign-out a moment", async () => {
        const client = new AccountClient({ baseUrl: "https://account.test", fetch: silent, sodium, credentials: async () => null })
        const [meta, upload, logout] = [client.syncMeta(), client.putSnapshot(bytes(8), 1, "dek-1"), client.logout()]
        await vi.advanceTimersByTimeAsync(LOGOUT_TIMEOUT_MS - 1)
        expect(await failed(logout)).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(await failed(logout)).toBe(true)
        expect(await failed(meta)).toBe(false)
        await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - LOGOUT_TIMEOUT_MS)
        expect(await failed(meta)).toBe(true)
        expect(await failed(upload)).toBe(false)
        await vi.advanceTimersByTimeAsync(TRANSFER_TIMEOUT_MS - REQUEST_TIMEOUT_MS)
        expect(await failed(upload)).toBe(true)
    })

    it("an answer whose body never arrives fails the same way", async () => {
        const headersOnly: HttpFetch = async () => ({ status: 200, headers: { get: () => null }, json: () => new Promise(() => undefined), arrayBuffer: () => new Promise(() => undefined) })
        const client = new AccountClient({ baseUrl: "https://account.test", fetch: headersOnly, sodium, credentials: async () => null })
        const meta = client.syncMeta()
        expect(await failed(meta)).toBe(false)
        await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
        expect(await failed(meta)).toBe(true)
    })

    it("signing out ends after a moment: the device forgets the session, the key and the signing key anyway", async () => {
        const store = memoryStore()
        const session = new AccountSession(store, sodium)
        await session.signer()
        await session.saveSession({ userId: "6f1c2c1e-0d7b-4c3a-9a51-2f0e7d4b8a10", sessionToken: "t".repeat(43), kind: "email", email: "a@example.org", deviceId: "d" })
        await session.saveDek("dek-1", bytes(32, 40))
        const client = new AccountClient({ baseUrl: "https://account.test", fetch: silent, sodium, credentials: () => session.credentials() })
        let out = false
        void signOut({ client, session, sodium } as AccountDeps).then(() => void (out = true))
        await vi.advanceTimersByTimeAsync(LOGOUT_TIMEOUT_MS - 1)
        expect(out).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(out).toBe(true)
        expect([...store.items.keys()].filter(key => key.startsWith("seanime-account."))).toEqual([])
    })
})
