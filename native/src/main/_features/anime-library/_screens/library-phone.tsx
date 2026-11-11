import type { AL_BaseAnime, Anime_LocalFile, Anime_UnknownGroup, Anime_UnmatchedGroup } from "@/api/generated/types"
import { useAnilistListAnime } from "@/api/hooks/anilist.hooks"
import { useAddUnknownMedia, useGetLibraryCollection } from "@/api/hooks/anime_collection.hooks"
import { useAnimeEntryBulkAction, useAnimeEntryManualMatch, useFetchAnimeEntrySuggestions, useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { useLocalFileBulkAction, useRemoveEmptyDirectories, useUpdateLocalFiles } from "@/api/hooks/localfiles.hooks"
import { useScanLocalFiles } from "@/api/hooks/scan.hooks"
import { ActionRow, Facts, FloatStatus, FORMAT_LABELS, PickRow, RowGroup, SearchField } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { EmptyState } from "@/components/ui/card/card"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { toast } from "@/components/ui/toast/toast-store"
import { Muted, Text } from "@/components/ui/text/text"
import { useDebounce } from "@/hooks/use-debounce"
import { type Translate, useTr } from "@/lib/app-language"
import { upath } from "@/lib/helpers/upath"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { __anilist_userAnimeMediaAtom } from "@/main/_atoms/anilist.atoms"
import {
    __ignoredFileManagerIsOpen,
    __scanner_isScanningAtom,
    __scanner_modalIsOpen,
    __unknownMedia_drawerIsOpen,
    __unmatchedFileManagerIsOpen,
} from "@/main/_features/anime-library/library-phone.atoms"
import { HomeHeaderAction } from "@/main/_features/home/home-mobile-header"
import { libraryExplorer_drawerOpenAtom } from "@/main/_features/library-explorer/library-explorer.atoms"
import { usePluginActions, useRunPluginAction } from "@/main/_features/plugin/plugin-actions"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { Image } from "expo-image"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import ChevronLeft from "lucide-react-native/icons/chevron-left"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import EyeOff from "lucide-react-native/icons/eye-off"
import FileQuestion from "lucide-react-native/icons/file-question-mark"
import FileSearch from "lucide-react-native/icons/file-search"
import FileX from "lucide-react-native/icons/file-x"
import FolderOpen from "lucide-react-native/icons/folder-open"
import FolderSync from "lucide-react-native/icons/folder-sync"
import FolderTree from "lucide-react-native/icons/folder-tree"
import FolderX from "lucide-react-native/icons/folder-x"
import Lock from "lucide-react-native/icons/lock"
import LockOpen from "lucide-react-native/icons/lock-open"
import Puzzle from "lucide-react-native/icons/puzzle"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * The local library on Android phones (library-phone.tsx + library-phone.css): one "Local library" sheet for scanning, the
 * jobs on all files and the ways into the queues (unmatched files, hidden anime, ignored files), each queue a sheet of its
 * own, and the scan's status above the bottom bar.
 *
 * "Folders and files" opens the library explorer (2.10), "Open settings" the settings on Local library (2.12),
 * "Scan summaries" (2.14) closes the sheet and opens /scan-summaries.
 */

const plural = (t: Translate, n: number, en: [string, string], de: [string, string]) => `${n} ${n === 1 ? t(en[0], de[0]) : t(en[1], de[1])}`
const fileName = (lf: Anime_LocalFile) => lf.parsedInfo?.original || upath.basename(lf.path)
const byEpisode = (a: Anime_LocalFile, b: Anime_LocalFile) => Number(a.parsedInfo?.episode ?? 0) - Number(b.parsedInfo?.episode ?? 0)
const animeTitle = (media?: AL_BaseAnime) => media?.title?.userPreferred || media?.title?.english || media?.title?.romaji || ""

function animeNote(t: Translate, media: AL_BaseAnime) {
    const format = media.format ? t(...(FORMAT_LABELS[media.format] ?? [media.format, media.format])) : ""
    return [format, media.startDate?.year, media.episodes ? plural(t, media.episodes, ["episode", "episodes"], ["Folge", "Folgen"]) : ""].filter(Boolean).join(" · ")
}

/** Where a folder sits: its parent below the library folder ("Anime / Season 2"), or the whole path outside of it. */
function parentInLibrary(dir: string, folders: string[]) {
    const root = folders.map(folder => folder.replace(/\/+$/, "")).find(folder => dir.startsWith(folder + "/"))
    const parent = upath.dirname(dir)
    if (!root) return parent
    const inside = parent.slice(root.length).replace(/^\/+/, "")
    return [upath.basename(root), ...inside.split("/").filter(Boolean)].join(" / ")
}

function Cover({ src }: { src?: string }) {
    return (
        <View className="aspect-[2/3] w-11 overflow-hidden rounded-[8px] bg-sm-surface-control">
            {!!src && <Image source={src} contentFit="cover" style={{ width: "100%", height: "100%" }} accessibilityIgnoresInvertColors />}
        </View>
    )
}

function useLibraryFolders() {
    const library = useServerStatus()?.settings?.library
    return [library?.libraryPath, ...(library?.libraryPaths ?? [])].filter((path): path is string => !!path)
}

/** Counts the Home action and the sheet show: files without an anime, anime missing from AniList, ignored files. */
function useLibraryQueues() {
    const { data } = useGetLibraryCollection()
    return {
        unmatchedFiles: data?.unmatchedLocalFiles?.length ?? 0,
        unmatchedGroups: data?.unmatchedGroups ?? [],
        unknownGroups: data?.unknownGroups ?? [],
        ignoredFiles: data?.ignoredLocalFiles ?? [],
        stats: data?.stats,
        hasEntries: !!data?.lists?.some(list => !!list.entries?.length),
    }
}

/** Home: the library as one header action, marked while a queue waits. */
export function LibraryPhoneAction() {
    const t = useTr()
    const setOpen = useSetAtom(__scanner_modalIsOpen)
    const { unmatchedFiles, unknownGroups } = useLibraryQueues()
    const waiting = unmatchedFiles + unknownGroups.length
    return (
        <HomeHeaderAction
            icon={FolderOpen}
            label={t("Library", "Bibliothek")}
            accessibilityLabel={waiting ? t(`Local library, ${waiting} need attention`, `Lokale Bibliothek, ${waiting} brauchen dich`) : t("Local library", "Lokale Bibliothek")}
            dot={waiting > 0}
            onPress={() => setOpen(true)}
        />
    )
}

/** Home: what waits in the library, one row per queue, right under the header. */
export function LibraryPhoneAttention() {
    const t = useTr()
    const setUnmatched = useSetAtom(__unmatchedFileManagerIsOpen)
    const setUnknown = useSetAtom(__unknownMedia_drawerIsOpen)
    const { unmatchedFiles, unknownGroups } = useLibraryQueues()
    if (!unmatchedFiles && !unknownGroups.length) return null
    return (
        <RowGroup className="mb-3">
            {unmatchedFiles > 0 && <ActionRow tone="attention" icon={FileQuestion} chevron onPress={() => setUnmatched(true)}
                label={t(`${plural(t, unmatchedFiles, ["file has", "files have"], ["Datei hat", "Dateien haben"])} no anime yet`,
                    `${plural(t, unmatchedFiles, ["file has", "files have"], ["Datei hat", "Dateien haben"])} noch keinen Anime`)}
                note={t("Pick the anime they belong to", "Wähle den passenden Anime")} />}
            {unknownGroups.length > 0 && <ActionRow tone="attention" icon={EyeOff} chevron onPress={() => setUnknown(true)}
                label={t(`${plural(t, unknownGroups.length, ["anime is", "anime are"], ["Anime ist", "Anime sind"])} hidden`,
                    `${plural(t, unknownGroups.length, ["anime is", "anime are"], ["Anime ist", "Anime sind"])} versteckt`)}
                note={t("Matched, but not on your AniList yet", "Zugeordnet, aber noch nicht auf deiner AniList")} />}
        </RowGroup>
    )
}

/**
 * The "Local library" sheet (the scanner on phones): what is in the library, the queues, the scan options with Refresh as
 * the one primary action, and the jobs on all files. Removing empty folders asks first, in the same sheet.
 */
export function LibraryPhoneSheet() {
    const t = useTr()
    const router = useRouter()
    const serverStatus = useServerStatus()
    const [open, setOpen] = useAtom(__scanner_modalIsOpen)
    const pluginItems = usePluginActions("animeLibraryItems")
    const runPlugin = useRunPluginAction()
    const setScanning = useSetAtom(__scanner_isScanningAtom)
    const setUnmatched = useSetAtom(__unmatchedFileManagerIsOpen)
    const setUnknown = useSetAtom(__unknownMedia_drawerIsOpen)
    const setIgnored = useSetAtom(__ignoredFileManagerIsOpen)
    const setExplorer = useSetAtom(libraryExplorer_drawerOpenAtom)
    const userMedia = useAtomValue(__anilist_userAnimeMediaAtom)
    const { unmatchedFiles, unknownGroups, ignoredFiles, stats, hasEntries } = useLibraryQueues()
    const folders = useLibraryFolders()

    const [listOnly, setListOnly] = React.useState(true)
    const [skipLocked, setSkipLocked] = React.useState(true)
    const [skipIgnored, setSkipIgnored] = React.useState(true)
    const [offlineDatabase, setOfflineDatabase] = React.useState(true)
    const [confirmRemove, setConfirmRemove] = React.useState(false)
    // "Only anime on my AniList" follows whether the list has anime; a closed sheet forgets the remove question
    const [seenMedia, setSeenMedia] = React.useState(userMedia)
    if (seenMedia !== userMedia) {
        setSeenMedia(userMedia)
        setListOnly(!!userMedia?.length)
    }
    const [wasOpen, setWasOpen] = React.useState(open)
    if (wasOpen !== open) {
        setWasOpen(open)
        if (!open) setConfirmRemove(false)
    }

    const { mutate: scan, isPending: scanning } = useScanLocalFiles()
    React.useEffect(() => setScanning(scanning), [scanning, setScanning])
    const { mutate: bulk, isPending: bulkPending } = useLocalFileBulkAction()
    const { mutate: removeEmpty, isPending: removing } = useRemoveEmptyDirectories()
    const busy = scanning || bulkPending || removing

    // A queue opens in its own sheet; this one closes first, so Back leads to Home and never stacks two sheets. The web
    // app waited 150 ms between the two; the native sheets hand over directly.
    const openQueue = (set: (open: boolean) => void) => {
        setOpen(false)
        set(true)
    }
    const lockAll = (action: "lock" | "unlock") => bulk({ action }, {
        onSuccess: () => toast.success(action === "lock" ? t("All files locked", "Alle Dateien gesperrt") : t("All files unlocked", "Alle Dateien entsperrt")),
    })

    if (confirmRemove) return (
        <Sheet title={t("Remove empty folders?", "Leere Ordner entfernen?")} open={open} onOpenChange={setOpen}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setConfirmRemove(false)}>{t("Cancel", "Abbrechen")}</Button>
                <Button intent="danger" wrapperClassName="flex-1" disabled={removing}
                    onPress={() => removeEmpty(undefined, { onSuccess: () => setConfirmRemove(false) })}>{t("Remove", "Entfernen")}</Button>
            </>}>
            <Text className="leading-[23px]">{t("Every folder in your library folders that holds no files is deleted from this device.",
                "Jeder Ordner in deinen Bibliotheksordnern, der keine Dateien enthält, wird von diesem Gerät gelöscht.")}</Text>
        </Sheet>
    )

    return (
        <Sheet title={t("Local library", "Lokale Bibliothek")} open={open} onOpenChange={setOpen}
            footer={<Button wrapperClassName="flex-1" disabled={busy || !folders.length} leftIcon={<FolderSync size={18} color="#ffffff" />}
                onPress={() => {
                    scan({ enhanced: !listOnly, skipLockedFiles: skipLocked, skipIgnoredFiles: skipIgnored, enhanceWithOfflineDatabase: offlineDatabase })
                    setOpen(false)
                }}>
                {hasEntries ? t("Refresh library", "Bibliothek aktualisieren") : t("Scan library", "Bibliothek scannen")}
            </Button>}>
            {!folders.length
                ? <EmptyState title={t("No library folder", "Kein Bibliotheksordner")}
                    description={t("Choose the folder with your anime in Settings, then scan it here.", "Wähle in den Einstellungen den Ordner mit deinen Anime und scanne ihn dann hier.")}>
                    <TextAction label={t("Open settings", "Einstellungen öffnen")} onPress={() => {
                        setOpen(false)
                        router.push("/settings?tab=library")
                    }} />
                </EmptyState>
                : <Facts items={[
                    {
                        label: folders.length === 1 ? t("Folder", "Ordner") : t("Folders", "Ordner"),
                        value: <View className="w-full gap-0.5">{folders.map(path => <Text key={path} className="text-sm font-medium">{path}</Text>)}</View>,
                    },
                    ...(stats ? [{
                        label: t("Anime", "Anime"),
                        value: String(stats.totalEntries),
                        note: `${plural(t, stats.totalFiles, ["file", "files"], ["Datei", "Dateien"])} · ${stats.totalSize}`,
                    }] : []),
                ]} />}

            {(unmatchedFiles > 0 || unknownGroups.length > 0) && (
                <SheetGroup title={t("Needs you", "Braucht dich")}>
                    <RowGroup>
                        {unmatchedFiles > 0 && <ActionRow tone="attention" icon={FileQuestion} label={t("Unmatched files", "Dateien ohne Anime")} value={unmatchedFiles} chevron
                            note={t("Pick the anime they belong to", "Wähle den passenden Anime")} onPress={() => openQueue(setUnmatched)} />}
                        {unknownGroups.length > 0 && <ActionRow tone="attention" icon={EyeOff} label={t("Hidden anime", "Versteckte Anime")} value={unknownGroups.length} chevron
                            note={t("Matched, but not on your AniList yet", "Zugeordnet, aber noch nicht auf deiner AniList")} onPress={() => openQueue(setUnknown)} />}
                    </RowGroup>
                </SheetGroup>
            )}

            {!!folders.length && (
                <SheetGroup title={t("Scan", "Scan")}
                    note={serverStatus?.user?.isSimulated ? t("Without an AniList account a large library scans slowly and can hit AniList's rate limit.",
                        "Ohne AniList-Konto scannt eine große Bibliothek langsam und kann an AniLists Anfragelimit stoßen.") : undefined}>
                    <RowGroup>
                        <SwitchRow label={t("Skip locked files", "Gesperrte Dateien überspringen")} description={t("Their anime stays as it is", "Ihr Anime bleibt, wie er ist")}
                            checked={skipLocked} onCheckedChange={setSkipLocked} />
                        <SwitchRow label={t("Skip ignored files", "Ignorierte Dateien überspringen")} checked={skipIgnored} onCheckedChange={setSkipIgnored} />
                        <SwitchRow label={t("Only anime on my AniList", "Nur Anime auf meiner AniList")} disabled={!userMedia?.length}
                            description={listOnly ? t("Faster; files of other anime stay unmatched", "Schneller; Dateien anderer Anime bleiben ohne Zuordnung")
                                : t("Matches against every anime on AniList; slower", "Vergleicht mit allen Anime auf AniList; langsamer")}
                            checked={listOnly} onCheckedChange={setListOnly} />
                    </RowGroup>
                    {!listOnly && (
                        <RowGroup>
                            <PickRow radio checked={offlineDatabase} onPress={() => setOfflineDatabase(true)}
                                label={t("Anime Offline Database", "Anime Offline Database")} note={t("One download, no requests per title", "Ein Download, keine Anfrage pro Titel")} />
                            <PickRow radio checked={!offlineDatabase} onPress={() => setOfflineDatabase(false)}
                                label={t("AniList", "AniList")} note={t("One request per title; slow for large libraries", "Eine Anfrage pro Titel; langsam bei großen Bibliotheken")} />
                        </RowGroup>
                    )}
                </SheetGroup>
            )}

            {!!folders.length && (
                <SheetGroup title={t("All files", "Alle Dateien")}>
                    <RowGroup>
                        <ActionRow icon={FolderTree} label={t("Folders and files", "Ordner und Dateien")} note={t("Each file with its anime and state", "Jede Datei mit Anime und Status")}
                            chevron onPress={() => openQueue(setExplorer)} />
                        <ActionRow icon={FileX} label={t("Ignored files", "Ignorierte Dateien")} value={ignoredFiles.length} chevron onPress={() => openQueue(setIgnored)} />
                        <ActionRow icon={Lock} label={t("Lock all files", "Alle Dateien sperren")} note={t("Scans keep their anime", "Scans behalten ihren Anime")}
                            disabled={busy || !hasEntries} onPress={() => lockAll("lock")} />
                        <ActionRow icon={LockOpen} label={t("Unlock all files", "Alle Dateien entsperren")} disabled={busy || !hasEntries} onPress={() => lockAll("unlock")} />
                        <ActionRow icon={FolderX} tone="danger" label={t("Remove empty folders", "Leere Ordner entfernen")} disabled={busy} onPress={() => setConfirmRemove(true)} />
                        <ActionRow icon={FileSearch} label={t("Scan summaries", "Scan-Berichte")} note={t("What the last scans found", "Was die letzten Scans gefunden haben")}
                            chevron onPress={() => {
                                setOpen(false)
                                router.push("/scan-summaries")
                            }} />
                    </RowGroup>
                </SheetGroup>
            )}

            {/* The plugins' items (web home-toolbar PluginAnimeLibraryDropdownItems) */}
            {pluginItems.length > 0 && (
                <SheetGroup title={t("Plugins", "Plugins")}>
                    <RowGroup>
                        {pluginItems.map(item => <ActionRow key={`${item.extensionId}:${item.id}`} icon={Puzzle} label={item.label || "???"}
                            disabled={item.disabled} onPress={() => runPlugin(item, {})} />)}
                    </RowGroup>
                </SheetGroup>
            )}
        </Sheet>
    )
}

