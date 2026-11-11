import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Every WebSocket listener of the web main layout runs in the native main layout too (device run 06.11.: without the
// extension listener an installed extension stayed missing from the list and the torrent sheet until a manual refresh).
// Two are left out on purpose (NATIVE-UMBAU §9): the external-player link (the app opens players itself) and the torrent
// stream listener (preloading the next playlist episode, not ported).
const NOT_PORTED = new Set(["useExternalPlayerLinkListener", "useTorrentStreamListener"])

describe("main layout listeners", () => {
    it("calls every listener the web main layout calls", () => {
        const web = readFileSync(join(__dirname, "../../../../backend/seanime-web/src/app/(main)/_features/layout/main-layout.tsx"), "utf8")
        const native = readFileSync(join(__dirname, "../../app/(main)/_layout.tsx"), "utf8")
        const listeners = [...web.matchAll(/^\s*(use\w+Listeners?)\(\)/gm)].map(match => match[1])
        expect(listeners.length).toBeGreaterThan(5)
        const missing = listeners.filter(name => !NOT_PORTED.has(name) && !new RegExp(`^\\s*${name}\\(\\)`, "m").test(native))
        expect(missing).toEqual([])
    })
})
