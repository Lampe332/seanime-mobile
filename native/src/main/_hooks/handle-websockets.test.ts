import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// The hook needs React and a socket; its rule is read from the source (style of client-providers.test.ts).
// Callers list sendMessage in effect dependencies (player status interval, Nakama status, playlist), so it must never change.
describe("websocket sender", () => {
    const source = readFileSync(join(__dirname, "handle-websockets.ts"), "utf8")
    const sender = source.slice(source.indexOf("export function useWebsocketSender"), source.indexOf("export type WebSocketMessageListener"))

    it("hands out functions that stay the same across renders and call the latest ones", () => {
        expect(sender).toMatch(/return useMemo\(\(\) => \(\{[\s\S]*latest\.current\.sendMessage\(data\)[\s\S]*latest\.current\.addPluginEventToBatch\(type, payload, extensionId\)[\s\S]*\}\), \[\]\)\s*\}\s*\/\/\/\//)
        expect(sender).toMatch(/useLayoutEffect\(\(\) => \{\s*latest\.current = \{ sendMessage, addPluginEventToBatch \}\s*\}\)/)
    })

    it("is what the player's status interval depends on", () => {
        const player = readFileSync(join(__dirname, "../_features/player/use-player-server.ts"), "utf8")
        expect(player).toContain("const { sendMessage } = useWebsocketSender()")
        expect(player).toMatch(/setInterval\(\(\) => send\("video-status", timePayload\(\)\), 1000\)/)
    })
})
