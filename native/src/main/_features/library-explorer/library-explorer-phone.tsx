import { useGetLibraryExplorerFileTree, useRefreshLibraryExplorerFileTree } from "@/api/generated/library_explorer.hooks"
import type { Anime_LocalFile } from "@/api/generated/types"
import { useGetLibraryCollection } from "@/api/hooks/anime_collection.hooks"
import { useDeleteLocalFiles, useUpdateLocalFiles } from "@/api/hooks/localfiles.hooks"
import { ActionRow, Facts, LoadingRows, RowGroup, SearchField } from "@/components/shared/phone-kit"
import { ChipRow, PhoneEmpty } from "@/components/shared/phone-cards"
import { Button } from "@/components/ui/button/button"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { upath } from "@/lib/helpers/upath"
import { colors } from "@/lib/theme/tokens"
import { UnmatchedPhoneSheet } from "@/main/_features/anime-library/_screens/library-phone"
import {
    type ExplorerFilter,
    type ExplorerNode,
    findDir,
    folderTrail,
    formatSize,
    matchesFilter,
    normPath,
    sortChildren,
    treeFiles,
} from "@/main/_features/library-explorer/library-explorer-tree"
import { libraryExplorer_drawerOpenAtom, libraryExplorer_openDirectoryAtom } from "@/main/_features/library-explorer/library-explorer.atoms"
import { useAtom, useAtomValue } from "jotai"
import ArrowUp from "lucide-react-native/icons/arrow-up"
import File from "lucide-react-native/icons/file"
import FileQuestion from "lucide-react-native/icons/file-question-mark"
import FileX from "lucide-react-native/icons/file-x"
import Folder from "lucide-react-native/icons/folder"
import Lock from "lucide-react-native/icons/lock"
import LockOpen from "lucide-react-native/icons/lock-open"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import Trash2 from "lucide-react-native/icons/trash"
import Unlink from "lucide-react-native/icons/unlink"
import React from "react"
import { ActivityIndicator, Pressable, View } from "react-native"

/*
 * The library explorer on Android phones (library-explorer-phone.tsx + .css), a sheet over the page like in 2.0.33: the
 * library's folders one level at a time, files with their anime, episode and state, filters that list every file without an
 * anime, ignored or not locked, a name search, and each file's jobs (match, unmatch, lock, ignore, delete) in its own view.
 * Opened from Local library › Folders and files and from a card's "Open in library explorer" (at the title's folder).
 *
 * The web app waited 150 ms between closing this sheet and opening the match sheet (library-explorer-phone.tsx:173); the
 * native sheets hand over directly.
 */

const plural = (t: Translate, n: number, en: [string, string], de: [string, string]) => `${n} ${n === 1 ? t(en[0], de[0]) : t(en[1], de[1])}`

/** Mounted in the main layout; the file tree loads on the first opening, not with every app start. */
export function LibraryExplorerPhone() {
    const open = useAtomValue(libraryExplorer_drawerOpenAtom)
    const [used, setUsed] = React.useState(open)
    if (open && !used) setUsed(true)
    return used ? <ExplorerSheet /> : null
}

