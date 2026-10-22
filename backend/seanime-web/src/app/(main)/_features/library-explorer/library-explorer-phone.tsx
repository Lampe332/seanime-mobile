import { useGetLibraryExplorerFileTree, useRefreshLibraryExplorerFileTree } from "@/api/generated/library_explorer.hooks"
import { Anime_LocalFile, LibraryExplorer_FileTreeNodeJSON } from "@/api/generated/types"
import { useGetLibraryCollection } from "@/api/hooks/anime_collection.hooks"
import { useDeleteLocalFiles, useUpdateLocalFiles } from "@/api/hooks/localfiles.hooks"
import { __unmatchedFileManagerIsOpen } from "@/app/(main)/_features/anime-library/_containers/unmatched-file-manager"
import { UnmatchedPhoneSheet } from "@/app/(main)/_features/anime-library/_screens/library-phone"
import { libraryExplorer_drawerOpenAtom, libraryExplorer_openDirectoryAtom } from "@/app/(main)/_features/library-explorer/library-explorer.atoms"
import {
    PhoneChips,
    PhoneEmpty,
    PhoneIconButton,
    PhoneLoading,
    PhoneRow,
    PhoneSearchField,
    PhoneSheet,
    PhoneSheetGroup,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import { Translate, useTr } from "@/lib/app-language"
import { upath } from "@/lib/helpers/upath"
import { useAtom, useSetAtom } from "jotai/react"
import React from "react"
import { LuArrowUp, LuFile, LuFileQuestion, LuFileX, LuFolder, LuLock, LuLockOpen, LuRefreshCw, LuTrash2, LuUnlink } from "react-icons/lu"
import "./library-explorer-phone.css"

/**
 * The library explorer on Android phones, instead of the desktop tree that only renders on large screens: the library's
 * folders one level at a time, files with their anime, episode and state, filters that list every file without an anime,
 * ignored or not locked, a name search, and each file's jobs (match, unmatch, lock, ignore, delete) in its own view.
 */

type Filter = "unmatched" | "ignored" | "unlocked"
type Node = LibraryExplorer_FileTreeNodeJSON
const plural = (t: Translate, n: number, en: [string, string], de: [string, string]) => `${n} ${n === 1 ? t(en[0], de[0]) : t(en[1], de[1])}`
const norm = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

function size(bytes?: number) {
    if (!bytes) return ""
    const units = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    return `${(bytes / 1024 ** i).toFixed(i < 2 ? 0 : 1)} ${units[i]}`
}

function files(node: Node | undefined, out: Node[] = []): Node[] {
    if (!node) return out
    if (node.kind === "file") out.push(node)
    node.children?.forEach(child => files(child, out))
    return out
}

function findDir(node: Node | undefined, path: string): Node[] | null {
    if (!node) return null
    if (norm(node.path) === path) return [node]
    for (const child of node.children ?? []) {
        if (child.kind !== "directory" || !path.startsWith(norm(child.path))) continue
        const trail = findDir(child, path)
        if (trail) return [node, ...trail]
    }
    return null
}

const matchesFilter = (lf: Anime_LocalFile | undefined, filter: Filter) => !!lf && (filter === "unmatched" ? !lf.mediaId && !lf.ignored
    : filter === "ignored" ? lf.ignored : !!lf.mediaId && !lf.locked && !lf.ignored)

export function LibraryExplorerPhone() {
    const t = useTr()
    const [open, setOpen] = useAtom(libraryExplorer_drawerOpenAtom)
    const [openDirectory, setOpenDirectory] = useAtom(libraryExplorer_openDirectoryAtom)
    const setUnmatchedOpen = useSetAtom(__unmatchedFileManagerIsOpen)
    const { data: tree, isLoading } = useGetLibraryExplorerFileTree()
    const { mutate: refresh, isPending: refreshing } = useRefreshLibraryExplorerFileTree()
    const { data: collection } = useGetLibraryCollection()
    const { mutate: updateFiles, isPending: updating } = useUpdateLocalFiles()
    const { mutate: deleteFiles, isPending: deleting } = useDeleteLocalFiles()

    const [trailPaths, setTrailPaths] = React.useState<string[]>([])
    const [filter, setFilter] = React.useState<Filter | null>(null)
    const [query, setQuery] = React.useState("")
    const [filePath, setFilePath] = React.useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = React.useState(false)
    const [matchGroup, setMatchGroup] = React.useState<{ dir: string, localFiles: Anime_LocalFile[] } | null>(null)

    const titles = React.useMemo(() => {
        const map = new Map<number, string>()
        collection?.lists?.forEach(list => list.entries?.forEach(entry => map.set(entry.mediaId, entry.media?.title?.userPreferred || "")))
        return map
    }, [collection])
    const root = tree?.root
    const all = React.useMemo(() => files(root), [root])

    // Open at the folder asked for ("Open in library explorer"), else where the user left off
    React.useEffect(() => {
        if (!open || !root) return
        if (openDirectory) {
            const trail = findDir(root, norm(openDirectory))
            if (trail) setTrailPaths(trail.slice(1).map(node => node.path))
            setOpenDirectory(null)
        }
    }, [open, root, openDirectory])
    React.useEffect(() => {
        if (open) return
        setFilePath(null)
        setConfirmDelete(false)
    }, [open])

    const trail = React.useMemo(() => {
        const nodes: Node[] = root ? [root] : []
        for (const path of trailPaths) {
            const next = nodes[nodes.length - 1]?.children?.find(child => child.path === path && child.kind === "directory")
            if (!next) break
            nodes.push(next)
        }
        return nodes
    }, [root, trailPaths])
    const folder = trail[trail.length - 1]
    const lf = (node: Node) => node.localFile ?? tree?.localFiles?.[node.path]
    const file = filePath ? all.find(node => node.path === filePath) : undefined
    const fileLf = file ? lf(file) : undefined

    const q = query.trim().toLowerCase()
    const flat = filter || q ? all.filter(node => (!filter || matchesFilter(lf(node), filter)) && (!q || node.name.toLowerCase().includes(q))) : null
    const children = [...(folder?.children ?? [])].sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "directory" ? -1 : 1)
    const counts = { unmatched: all.filter(node => matchesFilter(lf(node), "unmatched")).length, ignored: all.filter(node => matchesFilter(lf(node), "ignored")).length,
        unlocked: all.filter(node => matchesFilter(lf(node), "unlocked")).length }

    const state = (local?: Anime_LocalFile) => {
        if (!local) return t("Not scanned yet", "Noch nicht gescannt")
        if (local.ignored) return t("Ignored", "Ignoriert")
        if (!local.mediaId) return t("No anime", "Kein Anime")
        return [titles.get(local.mediaId) || t(`AniList ID ${local.mediaId}`, `AniList-ID ${local.mediaId}`),
            local.metadata?.episode ? t(`Episode ${local.metadata.episode}`, `Folge ${local.metadata.episode}`) : "", local.locked ? t("locked", "gesperrt") : ""].filter(Boolean).join(" · ")
    }
    const fileRow = (node: Node) => {
        const local = lf(node)
        const tone = local && !local.mediaId && !local.ignored ? "attention" : undefined
        return <PhoneRow key={node.path} icon={local?.ignored ? <LuFileX /> : !local || !local.mediaId ? <LuFileQuestion /> : <LuFile />} tone={tone} label={node.name}
            note={flat ? `${state(local)} · ${upath.basename(upath.dirname(node.path))}` : state(local)} chevron data-explorer-file={node.path} onClick={() => setFilePath(node.path)} />
    }

    // A file's jobs, in the same sheet
    if (file) {
        const local = fileLf
        const busy = updating || deleting
        const act = (action: "lock" | "unlock" | "ignore" | "unignore" | "unmatch") => updateFiles({ paths: [file.path], action })
        if (confirmDelete) return <PhoneSheet title={t("Delete this file?", "Diese Datei löschen?")} open={open} onOpenChange={setOpen} data-explorer-confirm
            footer={<>
                <button type="button" className="ps-secondary" onClick={() => setConfirmDelete(false)}>{t("Back", "Zurück")}</button>
                <button type="button" className="ps-primary" data-tone="danger" disabled={busy} data-explorer-delete-confirm
                    onClick={() => deleteFiles({ paths: [file.path] }, {
                        onSuccess: () => {
                            setConfirmDelete(false)
                            setFilePath(null)
                        },
                    })}>{t("Delete", "Löschen")}</button>
            </>}>
            <p className="ps-sheet-text">{t(`${file.name} is deleted from this phone. This can't be undone.`, `${file.name} wird von diesem Handy gelöscht. Das lässt sich nicht rückgängig machen.`)}</p>
        </PhoneSheet>
        return <>
            <PhoneSheet title={file.name} open={open && !matchGroup} onOpenChange={setOpen} className="plx-sheet" data-explorer-file-view>
                <div className="plx-back"><button type="button" className="ps-text-action" onClick={() => setFilePath(null)} data-explorer-file-back>
                    <LuArrowUp aria-hidden />{t("Back to the folder", "Zurück zum Ordner")}</button></div>
                <dl className="ps-facts" data-explorer-file-facts>
                    <div><dt>{t("Anime", "Anime")}</dt><dd>{local?.mediaId ? (titles.get(local.mediaId) || t(`AniList ID ${local.mediaId}`, `AniList-ID ${local.mediaId}`)) : "–"}</dd></div>
                    <div><dt>{t("Episode", "Folge")}</dt><dd>{local?.metadata?.episode || "–"}</dd></div>
                    <div><dt>{t("State", "Status")}</dt><dd>{!local ? t("Not scanned yet", "Noch nicht gescannt") : local.ignored ? t("Ignored", "Ignoriert")
                        : local.locked ? t("Locked", "Gesperrt") : t("Not locked", "Nicht gesperrt")}</dd></div>
                    {!!file.size && <div><dt>{t("Size", "Größe")}</dt><dd>{size(file.size)}</dd></div>}
                    <div><dt>{t("Folder", "Ordner")}</dt><dd className="plx-path">{upath.dirname(file.path)}</dd></div>
                </dl>
                {!!local && <div className="ps-rows" data-explorer-file-actions>
                    {!local.mediaId && !local.ignored && <PhoneRow icon={<LuFileQuestion />} tone="attention" label={t("Match to an anime", "Einem Anime zuordnen")} chevron
                        data-explorer-action="match" onClick={() => {
                            setMatchGroup({ dir: upath.dirname(file.path), localFiles: [local] })
                            setTimeout(() => setUnmatchedOpen(true), 150)
                        }} />}
                    {!!local.mediaId && <PhoneRow icon={<LuUnlink />} label={t("Unmatch", "Zuordnung lösen")} note={t("It goes back to the unmatched files", "Sie kommt zurück zu den Dateien ohne Anime")}
                        disabled={busy} data-explorer-action="unmatch" onClick={() => act("unmatch")} />}
                    {!local.ignored && (local.locked
                        ? <PhoneRow icon={<LuLockOpen />} label={t("Unlock", "Entsperren")} note={t("Scans may change its anime again", "Scans dürfen ihren Anime wieder ändern")} disabled={busy}
                            data-explorer-action="unlock" onClick={() => act("unlock")} />
                        : <PhoneRow icon={<LuLock />} label={t("Lock", "Sperren")} note={t("Scans keep its anime", "Scans behalten ihren Anime")} disabled={busy}
                            data-explorer-action="lock" onClick={() => act("lock")} />)}
                    {local.ignored
                        ? <PhoneRow icon={<LuFile />} label={t("Stop ignoring", "Nicht mehr ignorieren")} disabled={busy} data-explorer-action="unignore" onClick={() => act("unignore")} />
                        : <PhoneRow icon={<LuFileX />} label={t("Ignore", "Ignorieren")} note={t("Scans skip it", "Scans überspringen sie")} disabled={busy}
                            data-explorer-action="ignore" onClick={() => act("ignore")} />}
                    <PhoneRow icon={<LuTrash2 />} tone="danger" label={t("Delete", "Löschen")} disabled={busy} data-explorer-action="delete" onClick={() => setConfirmDelete(true)} />
                </div>}
            </PhoneSheet>
            {!!matchGroup && <UnmatchedPhoneSheet unmatchedGroups={[matchGroup]} onDone={() => setMatchGroup(null)} />}
        </>
    }

    return <PhoneSheet title={t("Library files", "Bibliotheksdateien")} open={open} onOpenChange={setOpen} className="plx-sheet" data-library-explorer-phone>
        <PhoneSearchField t={t} value={query} onChange={setQuery} placeholder={t("Search file names", "Dateinamen suchen")} data-explorer-search />
        <PhoneChips label={t("Show only", "Nur zeigen")} selected={filter ? [filter] : []} onToggle={value => setFilter(current => current === value ? null : value as Filter)}
            chips={[{ value: "unmatched", label: t("No anime", "Ohne Anime"), count: counts.unmatched }, { value: "ignored", label: t("Ignored", "Ignoriert"), count: counts.ignored },
                { value: "unlocked", label: t("Not locked", "Nicht gesperrt"), count: counts.unlocked }]} data-explorer-filters />
        {isLoading ? <PhoneLoading label={t("Loading files", "Dateien werden geladen")} layout={["row", "row", "row", "row"]} />
            : !root ? <PhoneEmpty title={t("No library folder", "Kein Bibliotheksordner")} text={t("Choose one in Settings, then scan it.", "Wähle einen in den Einstellungen und scanne ihn dann.")} />
                : flat ? <PhoneSheetGroup title={filter ? t("Files", "Dateien") : t("Results", "Treffer")} note={plural(t, flat.length, ["file", "files"], ["Datei", "Dateien"])} data-explorer-flat>
                        {flat.length ? <div className="ps-rows">{flat.slice(0, 200).map(fileRow)}</div>
                            : <PhoneEmpty title={t("No file here", "Keine Datei")} text={q ? t("Try another part of the name.", "Versuch einen anderen Teil des Namens.") : undefined} />}
                    </PhoneSheetGroup>
                    : <>
                        <div className="plx-folder" data-explorer-folder={folder?.path}>
                            {trail.length > 1 && <PhoneIconButton label={t("Up one folder", "Einen Ordner hoch")} onClick={() => setTrailPaths(paths => paths.slice(0, -1))} data-explorer-up>
                                <LuArrowUp aria-hidden /></PhoneIconButton>}
                            <div className="plx-folder-text">
                                <p>{folder?.name || t("Library", "Bibliothek")}</p>
                                <small>{[plural(t, folder?.localFileCount ?? 0, ["file", "files"], ["Datei", "Dateien"]),
                                    t(`${folder?.matchedLocalFileCount ?? 0} with an anime`, `${folder?.matchedLocalFileCount ?? 0} mit Anime`)].join(" · ")}</small>
                            </div>
                            <PhoneIconButton label={t("Read the folders again", "Ordner neu einlesen")} disabled={refreshing} onClick={() => refresh()} data-explorer-refresh>
                                <LuRefreshCw aria-hidden className={refreshing ? "ps-spin" : undefined} /></PhoneIconButton>
                        </div>
                        {!children.length ? <PhoneEmpty title={t("This folder is empty", "Dieser Ordner ist leer")} />
                            : <div className="ps-rows" data-explorer-children>
                                {children.map(node => node.kind === "directory"
                                    ? <PhoneRow key={node.path} icon={<LuFolder />} label={node.name} chevron data-explorer-dir={node.path}
                                        note={[plural(t, node.localFileCount ?? 0, ["file", "files"], ["Datei", "Dateien"]),
                                            (node.localFileCount ?? 0) > (node.matchedLocalFileCount ?? 0)
                                                ? t(`${(node.localFileCount ?? 0) - (node.matchedLocalFileCount ?? 0)} without an anime`, `${(node.localFileCount ?? 0) - (node.matchedLocalFileCount ?? 0)} ohne Anime`) : ""]
                                            .filter(Boolean).join(" · ")}
                                        tone={(node.localFileCount ?? 0) > (node.matchedLocalFileCount ?? 0) ? "attention" : undefined}
                                        onClick={() => setTrailPaths(paths => [...paths, node.path])} />
                                    : fileRow(node))}
                            </div>}
                    </>}
    </PhoneSheet>
}
