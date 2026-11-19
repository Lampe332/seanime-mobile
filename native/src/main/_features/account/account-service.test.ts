// geschrieben nach: main/_features/account/account-service.ts (retryAccountLoad); die App-Schicht ist durch vi.fn ersetzt

import { getDefaultStore } from "jotai"
import { describe, expect, it, vi } from "vitest"

const refreshAccount = vi.fn()
vi.mock("react-native", () => ({ AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) } }))
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }))
vi.mock("@/lib/account/account-app", () => ({ refreshAccount: () => refreshAccount(), onAccountDataChange: () => undefined, startAccountClock: () => null }))

const { accountLoadFailedAtom, retryAccountLoad } = await import("./account-service")

describe("reading the account at start", () => {
    it("a throwing secure storage is a failure the screen can show, and Try again clears it", async () => {
        const store = getDefaultStore()
        refreshAccount.mockRejectedValueOnce(new Error("SecureStore: keystore unavailable"))
        await expect(retryAccountLoad()).resolves.toBeUndefined()
        expect(store.get(accountLoadFailedAtom)).toBe(true)
        refreshAccount.mockResolvedValueOnce({ loaded: true })
        await retryAccountLoad()
        expect(store.get(accountLoadFailedAtom)).toBe(false)
    })
})