function ExplorerSheet() {
    const t = useTr()
    const [open, setOpen] = useAtom(libraryExplorer_drawerOpenAtom)
    const [openDirectory, setOpenDirectory] = useAtom(libraryExplorer_openDirectoryAtom)
    const { data: tree, isLoading } = useGetLibraryExplorerFileTree()
    const { mutate: refresh, isPending: refreshing } = useRefreshLibraryExplorerFileTree()
    const { data: collection } = useGetLibraryCollection()
    const { mutate: updateFiles, isPending: updating } = useUpdateLocalFiles()
    const { mutate: deleteFiles, isPending: deleting } = useDeleteLocalFiles()

    const [trailPaths, setTrailPaths] = React.useState<string[]>([])
    const [filter, setFilter] = React.useState<ExplorerFilter | null>(null)
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
    const all = React.useMemo(() => treeFiles(root), [root])

    // Open at the folder asked for ("Open in library explorer"), else where the user left off
    // (once per request: the asked folder is forgotten when the sheet closes, so the same card can ask again)
    const [handled, setHandled] = React.useState<string | null>(null)
    if (open && root && openDirectory && handled !== openDirectory) {
        setHandled(openDirectory)
        const trail = findDir(root, normPath(openDirectory))
        if (trail) {
            setTrailPaths(trail.slice(1).map(node => node.path))
            setFilter(null)
            setQuery("")
        }
    }
    const onOpenChange = (next: boolean) => {
        setOpen(next)
        if (next) return
        setOpenDirectory(null)
        setHandled(null)
    }
    // A closed sheet forgets the open file and the delete question
    const [wasOpen, setWasOpen] = React.useState(open)
    if (wasOpen !== open) {
        setWasOpen(open)
        if (!open) {
            setFilePath(null)
            setConfirmDelete(false)
        }
    }

    const trail = React.useMemo(() => folderTrail(root, trailPaths), [root, trailPaths])
    const folder = trail[trail.length - 1]
    const lf = (node: ExplorerNode) => node.localFile ?? tree?.localFiles?.[node.path]
    const file = filePath ? all.find(node => node.path === filePath) : undefined

    const q = query.trim().toLowerCase()
    const flat = filter || q ? all.filter(node => (!filter || matchesFilter(lf(node), filter)) && (!q || node.name.toLowerCase().includes(q))) : null
    const children = sortChildren(folder?.children)
    const counts = {
        unmatched: all.filter(node => matchesFilter(lf(node), "unmatched")).length,
        ignored: all.filter(node => matchesFilter(lf(node), "ignored")).length,
        unlocked: all.filter(node => matchesFilter(lf(node), "unlocked")).length,
    }

    const animeName = (mediaId: number) => titles.get(mediaId) || t(`AniList ID ${mediaId}`, `AniList-ID ${mediaId}`)
    const state = (local?: Anime_LocalFile) => {
        if (!local) return t("Not scanned yet", "Noch nicht gescannt")
        if (local.ignored) return t("Ignored", "Ignoriert")
        if (!local.mediaId) return t("No anime", "Kein Anime")
        return [animeName(local.mediaId), local.metadata?.episode ? t(`Episode ${local.metadata.episode}`, `Folge ${local.metadata.episode}`) : "",
            local.locked ? t("locked", "gesperrt") : ""].filter(Boolean).join(" · ")
    }
    const fileRow = (node: ExplorerNode) => {
        const local = lf(node)
        const attention = !!local && !local.mediaId && !local.ignored
        return <ActionRow key={node.path} icon={local?.ignored ? FileX : !local || !local.mediaId ? FileQuestion : File} tone={attention ? "attention" : undefined}
            label={node.name} note={flat ? `${state(local)} · ${upath.basename(upath.dirname(node.path))}` : state(local)} chevron onPress={() => setFilePath(node.path)} />
    }

    // A file's jobs, in the same sheet
    if (file) {
        const local = lf(file)
        const busy = updating || deleting
        const act = (action: "lock" | "unlock" | "ignore" | "unignore" | "unmatch") => updateFiles({ paths: [file.path], action })
        if (confirmDelete) return (
            <Sheet title={t("Delete this file?", "Diese Datei löschen?")} open={open} onOpenChange={onOpenChange}
                footer={<>
                    <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setConfirmDelete(false)}>{t("Back", "Zurück")}</Button>
                    <Button intent="danger" wrapperClassName="flex-1" disabled={busy} onPress={() => deleteFiles({ paths: [file.path] }, {
                        onSuccess: () => {
                            setConfirmDelete(false)
                            setFilePath(null)
                        },
                    })}>{t("Delete", "Löschen")}</Button>
                </>}>
                <Text className="leading-[23px]">{t(`${file.name} is deleted from this device. This can't be undone.`,
                    `${file.name} wird von diesem Gerät gelöscht. Das lässt sich nicht rückgängig machen.`)}</Text>
            </Sheet>
        )
        return (
            <>
                <Sheet title={file.name} open={open && !matchGroup} onOpenChange={onOpenChange} className="min-h-[78%]">
                    <View className="-mb-1 -ml-2 -mt-2 self-start">
                        <Pressable accessibilityRole="button" onPress={() => setFilePath(null)}
                            className="min-h-12 flex-row items-center gap-1.5 rounded-full px-2 active:bg-sm-surface-control">
                            <ArrowUp size={18} color={colors.smAccent} />
                            <Text className="text-[15px] font-semibold text-sm-accent">{t("Back to the folder", "Zurück zum Ordner")}</Text>
                        </Pressable>
                    </View>
                    <Facts items={[
                        { label: t("Anime", "Anime"), value: local?.mediaId ? animeName(local.mediaId) : "–" },
                        { label: t("Episode", "Folge"), value: local?.metadata?.episode ? String(local.metadata.episode) : "–" },
                        {
                            label: t("State", "Status"), value: !local ? t("Not scanned yet", "Noch nicht gescannt") : local.ignored ? t("Ignored", "Ignoriert")
                                : local.locked ? t("Locked", "Gesperrt") : t("Not locked", "Nicht gesperrt"),
                        },
                        ...(file.size ? [{ label: t("Size", "Größe"), value: formatSize(file.size) }] : []),
                        { label: t("Folder", "Ordner"), value: <Text className="w-full text-sm font-medium">{upath.dirname(file.path)}</Text> },
                    ]} />
                    {!!local && (
                        <RowGroup>
                            {!local.mediaId && !local.ignored && <ActionRow icon={FileQuestion} tone="attention" label={t("Match to an anime", "Einem Anime zuordnen")} chevron
                                onPress={() => setMatchGroup({ dir: upath.dirname(file.path), localFiles: [local] })} />}
                            {!!local.mediaId && <ActionRow icon={Unlink} label={t("Unmatch", "Zuordnung lösen")} disabled={busy}
                                note={t("It goes back to the unmatched files", "Sie kommt zurück zu den Dateien ohne Anime")} onPress={() => act("unmatch")} />}
                            {!local.ignored && (local.locked
                                ? <ActionRow icon={LockOpen} label={t("Unlock", "Entsperren")} note={t("Scans may change its anime again", "Scans dürfen ihren Anime wieder ändern")}
                                    disabled={busy} onPress={() => act("unlock")} />
                                : <ActionRow icon={Lock} label={t("Lock", "Sperren")} note={t("Scans keep its anime", "Scans behalten ihren Anime")} disabled={busy}
                                    onPress={() => act("lock")} />)}
                            {local.ignored
                                ? <ActionRow icon={File} label={t("Stop ignoring", "Nicht mehr ignorieren")} disabled={busy} onPress={() => act("unignore")} />
                                : <ActionRow icon={FileX} label={t("Ignore", "Ignorieren")} note={t("Scans skip it", "Scans überspringen sie")} disabled={busy} onPress={() => act("ignore")} />}
                            <ActionRow icon={Trash2} tone="danger" label={t("Delete", "Löschen")} disabled={busy} onPress={() => setConfirmDelete(true)} />
                        </RowGroup>
                    )}
                </Sheet>
                {!!matchGroup && <UnmatchedPhoneSheet unmatchedGroups={[matchGroup]} open={open} onOpenChange={next => {
                    if (!next) setMatchGroup(null)
                }} />}
            </>
        )
    }

    const filesIn = (node?: ExplorerNode) => plural(t, node?.localFileCount ?? 0, ["file", "files"], ["Datei", "Dateien"])
    return (
        <Sheet title={t("Library files", "Bibliotheksdateien")} open={open} onOpenChange={onOpenChange} className="min-h-[78%]">
            <SearchField value={query} onChangeText={setQuery} placeholder={t("Search file names", "Dateinamen suchen")} />
            <ChipRow label={t("Show only", "Nur zeigen")} multiple selected={filter ? [filter] : []}
                onSelect={value => setFilter(current => current === value ? null : value as ExplorerFilter)}
                chips={[{ value: "unmatched", label: t("No anime", "Ohne Anime"), count: counts.unmatched }, { value: "ignored", label: t("Ignored", "Ignoriert"), count: counts.ignored },
                    { value: "unlocked", label: t("Not locked", "Nicht gesperrt"), count: counts.unlocked }]} />
            {isLoading ? <LoadingRows label={t("Loading files", "Dateien werden geladen")} />
                : !root ? <PhoneEmpty title={t("No library folder", "Kein Bibliotheksordner")} text={t("Choose one in Settings, then scan it.", "Wähle einen in den Einstellungen und scanne ihn dann.")} />
                    : flat ? (
                        <SheetGroup title={filter ? t("Files", "Dateien") : t("Results", "Treffer")} intro={plural(t, flat.length, ["file", "files"], ["Datei", "Dateien"])}>
                            {flat.length ? <RowGroup>{flat.slice(0, 200).map(fileRow)}</RowGroup>
                                : <PhoneEmpty title={t("No file here", "Keine Datei")} text={q ? t("Try another part of the name.", "Versuch einen anderen Teil des Namens.") : undefined} />}
                        </SheetGroup>
                    ) : <>
                        <View className="min-h-14 flex-row items-center gap-1 rounded-surface bg-sm-surface-raised py-1 pr-1"
                            style={{ paddingLeft: trail.length > 1 ? 4 : 16 }}>
                            {trail.length > 1 && <Button intent="icon" accessibilityLabel={t("Up one folder", "Einen Ordner hoch")} onPress={() => setTrailPaths(paths => paths.slice(0, -1))}>
                                <ArrowUp size={20} color={colors.smTextMuted} />
                            </Button>}
                            <View className="min-w-0 flex-1 gap-0.5 py-2">
                                <Text className="text-[15px] font-semibold">{folder?.name || t("Library", "Bibliothek")}</Text>
                                <Muted style={{ fontVariant: ["tabular-nums"] }}>{[filesIn(folder),
                                    t(`${folder?.matchedLocalFileCount ?? 0} with an anime`, `${folder?.matchedLocalFileCount ?? 0} mit Anime`)].join(" · ")}</Muted>
                            </View>
                            <Button intent="icon" accessibilityLabel={t("Read the folders again", "Ordner neu einlesen")} disabled={refreshing} onPress={() => refresh()}>
                                {refreshing ? <ActivityIndicator size="small" color={colors.smTextMuted} /> : <RefreshCw size={20} color={colors.smTextMuted} />}
                            </Button>
                        </View>
                        {!children.length ? <PhoneEmpty title={t("This folder is empty", "Dieser Ordner ist leer")} />
                            : <RowGroup>
                                {children.map(node => {
                                    if (node.kind !== "directory") return fileRow(node)
                                    const missing = (node.localFileCount ?? 0) - (node.matchedLocalFileCount ?? 0)
                                    return <ActionRow key={node.path} icon={Folder} label={node.name} chevron tone={missing > 0 ? "attention" : undefined}
                                        note={[filesIn(node), missing > 0 ? t(`${missing} without an anime`, `${missing} ohne Anime`) : ""].filter(Boolean).join(" · ")}
                                        onPress={() => setTrailPaths(paths => [...paths, node.path])} />
                                })}
                            </RowGroup>}
                    </>}
        </Sheet>
    )
}