/**
 * Unmatched files: one folder at a time, its files to pick, the anime from suggestions or a search (an AniList ID works
 * too), then Match or Ignore for the picked files.
 */
export function UnmatchedPhoneSheet({ unmatchedGroups, open: openProp, onOpenChange }: {
    unmatchedGroups: Anime_UnmatchedGroup[]
    /** Controlled from outside (the library explorer's "Match to an anime"), so Home's queue sheet stays closed */
    open?: boolean
    onOpenChange?: (open: boolean) => void
}) {
    const t = useTr()
    const serverStatus = useServerStatus()
    const [queueOpen, setQueueOpen] = useAtom(__unmatchedFileManagerIsOpen)
    const open = openProp ?? queueOpen
    const setOpen = onOpenChange ?? setQueueOpen
    const folders = useLibraryFolders()
    const [page, setPage] = React.useState(0)
    const group = unmatchedGroups[Math.min(page, unmatchedGroups.length - 1)]
    const files = React.useMemo(() => [...(group?.localFiles ?? [])].sort(byEpisode), [group])
    const [picked, setPicked] = React.useState<string[]>([])
    const [anime, setAnime] = React.useState<AL_BaseAnime | null>(null)
    const [query, setQuery] = React.useState("")
    const search = useDebounce(query.trim(), 400)
    const asId = /^\d+$/.test(search) ? Number(search) : 0

    const { data: suggestions, mutate: fetchSuggestions, isPending: suggesting, reset: resetSuggestions } = useFetchAnimeEntrySuggestions()
    const { data: results, isFetching: searching } = useAnilistListAnime({
        search, page: 1, perPage: 8, isAdult: serverStatus?.settings?.anilist?.enableAdultContent ? undefined : false,
    }, open && search.length > 1 && !asId)
    const { data: byId, isFetching: loadingId } = useGetAnimeEntry(open && asId ? asId : null)
    const { mutate: match, isPending: matching } = useAnimeEntryManualMatch()
    const { mutate: updateFiles, isPending: ignoring } = useUpdateLocalFiles()

    // A new folder starts with all of its files picked and its suggestions asked for
    const folderKey = `${open}:${group?.dir}`
    const [seenFolder, setSeenFolder] = React.useState("")
    if (seenFolder !== folderKey) {
        setSeenFolder(folderKey)
        setPicked(files.map(lf => lf.path))
        setAnime(null)
        setQuery("")
    }
    const askSuggestions = React.useEffectEvent((dir?: string) => {
        resetSuggestions()
        if (dir) fetchSuggestions({ dir })
    })
    React.useEffect(() => askSuggestions(open ? group?.dir : undefined), [group?.dir, open])
    const [wasOpen, setWasOpen] = React.useState(open)
    if (wasOpen !== open) {
        setWasOpen(open)
        if (open) setPage(0)
    }
    React.useEffect(() => { if (open && !unmatchedGroups.length) setOpen(false) }, [open, unmatchedGroups.length, setOpen])

    if (!group) return null
    const done = (message: string) => {
        toast.success(message)
        if (unmatchedGroups.length <= 1) setOpen(false)
        else setPage(p => Math.min(p, unmatchedGroups.length - 2))
    }
    const choices: AL_BaseAnime[] = search
        ? (asId ? (byId?.media ? [byId.media] : []) : (results?.Page?.media?.filter(Boolean) ?? []))
        : (suggestions ?? [])
    const loading = search ? (asId ? loadingId : searching) : suggesting
    const allPicked = picked.length === files.length

    return (
        <Sheet title={t("Unmatched files", "Dateien ohne Anime")} open={open} onOpenChange={setOpen} className="min-h-[78%]"
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" disabled={!picked.length || matching || ignoring}
                    onPress={() => updateFiles({ paths: picked, action: "ignore" }, { onSuccess: () => done(t("Files ignored", "Dateien ignoriert")) })}>
                    {t("Ignore", "Ignorieren")}
                </Button>
                <Button wrapperClassName="flex-1" disabled={!anime || !picked.length || matching || ignoring}
                    onPress={() => anime && match({ paths: picked, mediaId: anime.id }, { onSuccess: () => done(t("Files matched", "Dateien zugeordnet")) })}>
                    {picked.length ? t(`Match ${plural(t, picked.length, ["file", "files"], ["Datei", "Dateien"])}`, `${plural(t, picked.length, ["Datei", "Dateien"], ["Datei", "Dateien"])} zuordnen`)
                        : t("Match", "Zuordnen")}
                </Button>
            </>}>
            <View className="flex-row items-center gap-1 rounded-surface bg-sm-surface-raised py-2 pl-4 pr-1">
                <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="text-[15px] font-semibold">{upath.basename(group.dir) || group.dir}</Text>
                    <Muted>{[unmatchedGroups.length > 1 ? t(`Folder ${page + 1} of ${unmatchedGroups.length}`, `Ordner ${page + 1} von ${unmatchedGroups.length}`) : "", parentInLibrary(group.dir, folders)]
                        .filter(Boolean).join(" · ")}</Muted>
                </View>
                {unmatchedGroups.length > 1 && <>
                    <Button intent="icon" accessibilityLabel={t("Previous folder", "Vorheriger Ordner")} disabled={page === 0} onPress={() => setPage(p => p - 1)}>
                        <ChevronLeft size={20} color={colors.smTextMuted} />
                    </Button>
                    <Button intent="icon" accessibilityLabel={t("Next folder", "Nächster Ordner")} disabled={page >= unmatchedGroups.length - 1} onPress={() => setPage(p => p + 1)}>
                        <ChevronRight size={20} color={colors.smTextMuted} />
                    </Button>
                </>}
            </View>

            <SheetGroup title={t("Which anime is it?", "Welcher Anime ist es?")}
                note={search ? undefined : t("Suggestions from the folder's name. Search by title or enter an AniList ID.", "Vorschläge aus dem Ordnernamen. Suche nach Titel oder gib eine AniList-ID ein.")}>
                <SearchField value={query} onChangeText={setQuery} placeholder={t("Title or AniList ID", "Titel oder AniList-ID")} />
                {loading && !choices.length
                    ? <Muted accessibilityRole="progressbar">{t("Looking…", "Suche…")}</Muted>
                    : !choices.length
                        ? <Muted>{search ? t("Nothing found. Try another title.", "Nichts gefunden. Versuch einen anderen Titel.")
                            : t("No suggestions for this folder. Search above.", "Keine Vorschläge für diesen Ordner. Such oben.")}</Muted>
                        : <RowGroup>
                            {choices.map(media => <PickRow key={media.id} radio checked={anime?.id === media.id} onPress={() => setAnime(media)}
                                media={<Cover src={media.coverImage?.medium || media.coverImage?.large} />} label={animeTitle(media)} note={animeNote(t, media)} />)}
                        </RowGroup>}
            </SheetGroup>

            <SheetGroup title={t("Files", "Dateien")} note={t(`${picked.length} of ${files.length} picked`, `${picked.length} von ${files.length} gewählt`)}>
                {files.length > 1 && <TextAction label={allPicked ? t("Pick none", "Keine wählen") : t("Pick all", "Alle wählen")}
                    onPress={() => setPicked(allPicked ? [] : files.map(lf => lf.path))} />}
                <RowGroup>
                    {files.map(lf => <PickRow key={lf.path} checked={picked.includes(lf.path)} label={fileName(lf)}
                        note={lf.parsedInfo?.episode ? t(`Episode ${lf.parsedInfo.episode}`, `Folge ${lf.parsedInfo.episode}`) : undefined}
                        onPress={() => setPicked(list => list.includes(lf.path) ? list.filter(path => path !== lf.path) : [...list, lf.path])} />)}
                </RowGroup>
            </SheetGroup>
        </Sheet>
    )
}

