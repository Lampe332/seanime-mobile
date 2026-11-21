import { describe, expect, it } from "vitest"
import { USAGE_DAY_KEY, USAGE_ID_KEY, USAGE_RETRY_MS, createUsagePing, type UsagePingDeps } from "./usage-ping"

const DAY = 24 * 3600 * 1000
const START = Date.UTC(2026, 10, 21, 10, 0, 0)

function setup(over: Partial<UsagePingDeps> = {}) {
    const store = new Map<string, string>()
    const sent: { id: string; version: string }[] = []
    let t = START
    let enabled = true
    let status = 204
    let ids = 0
    const deps: UsagePingDeps = {
        get: key => store.get(key),
        set: (key, value) => void store.set(key, value),
        enabled: () => enabled,
        version: "4.3.2",
        newId: () => `00000000-0000-4000-8000-00000000000${++ids}`,
        now: () => t,
        send: async body => {
            sent.push(body)
            return { status }
        },
        ...over,
    }
    return {
        ping: createUsagePing(deps), store, sent,
        advance: (ms: number) => void (t += ms),
        setEnabled: (v: boolean) => void (enabled = v),
        setStatus: (s: number) => void (status = s),
    }
}

describe("usage ping", () => {
    it("sends once per UTC day with one stable random ID", async () => {
        const s = setup()
        expect(await s.ping()).toBe("sent")
        expect(await s.ping()).toBe("skipped")
        s.advance(DAY)
        expect(await s.ping()).toBe("sent")
        expect(s.sent).toHaveLength(2)
        expect(s.sent[0]).toEqual({ id: "00000000-0000-4000-8000-000000000001", version: "4.3.2" })
        expect(s.sent[1]?.id).toBe(s.sent[0]?.id)
        expect(s.store.get(USAGE_ID_KEY)).toBe(s.sent[0]?.id)
        expect(s.store.get(USAGE_DAY_KEY)).toBe("2026-11-22")
    })

    it("sends nothing when the switch is off", async () => {
        const s = setup()
        s.setEnabled(false)
        expect(await s.ping()).toBe("skipped")
        expect(s.sent).toHaveLength(0)
    })

    it("waits an hour after a failure and never throws", async () => {
        const s = setup({ send: async () => { throw new Error("offline") } })
        expect(await s.ping()).toBe("failed")
        s.advance(USAGE_RETRY_MS - 1)
        expect(await s.ping()).toBe("skipped")
        s.advance(1)
        expect(await s.ping()).toBe("failed")
        expect(s.store.has(USAGE_DAY_KEY)).toBe(false)
    })

    it("retries a 5xx or 429 later the same day, but not a 400", async () => {
        const s = setup()
        s.setStatus(503)
        expect(await s.ping()).toBe("failed")
        s.advance(USAGE_RETRY_MS)
        s.setStatus(400)
        expect(await s.ping()).toBe("failed")
        s.advance(USAGE_RETRY_MS)
        expect(await s.ping()).toBe("skipped")
        expect(s.sent).toHaveLength(2)
    })

    it("skips a version the server would reject and replaces a broken stored ID", async () => {
        expect(await setup({ version: "" }).ping()).toBe("skipped")
        const s = setup()
        s.store.set(USAGE_ID_KEY, "garbage")
        expect(await s.ping()).toBe("sent")
        expect(s.sent[0]?.id).toBe("00000000-0000-4000-8000-000000000001")
    })
})
