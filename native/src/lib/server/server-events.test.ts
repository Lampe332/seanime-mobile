import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { emitCoreEvent } from "@/core"
import { WSEvents } from "@/lib/server/ws-events"
import { listenForPluginEvent, listenForServerEvent } from "./server-events"

/** The socket as the listeners use it; `counts` shows what is still attached */
function fakeSocket() {
    const target = new EventTarget()
    const counts = { attached: 0 }
    return {
        counts,
        socket: {
            addEventListener: (type: string, listener: EventListener) => {
                counts.attached++
                target.addEventListener(type, listener)
            },
            removeEventListener: (type: string, listener: EventListener) => {
                counts.attached--
                target.removeEventListener(type, listener)
            },
        } as unknown as WebSocket,
        /** A message from the server: text, as the socket delivers it */
        serverSends: (type: string, payload?: unknown) => target.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type, payload }) })),
        serverSendsText: (data: string) => target.dispatchEvent(new MessageEvent("message", { data })),
    }
}

/** A core event arrives in a later turn */
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0))

describe("server events from both sources", () => {
    const ends: (() => void)[] = []
    afterEach(() => {
        for (const end of ends.splice(0)) end()
        vi.restoreAllMocks()
    })

    it("a listener hears the server's socket as before", () => {
        const { socket, serverSends } = fakeSocket()
        const heard: unknown[] = []
        ends.push(listenForServerEvent(socket, WSEvents.SETTINGS_CHANGED, data => heard.push(data)))
        serverSends("settings-changed", { a: 1 })
        serverSends("scan-status", "other kind")
        serverSends("settings-changed")
        expect(heard).toEqual([{ a: 1 }, undefined])
    })

    it("the same listener hears the core", async () => {
        const { socket } = fakeSocket()
        const heard: unknown[] = []
        ends.push(listenForServerEvent(socket, WSEvents.SETTINGS_CHANGED, data => heard.push(data)))
        emitCoreEvent("settings-changed", { a: 2 })
        emitCoreEvent("scan-status", "other kind")
        await nextTurn()
        expect(heard).toEqual([{ a: 2 }])
    })

    it("hears the core without a connection to the server", async () => {
        const heard: unknown[] = []
        ends.push(listenForServerEvent(null, "extensions-reloaded", data => heard.push(data)))
        emitCoreEvent("extensions-reloaded", 3)
        await nextTurn()
        expect(heard).toEqual([3])
    })

    it("gives every listener its own copy of the payload, from either source", async () => {
        const { socket, serverSends } = fakeSocket()
        const heard: { list: number[] }[] = []
        for (let i = 0; i < 2; i++) {
            ends.push(listenForServerEvent<{ list: number[] }>(socket, "playlist", data => {
                data.list.push(99)
                heard.push(data)
            }))
        }
        serverSends("playlist", { list: [1] })
        emitCoreEvent("playlist", { list: [2] })
        await nextTurn()
        expect(heard).toEqual([{ list: [1, 99] }, { list: [1, 99] }, { list: [2, 99] }, { list: [2, 99] }])
    })

    it("ending it clears both sources", async () => {
        const { socket, serverSends, counts } = fakeSocket()
        const heard: unknown[] = []
        const end = listenForServerEvent(socket, "scan-status", data => heard.push(data))
        expect(counts.attached).toBe(1)
        end()
        expect(counts.attached).toBe(0)
        serverSends("scan-status", 1)
        emitCoreEvent("scan-status", 2)
        await nextTurn()
        expect(heard).toEqual([])
    })

    it("a failing listener or an unreadable message is logged, and the others go on", async () => {
        const logged = vi.spyOn(console, "log").mockImplementation(() => undefined)
        const { socket, serverSends, serverSendsText } = fakeSocket()
        const heard: unknown[] = []
        ends.push(listenForServerEvent(socket, "scan-status", () => {
            throw new Error("broken listener")
        }))
        ends.push(listenForServerEvent(socket, "scan-status", data => heard.push(data)))
        serverSendsText("not json")
        serverSends("scan-status", 1)
        emitCoreEvent("scan-status", 2)
        await nextTurn()
        expect(heard).toEqual([1, 2])
        expect(logged.mock.calls.map(call => call.join(" "))).toEqual([
            "[Websocket] error Error handling message scan-status",
            "[Websocket] error Error handling message scan-status",
            "[Websocket] error Error handling message scan-status",
            "[Websocket] error Error handling message scan-status",
        ])
    })

    it("plugin events come from both sources too, one at a time or as a batch, for one plugin or all", async () => {
        const { socket, serverSends } = fakeSocket()
        const one: unknown[] = []
        const all: unknown[] = []
        ends.push(listenForPluginEvent(socket, "tray:updated", "plugin-a", (data, id) => one.push([data, id])))
        ends.push(listenForPluginEvent(socket, "tray:updated", "", (data, id) => all.push([data, id])))
        serverSends("plugin", { type: "tray:updated", extensionId: "plugin-a", payload: 1 })
        serverSends("plugin", { type: "tray:updated", extensionId: "plugin-b", payload: 2 })
        serverSends("plugin", { type: "other", extensionId: "plugin-a", payload: 3 })
        emitCoreEvent("plugin", {
            type: "plugin:batch-events",
            payload: { events: [{ type: "tray:updated", extensionId: "plugin-a", payload: 4 }, { type: "tray:updated", extensionId: "plugin-b", payload: 5 }] },
        })
        await nextTurn()
        expect(one).toEqual([[1, "plugin-a"], [4, "plugin-a"]])
        expect(all).toEqual([[1, "plugin-a"], [2, "plugin-b"], [4, "plugin-a"], [5, "plugin-b"]])
    })

    it("is what the hooks of the screens listen through, with their call unchanged", () => {
        const hooks = fs.readFileSync(path.join(__dirname, "../../main/_hooks/handle-websockets.ts"), "utf8")
        expect(hooks).toContain("export function useWebsocketMessageListener<TData = unknown>({ type, onMessage, deps }: WebSocketMessageListener<TData> & { deps?: any[] })")
        expect(hooks).toContain("useEffect(() => listenForServerEvent<TData>(socket, type, onMessage), [socket, onMessage, ...(deps ?? [])])")
        expect(hooks).toContain("useEffect(() => listenForPluginEvent<TData>(socket, type, extensionId, onMessage), [socket, onMessage, type, extensionId])")
    })
})