function TextAction({ label, onPress }: { label: string, onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" onPress={onPress} className="min-h-11 self-start justify-center rounded-full px-1 active:bg-sm-surface-control">
            <Text className="text-sm font-semibold text-sm-accent">{label}</Text>
        </Pressable>
    )
}

function HiddenAnime({ t, group, busy, onAdd, onUnmatch }: { t: Translate, group: Anime_UnknownGroup, busy: boolean, onAdd: () => void, onUnmatch: () => void }) {
    const { data: entry } = useGetAnimeEntry(group.mediaId)
    const [showFiles, setShowFiles] = React.useState(false)
    const files = [...(group.localFiles ?? [])].sort(byEpisode)
    const title = animeTitle(entry?.media) || t(`AniList ID ${group.mediaId}`, `AniList-ID ${group.mediaId}`)
    return (
        <View className="gap-0.5 overflow-hidden rounded-surface">
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showFiles }} onPress={() => setShowFiles(v => !v)}
                className="min-h-[76px] flex-row items-center gap-3.5 bg-sm-surface-raised py-2.5 pl-2.5 pr-4 active:bg-sm-surface-control">
                <Cover src={entry?.media?.coverImage?.medium || entry?.media?.coverImage?.large} />
                <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="text-[15px]">{title}</Text>
                    <Muted>{plural(t, files.length, ["file", "files"], ["Datei", "Dateien"])}{entry?.media ? ` · ${animeNote(t, entry.media)}` : ""}</Muted>
                </View>
                <View style={{ transform: [{ rotate: showFiles ? "90deg" : "0deg" }] }}><ChevronRight size={18} color={colors.smTextSubtle} /></View>
            </Pressable>
            {showFiles && (
                <View className="gap-1.5 bg-sm-surface-raised px-4 py-3">
                    {files.map(lf => <Muted key={lf.path}>{fileName(lf)}</Muted>)}
                </View>
            )}
            <View className="flex-row flex-wrap gap-2 bg-sm-surface-raised p-2">
                <Button intent="secondary" wrapperClassName="flex-1" disabled={busy} onPress={onUnmatch}>{t("Unmatch", "Zuordnung lösen")}</Button>
                <Button intent="secondary" wrapperClassName="flex-1" className="bg-sm-accent-soft" labelClassName="text-sm-accent" disabled={busy} onPress={onAdd}>
                    {t("Add to AniList", "Zu AniList hinzufügen")}
                </Button>
            </View>
        </View>
    )
}

