import type { HibikeTorrent_AnimeTorrent, Torrentstream_FilePreview } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { chosenBytes, defaultFileChoice, fileChoiceRequest, fileRowsOf, spaceStateOf, toggledFile, wantsFileChoice } from "./file-choice"

// The file list of a real batch as the core's torrent-file-previews hands it on (a folder, 28 episodes would be long:
// four episodes, an opening and a file without an episode number)
const MiB = 1024 ** 2
const FOLDER = "[ASW] Sousou no Frieren - 01-28 [1080p HEVC x265 10Bit][AAC]"
function preview(index: number, file: string, episode: number, size: number): Torrentstream_FilePreview {
    return {
        path: `${FOLDER}/${file}`, displayPath: FOLDER, displayTitle: episode ? `Episode ${episode}` : file,
        episodeNumber: episode, relativeEpisodeNumber: episode, isLikely: false, index, size,
    }
}
const PREVIEWS = [
    preview(3, "[ASW] Sousou no Frieren - 04 [1080p HEVC][2D3C1A2B].mkv", 4, 310 * MiB),
    preview(0, "[ASW] Sousou no Frieren - 01 [1080p HEVC][5E1B5E0D].mkv", 1, 420 * MiB),
    preview(5, "[ASW] Sousou no Frieren - NCOP1 [1080p HEVC].mkv", 1, 60 * MiB),
    preview(1, "[ASW] Sousou no Frieren - 02 [1080p HEVC][A1B2C3D4].mkv", 2, 300 * MiB),
    preview(2, "[ASW] Sousou no Frieren - 03 [1080p HEVC][0F0E0D0C].mkv", 3, 305 * MiB),
]

describe("the download sheet's file choice", () => {
    it("lists the files in episode order, the extras after them under their own name", () => {
        const rows = fileRowsOf(PREVIEWS)
        expect(rows.map(row => [row.index, row.title])).toEqual([
            [0, "Episode 1"], [1, "Episode 2"], [2, "Episode 3"], [3, "Episode 4"], [5, "[ASW] Sousou no Frieren - NCOP1 [1080p HEVC].mkv"],
        ])
        expect(rows.at(-1)!.extra).toBe(true)
        expect(fileRowsOf(undefined)).toEqual([])
    })

    it("starts from the missing episodes when only those were to load, else from every file", () => {
        const rows = fileRowsOf(PREVIEWS)
        expect([...defaultFileChoice(rows, [2, 3], true)].sort()).toEqual([1, 2])
        // the opening numbers episode 1 too, but is no episode
        expect([...defaultFileChoice(rows, [1], true)]).toEqual([0])
        expect(defaultFileChoice(rows, [2, 3], false).size).toBe(5)
        // no file of the missing episodes: every file rather than none
        expect(defaultFileChoice(rows, [27, 28], true).size).toBe(5)
    })

    it("adds up the chosen files live and says whether they fit", () => {
        const rows = fileRowsOf(PREVIEWS)
        let chosen = defaultFileChoice(rows, [2, 3], true)
        expect(chosenBytes(rows, chosen)).toBe(605 * MiB)
        chosen = toggledFile(chosen, 3)
        expect(chosenBytes(rows, chosen)).toBe(915 * MiB)
        chosen = toggledFile(chosen, 1)
        expect(chosenBytes(rows, chosen)).toBe(615 * MiB)
        expect(spaceStateOf(615 * MiB, 600 * MiB)).toBe("full")
        expect(spaceStateOf(615 * MiB, 4096 * MiB)).toBe("fits")
        expect(spaceStateOf(615 * MiB, null)).toBe("unknown")
        expect(spaceStateOf(0, 100)).toBe("unknown")
    })

    it("sends the files left out by index, and nothing when every file is chosen (the whole torrent)", () => {
        const rows = fileRowsOf(PREVIEWS)
        expect(fileChoiceRequest(rows, new Set([1, 2]))).toEqual({
            smartSelect: { enabled: false, missingEpisodeNumbers: [] },
            deselect: { enabled: true, indices: [0, 3, 5] },
        })
        expect(fileChoiceRequest(rows, new Set([0, 1, 2, 3, 5]))).toEqual({ smartSelect: { enabled: false, missingEpisodeNumbers: [] } })
    })

    it("is offered for one batch torrent only", () => {
        const batch = { name: "[Judas] Sousou no Frieren (Season 2) [1080p][HEVC x265 10bit][Multi-Subs] (Batch)", isBatch: false, size: 9e9 } as HibikeTorrent_AnimeTorrent
        const episode = { name: "[SubsPlease] Sousou no Frieren S2 - 05 (1080p) [4277EF46].mkv", isBatch: false, size: 1.4e9 } as HibikeTorrent_AnimeTorrent
        expect(wantsFileChoice([batch], false)).toBe(true)
        expect(wantsFileChoice([episode], false)).toBe(false)
        // a range in the name the facts read ("01-28")
        expect(wantsFileChoice([{ ...episode, name: FOLDER }], true)).toBe(true)
        expect(wantsFileChoice([batch, batch], true)).toBe(false)
    })
})
