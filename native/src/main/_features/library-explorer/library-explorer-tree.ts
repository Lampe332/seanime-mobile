import type { Anime_LocalFile, LibraryExplorer_FileTreeNodeJSON } from "@/api/generated/types"

/** Pure parts of the phone library explorer (library-explorer-phone.tsx, here and on the web): the tree walk, the filters, sizes. */

export type ExplorerFilter = "unmatched" | "ignored" | "unlocked"
export type ExplorerNode = LibraryExplorer_FileTreeNodeJSON

/** A path compared case-blind with forward slashes and no trailing slash. */
export const normPath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

export function formatSize(bytes?: number) {
    if (!bytes) return ""
    const units = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    return `${(bytes / 1024 ** i).toFixed(i < 2 ? 0 : 1)} ${units[i]}`
}

/** Every file under a node. */
export function treeFiles(node: ExplorerNode | undefined, out: ExplorerNode[] = []): ExplorerNode[] {
    if (!node) return out
    if (node.kind === "file") out.push(node)
    node.children?.forEach(child => treeFiles(child, out))
    return out
}

/** The folders from the root down to the one at `path` (normalized), or null when the tree has no such folder. */
export function findDir(node: ExplorerNode | undefined, path: string): ExplorerNode[] | null {
    if (!node) return null
    if (normPath(node.path) === path) return [node]
    for (const child of node.children ?? []) {
        if (child.kind !== "directory" || !path.startsWith(normPath(child.path))) continue
        const trail = findDir(child, path)
        if (trail) return [node, ...trail]
    }
    return null
}

/** No anime (and not ignored), ignored, or matched but not locked. */
export const matchesFilter = (lf: Anime_LocalFile | undefined, filter: ExplorerFilter) => !!lf && (filter === "unmatched" ? !lf.mediaId && !lf.ignored
    : filter === "ignored" ? !!lf.ignored : !!lf.mediaId && !lf.locked && !lf.ignored)

/** Folders first, then files, each in natural name order ("Episode 2" before "Episode 10"). */
export function sortChildren(children: ExplorerNode[] | undefined) {
    return [...(children ?? [])].sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "directory" ? -1 : 1)
}

/** The opened folders (paths below the root) as nodes; a path that is gone ends the trail there. */
export function folderTrail(root: ExplorerNode | undefined, trailPaths: string[]) {
    const nodes: ExplorerNode[] = root ? [root] : []
    for (const path of trailPaths) {
        const next = nodes[nodes.length - 1]?.children?.find(child => child.path === path && child.kind === "directory")
        if (!next) break
        nodes.push(next)
    }
    return nodes
}