/** Hidden anime: files matched to anime that are not on the user's AniList; add them (each or all) or unmatch the files. */
export function HiddenMediaPhoneSheet({ unknownGroups }: { unknownGroups: Anime_UnknownGroup[] }) {
    const t = useTr()
    const [open, setOpen] = useAtom(__unknownMedia_drawerIsOpen)
    const { mutate: add, isPending: adding } = useAddUnknownMedia()
    const { mutate: bulk, isPending: unmatching } = useAnimeEntryBulkAction()
    React.useEffect(() => { if (open && !unknownGroups.length) setOpen(false) }, [open, unknownGroups.length, setOpen])
    if (!unknownGroups.length) return null
    const busy = adding || unmatching
    return (
        <Sheet title={t("Hidden anime", "Versteckte Anime")} open={open} onOpenChange={o => !adding && setOpen(o)} className="min-h-[78%]"
            footer={unknownGroups.length > 1 ? <Button wrapperClassName="flex-1" disabled={busy} onPress={() => add({ mediaIds: unknownGroups.map(group => group.mediaId) })}>
                {t(`Add all ${unknownGroups.length} to AniList`, `Alle ${unknownGroups.length} zu AniList hinzufügen`)}
            </Button> : undefined}>
            <Text className="leading-[23px]">{t("These files belong to anime that aren't on your AniList, so your library doesn't show them. Add the anime, or unmatch the files if the match is wrong.",
                "Diese Dateien gehören zu Anime, die nicht auf deiner AniList stehen, darum zeigt deine Bibliothek sie nicht. Füge die Anime hinzu oder löse die Zuordnung, wenn sie falsch ist.")}</Text>
            {unknownGroups.map(group => <HiddenAnime key={group.mediaId} t={t} group={group} busy={busy}
                onAdd={() => add({ mediaIds: [group.mediaId] })}
                onUnmatch={() => bulk({ mediaId: group.mediaId, action: "unmatch" }, { onSuccess: () => toast.success(t("Files unmatched", "Zuordnung gelöst")) })} />)}
        </Sheet>
    )
}

