import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

// The hook runs here without a renderer: React's hooks are stand-ins that run once (refs keep their value, effects do not
// run), the socket context is empty as in the app since stage 8a-2 (websocket-provider.tsx), the connection atom false.
vi.mock("react", () => {
    const React = {
        createContext: (value: unknown) => ({ value }),
        useContext: () => null,
        useRef: (value: unknown) => ({ current: value }),
        useEffect: () => {},
        useLayoutEffect: () => {},
        useMemo: (make: () => unknown) => make(),
    }
    return { default: React, ...React }
})
vi.mock("jotai", () => ({
    atom: (value: unknown) => ({ init: value }),
    useAtom: () => [false, () => {}],
    useAtomValue: () => null,
    useSetAtom: () => () => {},
}))

const { useWebsocketSender } = await import("./handle-websockets")

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe("websocket sender", () => {
    const source = readFileSync(join(__dirname, "handle-websockets.ts"), "utf8")
    const sender = source.slice(source.indexOf("export function useWebsocketSender"), source.indexOf("export type WebSocketMessageListener"))

    // Callers list sendMessage in effect dependencies (player status interval, Nakama status, playlist), so it must never change.
    it("hands out functions that stay the same across renders and call the latest ones", () => {
        expect(sender).toMatch(/return useMemo\(\(\) => \(\{[\s\S]*latest\.current\.sendMessage\(data\)[\s\S]*latest\.current\.addPluginEventToBatch\(type, payload, extensionId\)[\s\S]*\}\), \[\]\)\s*\}\s*\/\/\/\//)
        expect(sender).toMatch(/useLayoutEffect\(\(\) => \{\s*latest\.current = \{ sendMessage, addPluginEventToBatch \}\s*\}\)/)
    })

    it("without a socket queues nothing, starts no timer and writes no log line", () => {
        vi.useFakeTimers()
        const lines: string[] = []
        vi.spyOn(console, "log").mockImplementation((...data: unknown[]) => void lines.push(data.join(" ")))
        const { sendMessage, sendPluginMessage } = useWebsocketSender()
        // what the PluginManager sends on every page change and turn of the device, many times over
        for (let i = 0; i < 600; i++) {
            expect(sendMessage({ type: "plugin", payload: { type: "screen:changed", payload: { pathname: `/p${i}` } } })).toBe(false)
            sendPluginMessage("screen:changed", { pathname: `/p${i}`, query: "" }, "")
            sendPluginMessage("dom:viewport-size", { width: 400, height: i }, "")
        }
        expect(vi.getTimerCount()).toBe(0)
        vi.advanceTimersByTime(60_000)
        expect(vi.getTimerCount()).toBe(0)
        expect(lines.filter(line => line.includes("WebsocketSender"))).toEqual([])
    })
})
