import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Every event listener of the web main layout runs in the native main layout too (device run 06.11.: without the
// extension listener an installed extension stayed missing from the list and the torrent sheet until a manual refresh).
// Two are left out on purpose (NATIVE-UMBAU §9): the external-player link (the app opens players itself) and the torrent
// stream listener (preloading the next playlist episode, not ported).
// Stage 8a-2 (docs/EIGENER-KERN.md §4s): backend/seanime-web left the repo. The list below is what the native layout
// called at cc0d8e7, where this test still read the web layout and was green: it covers every web listener but those two.
const WEB_LISTENERS = [
    "useMiscEventListeners",
    "useAnimeCollectionListener",
    "useExtensionListener",
    "useMangaListener",
    "useInvalidateQueriesListener",
    "useAuthEventListeners",
]

describe("main layout listeners", () => {
    it("calls every listener the web main layout calls", () => {
        const native = readFileSync(join(__dirname, "../../app/(main)/_layout.tsx"), "utf8")
        const missing = WEB_LISTENERS.filter(name => !new RegExp(`^\\s*${name}\\(\\)`, "m").test(native))
        expect(missing).toEqual([])
    })
})
