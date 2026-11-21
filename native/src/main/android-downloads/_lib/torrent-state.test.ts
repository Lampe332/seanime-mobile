import type { TorrentClient_Torrent } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { peopleText, removeNote, torrentStateOf, torrentStateText } from "./torrent-state"

const en = (text: string) => text
const state = (status: TorrentClient_Torrent["status"], progress: number) => torrentStateOf({ status, progress })

// 4.2.0: "Done · sharing" with a "Pause" button left people asking "does this mean I am seeding?"
describe("torrent state in plain words", () => {
    it("tells a finished torrent that seeds from one that does not", () => {
        expect(state("seeding", 1)).toBe("seeding")
        expect(state("paused", 1)).toBe("done")
        expect(state("stopped", 1)).toBe("done")
        expect(torrentStateText("seeding", en)).toMatchObject({ title: "Done · Seeding", short: "Seeding", action: "pause", actionLabel: "Stop seeding" })
        expect(torrentStateText("done", en)).toMatchObject({ title: "Done · Not seeding", short: "Not seeding", action: "resume", actionLabel: "Start seeding" })
        expect(torrentStateText("seeding", en).note).toContain("While the app is open")
    })

    it("keeps pause and resume for a download, and try again for a failed one", () => {
        expect(state("downloading", 0.4)).toBe("downloading")
        expect(state("other", 0)).toBe("preparing")
        expect(state("queued", 0)).toBe("waiting")
        expect(state("paused", 0.5)).toBe("paused")
        expect(state("error", 1)).toBe("failed")
        expect(torrentStateText("downloading", en)).toMatchObject({ action: "pause", actionLabel: "Pause download" })
        expect(torrentStateText("waiting", en)).toMatchObject({ action: "pause", actionLabel: "Pause download" })
        expect(torrentStateText("paused", en)).toMatchObject({ action: "resume", actionLabel: "Resume download" })
        expect(torrentStateText("failed", en)).toMatchObject({ action: "resume", actionLabel: "Try again" })
    })

    it("counts people and names what removing stops", () => {
        expect(peopleText(0, en)).toBe("0 people right now")
        expect(peopleText(1, en)).toBe("1 person right now")
        expect(removeNote("seeding", en)).toBe("Stops seeding. The files stay in your library.")
        expect(removeNote("downloading", en)).toBe("Stops the download. What is already loaded stays.")
    })
})