/** Ignored files: pick the ones scans should look at again. */
export function IgnoredFilesPhoneSheet({ files }: { files: Anime_LocalFile[] }) {
    const t = useTr()
    const [open, setOpen] = useAtom(__ignoredFileManagerIsOpen)
    const [picked, setPicked] = React.useState<string[]>([])
    const { mutate: updateFiles, isPending } = useUpdateLocalFiles()
    const [seen, setSeen] = React.useState({ files, open })
    if (seen.files !== files || seen.open !== open) {
        setSeen({ files, open })
        setPicked([])
    }
    const allPicked = !!files.length && picked.length === files.length
    return (
        <Sheet title={t("Ignored files", "Ignorierte Dateien")} open={open} onOpenChange={setOpen} className="min-h-[78%]"
            footer={files.length ? <Button wrapperClassName="flex-1" disabled={!picked.length || isPending}
                onPress={() => updateFiles({ paths: picked, action: "unignore" }, { onSuccess: () => toast.success(t("Scans include these files again", "Scans beziehen diese Dateien wieder ein")) })}>
                {picked.length ? t(`Stop ignoring ${plural(t, picked.length, ["file", "files"], ["Datei", "Dateien"])}`, `${plural(t, picked.length, ["Datei", "Dateien"], ["Datei", "Dateien"])} nicht mehr ignorieren`)
                    : t("Stop ignoring", "Nicht mehr ignorieren")}
            </Button> : undefined}>
            {!files.length
                ? <EmptyState title={t("No ignored files", "Keine ignorierten Dateien")} description={t("Files you ignore are skipped by every scan.", "Dateien, die du ignorierst, überspringt jeder Scan.")} />
                : <SheetGroup title={t("Files", "Dateien")} note={t(`${picked.length} of ${files.length} picked`, `${picked.length} von ${files.length} gewählt`)}>
                    {files.length > 1 && <TextAction label={allPicked ? t("Pick none", "Keine wählen") : t("Pick all", "Alle wählen")}
                        onPress={() => setPicked(allPicked ? [] : files.map(lf => lf.path))} />}
                    <RowGroup>
                        {files.map(lf => <PickRow key={lf.path} checked={picked.includes(lf.path)} label={fileName(lf)} note={upath.dirname(lf.path)}
                            onPress={() => setPicked(list => list.includes(lf.path) ? list.filter(path => path !== lf.path) : [...list, lf.path])} />)}
                    </RowGroup>
                </SheetGroup>}
        </Sheet>
    )
}

