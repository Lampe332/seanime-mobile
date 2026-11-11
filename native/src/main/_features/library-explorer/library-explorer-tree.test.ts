import { describe, expect, it } from "vitest"
import { findDir, folderTrail, formatSize, matchesFilter, normPath, sortChildren, treeFiles } from "./library-explorer-tree"

const file = (path: string, extra: Record<string, unknown> = {}) => ({ name: path.split("/").pop()!, path, normalizedPath: path, kind: "file", ...extra }) as any
const dir = (path: string, children: any[]) => ({ name: path.split("/").pop()!, path, normalizedPath: path, kind: "directory", children }) as any

const season = dir("D:/Anime/Show/Season 1", [file("D:/Anime/Show/Season 1/Episode 10.mkv"), file("D:/Anime/Show/Season 1/Episode 2.mkv")])
const root = dir("D:/Anime", [file("D:/Anime/loose.mkv"), dir("D:/Anime/Show", [season]), dir("D:/Anime/Another", [])])

describe("phone library explorer", () => {
    it("walks the tree: every file, the trail to a folder (case-blind, either slash), a gone path ends the trail", () => {
        expect(treeFiles(root).map(node => node.name)).toEqual(["loose.mkv", "Episode 10.mkv", "Episode 2.mkv"])
        expect(findDir(root, normPath("d:\\anime\\show\\season 1\\"))?.map(node => node.name)).toEqual(["Anime", "Show", "Season 1"])
        expect(findDir(root, normPath("D:/Elsewhere"))).toBeNull()
        expect(folderTrail(root, ["D:/Anime/Show", "D:/Anime/Show/Gone"]).map(node => node.name)).toEqual(["Anime", "Show"])
    })

    it("lists folders first and names in natural order", () => {
        expect(sortChildren(root.children).map((node: any) => node.name)).toEqual(["Another", "Show", "loose.mkv"])
        expect(sortChildren(season.children).map((node: any) => node.name)).toEqual(["Episode 2.mkv", "Episode 10.mkv"])
    })

    it("filters: without anime (not ignored), ignored, matched but not locked", () => {
        const lf = (extra: Record<string, unknown>) => ({ path: "x", mediaId: 0, locked: false, ignored: false, ...extra }) as any
        expect([matchesFilter(lf({}), "unmatched"), matchesFilter(lf({ ignored: true }), "unmatched"), matchesFilter(undefined, "unmatched")]).toEqual([true, false, false])
        expect(matchesFilter(lf({ ignored: true, mediaId: 5 }), "ignored")).toBe(true)
        expect([matchesFilter(lf({ mediaId: 5 }), "unlocked"), matchesFilter(lf({ mediaId: 5, locked: true }), "unlocked")]).toEqual([true, false])
    })

    it("writes sizes like the old sheet", () => {
        expect([formatSize(0), formatSize(512), formatSize(2048), formatSize(1.5 * 1024 ** 3)]).toEqual(["", "512 B", "2 KB", "1.5 GB"])
    })
})
