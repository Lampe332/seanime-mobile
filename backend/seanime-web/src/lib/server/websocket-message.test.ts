import { afterEach, describe, expect, it, vi } from "vitest"
import { copyWebsocketPayload, decodeWebsocketMessage } from "./websocket-message"

afterEach(() => vi.restoreAllMocks())

describe("shared WebSocket decoding", () => {
    it("parses each event once even with hundreds of subscribers", () => {
        const event = new MessageEvent("message", { data: '{"type":"plugin","payload":{"items":[1,2,3]}}' })
        const parse = vi.spyOn(JSON, "parse")
        for (let i = 0; i < 500; i++) expect(decodeWebsocketMessage(event).type).toBe("plugin")
        expect(parse).toHaveBeenCalledTimes(1)
    })
    it("keeps separate events separate", () => {
        const first = new MessageEvent("message", { data: '{"type":"one","payload":1}' })
        const next = new MessageEvent("message", { data: '{"type":"two","payload":2}' })
        expect(decodeWebsocketMessage(first).payload).toBe(1)
        expect(decodeWebsocketMessage(next).payload).toBe(2)
    })
    it("isolates a subscriber that mutates its payload", () => {
        const event = new MessageEvent("message", { data: '{"type":"plugin","payload":{"items":[{"value":1}]}}' })
        const first = copyWebsocketPayload(decodeWebsocketMessage<{items: {value: number}[]}>(event).payload)
        first.items[0].value = 99
        expect(copyWebsocketPayload(decodeWebsocketMessage<{items: {value: number}[]}>(event).payload).items[0].value).toBe(1)
    })
    it("caches a parse failure and continues handling later valid messages", () => {
        const bad = new MessageEvent("message", { data: "invalid JSON" })
        const parse = vi.spyOn(JSON, "parse")
        expect(() => decodeWebsocketMessage(bad)).toThrow()
        expect(() => decodeWebsocketMessage(bad)).toThrow()
        expect(parse).toHaveBeenCalledTimes(1)
        expect(decodeWebsocketMessage(new MessageEvent("message", { data: '{"type":"ok"}' })).type).toBe("ok")
    })
    it("preserves payload isolation in WebViews without structuredClone", () => {
        vi.stubGlobal("structuredClone", undefined)
        try {
            const original = { nested: [1, 2] }
            const copy = copyWebsocketPayload(original)
            copy.nested.push(3)
            expect(original.nested).toEqual([1, 2])
            expect(copyWebsocketPayload(undefined)).toBeUndefined()
        } finally { vi.unstubAllGlobals() }
    })
})