/** A scan in progress, or a change the library watcher found, above the bottom bar. */
export function LibraryPhoneStatus({ progress, status, changed, autoScanning, onRefresh, onDismiss }: {
    progress?: number
    status?: string
    changed?: boolean
    autoScanning?: boolean
    onRefresh?: () => void
    onDismiss?: () => void
}) {
    const t = useTr()
    const sheetOpen = [
        useAtomValue(__scanner_modalIsOpen), useAtomValue(__unmatchedFileManagerIsOpen),
        useAtomValue(__unknownMedia_drawerIsOpen), useAtomValue(__ignoredFileManagerIsOpen),
    ].some(Boolean)
    // An open sheet covers the page; the status waits under it instead of lying on its actions.
    if (sheetOpen) return null
    if (progress != null) return <FloatStatus progress={progress}
        text={autoScanning ? t("Refreshing your library", "Bibliothek wird aktualisiert") : t("Scanning your library", "Bibliothek wird gescannt")}
        detail={`${Math.round(progress)} %${status ? ` · ${status}` : ""}`} />
    if (changed) return (
        <FloatStatus text={t("Your library folder changed", "Dein Bibliotheksordner hat sich geändert")} detail={t("Refresh to show the new files", "Aktualisiere, um die neuen Dateien zu sehen")}>
            <Button intent="text" onPress={onDismiss}>{t("Later", "Später")}</Button>
            <Button intent="text" onPress={onRefresh}>{t("Refresh", "Aktualisieren")}</Button>
        </FloatStatus>
    )
    return null
}
