import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WSEvents } from "@/lib/server/ws-events"
import { CORE_EVENT_TYPES, type CoreEvent, type CoreEventType, emitCoreEvent, onCoreEvent } from "./index"

// The two lists are the same kinds, also for the compiler: a kind missing on either side fails `tsc`.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const sameKinds: Same<CoreEventType, `${WSEvents}`> = true

/** An event arrives in a later turn, like a message from the socket */
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0))

describe("core events", () => {
    const ends: (() => void)[] = []
    function listen(): CoreEvent[] {
        const heard: CoreEvent[] = []
        ends.push(onCoreEvent(event => heard.push(event)))
        return heard
    }
    afterEach(() => {
        for (const end of ends.splice(0)) end()
        vi.restoreAllMocks()
    })

    it("have the kinds the app's listeners know from the server", () => {
        expect(sameKinds).toBe(true)
        const source = fs.readFileSync(path.join(__dirname, "../lib/server/ws-events.ts"), "utf8")
        const serverKinds = [...source.matchAll(/=\s*"([^"]+)"/g)].map(match => match[1])
        expect(serverKinds.length).toBeGreaterThan(50)
        expect([...CORE_EVENT_TYPES]).toEqual(serverKinds)
    })

    it("reach every listener in the server's form, type and payload", async () => {
        const first = listen()
        const second = listen()
        emitCoreEvent("settings-changed", { library: { autoScan: true } })
        emitCoreEvent("extensions-reloaded")
        await nextTurn()
        const expected = [{ type: "settings-changed", payload: { library: { autoScan: true } } }, { type: "extensions-reloaded" }]
        expect(first).toEqual(expected)
        expect(second).toEqual(expected)
    })

    it("arrive after the sender's own work, never inside it", async () => {
        const heard = listen()
        emitCoreEvent("scan-status", "done")
        expect(heard).toEqual([])
        await nextTurn()
        expect(heard).toHaveLength(1)
    })

    it("carry what a message can: the payload as it was when sent, as JSON", async () => {
        const heard = listen()
        const payload = { count: 1, when: new Date(0), skipped: undefined as unknown, list: [1] }
        emitCoreEvent("playlist", payload)
        payload.count = 2
        payload.list.push(2)
        await nextTurn()
        expect(heard).toEqual([{ type: "playlist", payload: { count: 1, when: "1970-01-01T00:00:00.000Z", list: [1] } }])
    })

    it("stop reaching a listener that ended, also for an event already on its way", async () => {
        const heard: CoreEvent[] = []
        const end = onCoreEvent(event => heard.push(event))
        emitCoreEvent("scan-status", 1)
        await nextTurn()
        emitCoreEvent("scan-status", 2)
        end()
        emitCoreEvent("scan-status", 3)
        await nextTurn()
        expect(heard.map(event => event.payload)).toEqual([1])
    })

    it("reach the other listeners when one fails", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
        ends.push(onCoreEvent(() => {
            throw new Error("broken listener")
        }))
        const heard = listen()
        emitCoreEvent("info-toast", "hello")
        await nextTurn()
        expect(heard).toEqual([{ type: "info-toast", payload: "hello" }])
        expect(logged).toHaveBeenCalledOnce()
    })
})
