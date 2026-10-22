import { createStore } from "jotai"
import { toast } from "sonner"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { nativePlayer_stateAtom } from "./native-player.atoms"
import { streamStartError, toastStreamStartError } from "./stream-start-error"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

const en = (english: string) => english
const de = (_: string, german: string) => german
const failure = (error: string) => ({ response: { data: { error } } })

describe("stream start errors on phones", () => {
    beforeEach(() => vi.mocked(toast.error).mockClear())

    it("says what to do when nobody shares the torrent", () => {
        expect(streamStartError("timeout waiting for torrent info", en)).toBe("Nobody is sharing this torrent right now. Choose one with more seeders.")
        expect(streamStartError("torrentstream: timeout waiting for torrent info", de)).toBe("Diesen Torrent teilt gerade niemand. Wähle einen mit mehr Seedern.")
        expect(streamStartError("torbox: download limit reached", en)).toBe("torbox: download limit reached")
    })

    it("names the missing episode and the way out of a failed pick", () => {
        expect(streamStartError("could not find episode 2 in torrent", en)).toBe("This torrent has no episode 2. Choose another one.")
        expect(streamStartError("could not find episode 12 in torrent", de)).toBe("In diesem Torrent fehlt Folge 12. Wähle einen anderen.")
        expect(streamStartError("could not select episode from torrents, please select manually", en))
            .toBe("No torrent with this episode was found. Turn off \"Pick the best torrent\" to choose one yourself.")
        expect(streamStartError("no files found in the torrent", en)).toBe("This torrent has no video to play. Choose another one.")
    })

    it("shows the reason while the player is open", () => {
        const store = createStore()
        store.set(nativePlayer_stateAtom, draft => { draft.active = true })
        toastStreamStartError(failure("timeout waiting for torrent info"), en, store)
        expect(toast.error).toHaveBeenCalledWith("Nobody is sharing this torrent right now. Choose one with more seeders.", { id: "stream-start-error" })
    })

    it("stays quiet once the user left the player with Back", () => {
        const store = createStore()
        toastStreamStartError(failure("timeout waiting for torrent info"), en, store)
        expect(toast.error).not.toHaveBeenCalled()
    })
})
