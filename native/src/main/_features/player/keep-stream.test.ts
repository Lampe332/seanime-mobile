import { describe, expect, it } from "vitest"
import { keepFailureText, keepRowOf, keepsTorrentStream } from "./keep-stream"
import { MENU_GROUP_MIN_WIDTH, landscapeMenuPlacement, menuGroupLayout } from "./player-menu-logic"

const en = (text: string) => text

describe("Keep in library", () => {
    it("is there only while the core's torrent stream plays", () => {
        const torrent = { streamType: "torrent", streamUrl: "http://127.0.0.1:1/t/x.mkv" }
        expect(keepsTorrentStream(torrent, false, false)).toBe(true)
        // still starting (no address), a saved or an online episode, a local file
        expect(keepsTorrentStream({ streamType: "torrent", streamUrl: "" }, false, false)).toBe(false)
        expect(keepsTorrentStream(torrent, true, false)).toBe(false)
        expect(keepsTorrentStream(torrent, false, true)).toBe(false)
        expect(keepsTorrentStream({ streamType: "file", streamUrl: "file:///x.mkv" }, false, false)).toBe(false)
        expect(keepsTorrentStream(null, false, false)).toBe(false)
        expect(keepRowOf(false, "idle", en)).toBeNull()
    })

    it("can be tapped once; while moving and once kept it says so and waits", () => {
        expect(keepRowOf(true, "idle", en)).toEqual({ label: "Keep in library", disabled: false })
        expect(keepRowOf(true, "keeping", en)).toEqual({ label: "Moving to library …", disabled: true })
        expect(keepRowOf(true, "kept", en)).toEqual({ label: "Kept in library", disabled: true })
    })

    it("says in the user's words what went wrong and that the stream goes on", () => {
        expect(keepFailureText("Not enough free space: the download needs 1.2 GB, 300.0 MB are free.", en))
            .toBe("Not enough free space: the download needs 1.2 GB, 300.0 MB are free. The stream goes on.")
        expect(keepFailureText("the files could not be moved: the files cannot be moved: No space left on device", en))
            .toBe("Not enough free storage to keep this episode. The stream goes on.")
        expect(keepFailureText("no torrent stream is running", en)).toBe("The stream has already ended.")
        expect(keepFailureText("the destination must be a folder on the phone", en)).toBe("Set a library folder in Settings first.")
        expect(keepFailureText("the files could not be moved: Input/output error", en))
            .toBe("This episode could not be kept. The stream goes on. (the files could not be moved: Input/output error)")
    })
})

describe("the menu group with the row on phones and tablets", () => {
    it("is one full-width column upright, phone and tablet alike", () => {
        expect(menuGroupLayout(360, false)).toEqual({ columns: 1, groupWidth: undefined })
        expect(menuGroupLayout(800, false)).toEqual({ columns: 1, groupWidth: undefined })
    })

    it("sits beside the others in landscape, never narrower than 14.5rem: S22, tablet, small tablet", () => {
        for (const [screen, isTablet] of [[{ width: 823, height: 384 }, false], [{ width: 1280, height: 800 }, true], [{ width: 960, height: 600 }, true]] as const) {
            const { width } = landscapeMenuPlacement(screen, { x: screen.width - 100, y: 8, width: 48, height: 48 }, isTablet)
            const { columns, groupWidth } = menuGroupLayout(width, true)
            expect(columns).toBeGreaterThanOrEqual(2)
            expect(groupWidth!).toBeGreaterThanOrEqual(MENU_GROUP_MIN_WIDTH)
            // the groups and their gaps fill the menu, nothing hangs over its edge
            expect(columns * groupWidth! + (columns - 1) * 8).toBeCloseTo(width - 16)
        }
        // a narrow landscape window (split screen) falls back to one column
        expect(menuGroupLayout(300, true).columns).toBe(1)
    })
})
