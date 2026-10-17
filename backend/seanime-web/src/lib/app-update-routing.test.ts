import { describe, expect, it, vi } from "vitest"
const native = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock("@/lib/app-updates", () => ({ IS_MOBILE_APP: true, checkAppUpdate: native.check }))
vi.mock("@/api/client/requests", () => ({
    useServerQuery: () => { throw new Error("Unexpected desktop API request") },
    useServerMutation: () => { throw new Error("Unexpected desktop API mutation") },
}))
vi.mock("@/app/(main)/_hooks/use-server-status", () => ({ useSetServerStatus: vi.fn() }))
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => options, useMutation: (options: any) => options }))
import { useCheckForUpdates, useGetLatestUpdate } from "@/api/hooks/releases.hooks"

describe("mobile update routing", () => {
    it("automatic checks use the native app release source", () => {
        const query = useGetLatestUpdate(true) as any
        expect(query.queryFn).toBe(native.check)
        expect(query.enabled).toBe(true)
    })
    it("manual checks use the same source instead of the desktop updater", () => {
        expect((useCheckForUpdates() as any).mutationFn).toBe(native.check)
    })
    it("respects disabling automatic update checks", () => {
        expect((useGetLatestUpdate(false) as any).enabled).toBe(false)
    })
})
