import { AL_BaseAnime, Anime_LocalFile, Anime_UnknownGroup, Anime_UnmatchedGroup } from "@/api/generated/types"
import { useAnilistListAnime } from "@/api/hooks/anilist.hooks"
import { useAddUnknownMedia, useGetLibraryCollection } from "@/api/hooks/anime_collection.hooks"
import { useAnimeEntryBulkAction, useAnimeEntryManualMatch, useFetchAnimeEntrySuggestions, useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { useLocalFileBulkAction, useRemoveEmptyDirectories, useUpdateLocalFiles } from "@/api/hooks/localfiles.hooks"
import { useScanLocalFiles } from "@/api/hooks/scan.hooks"
import { __anilist_userAnimeMediaAtom } from "@/app/(main)/_atoms/anilist.atoms"
import { __ignoredFileManagerIsOpen } from "@/app/(main)/_features/anime-library/_containers/ignored-file-manager"
import { __scanner_isScanningAtom, __scanner_modalIsOpen } from "@/app/(main)/_features/anime-library/_containers/scanner-modal"
import { __unknownMedia_drawerIsOpen } from "@/app/(main)/_features/anime-library/_containers/unknown-media-manager"
import { __unmatchedFileManagerIsOpen } from "@/app/(main)/_features/anime-library/_containers/unmatched-file-manager"
import { libraryExplorer_drawerOpenAtom } from "@/app/(main)/_features/library-explorer/library-explorer.atoms"
import {
    FORMAT_LABELS,
    PhoneEmpty,
    PhoneFloat,
    PhoneIconButton,
    PhonePick,
    PhoneRow,
    PhoneSearchField,
    PhoneSheet,
    PhoneSheetGroup,
    PhoneSwitch,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { useDebounce } from "@/hooks/use-debounce"
import { Translate, useTr } from "@/lib/app-language"
import { TabletLabel } from "@/lib/tablet-ui"
import { upath } from "@/lib/helpers/upath"
import { useAtom, useAtomValue, useSetAtom } from "jotai/react"
import React from "react"
import { LuChevronLeft, LuChevronRight, LuEyeOff, LuFileQuestion, LuFileX, LuFolderOpen, LuFolderSync, LuFolderTree, LuFolderX, LuLock, LuLockOpen } from "react-icons/lu"
import { TbReportSearch } from "react-icons/tb"
import { toast } from "sonner"
import "./library-phone.css"

/**
 * The local library on Android phones, in the phone kit: one "Local library" sheet for scanning, the jobs on all files and
 * the ways into the queues (unmatched files, hidden anime, ignored files), each queue a sheet of its own, and the scan's
 * status above the bottom bar. The desktop containers keep their atoms and render these on phones.
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
    return <span className="ps-pick-cover">{!!src && <SeaImage src={src} alt="" fill sizes="3rem" className="object-cover" />}</span>
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
    return <button type="button" className="home-header-action" data-library-phone-action
        aria-label={waiting ? t(`Local library, ${waiting} need attention`, `Lokale Bibliothek, ${waiting} brauchen dich`) : t("Local library", "Lokale Bibliothek")}
        onClick={() => setOpen(true)}>
        <LuFolderOpen aria-hidden />
        <TabletLabel>{t("Library", "Bibliothek")}</TabletLabel>
        {waiting > 0 && <span className="plib-dot" aria-hidden />}
    </button>
}

/** Home: what waits in the library, one row per queue, right under the header. */
export function LibraryPhoneAttention() {
    const t = useTr()
    const setUnmatched = useSetAtom(__unmatchedFileManagerIsOpen)
    const setUnknown = useSetAtom(__unknownMedia_drawerIsOpen)
    const { unmatchedFiles, unknownGroups } = useLibraryQueues()
    if (!unmatchedFiles && !unknownGroups.length) return null
    return <div className="ps-rows plib-attention" data-library-phone-attention>
        {unmatchedFiles > 0 && <PhoneRow tone="attention" icon={<LuFileQuestion />} chevron data-library-open="unmatched" onClick={() => setUnmatched(true)}
            label={t(`${plural(t, unmatchedFiles, ["file has", "files have"], ["Datei hat", "Dateien haben"])} no anime yet`,
                `${plural(t, unmatchedFiles, ["file has", "files have"], ["Datei hat", "Dateien haben"])} noch keinen Anime`)}
            note={t("Pick the anime they belong to", "Wähle den passenden Anime")} />}
        {unknownGroups.length > 0 && <PhoneRow tone="attention" icon={<LuEyeOff />} chevron data-library-open="hidden" onClick={() => setUnknown(true)}
            label={t(`${plural(t, unknownGroups.length, ["anime is", "anime are"], ["Anime ist", "Anime sind"])} hidden`,
                `${plural(t, unknownGroups.length, ["anime is", "anime are"], ["Anime ist", "Anime sind"])} versteckt`)}
            note={t("Matched, but not on your AniList yet", "Zugeordnet, aber noch nicht auf deiner AniList")} />}
    </div>
}

/**
 * The "Local library" sheet (the scanner on phones): what is in the library, the queues, the scan options with Refresh as
 * the one primary action, and the jobs on all files. Removing empty folders asks first, in the same sheet.
 */
export function LibraryPhoneSheet() {
    const t = useTr()
    const serverStatus = useServerStatus()
    const [open, setOpen] = useAtom(__scanner_modalIsOpen)
    const setScanning = useSetAtom(__scanner_isScanningAtom)
    const setUnmatched = useSetAtom(__unmatchedFileManagerIsOpen)
    const setUnknown = useSetAtom(__unknownMedia_drawerIsOpen)
    const setIgnored = useSetAtom(__ignoredFileManagerIsOpen)
    const setExplorer = useSetAtom(libraryExplorer_drawerOpenAtom)
    const userMedia = useAtomValue(__anilist_userAnimeMediaAtom)
    const { unmatchedFiles, unknownGroups, ignoredFiles, stats, hasEntries } = useLibraryQueues()

    const [listOnly, setListOnly] = React.useState(true)
    const [skipLocked, setSkipLocked] = React.useState(true)
    const [skipIgnored, setSkipIgnored] = React.useState(true)
    const [offlineDatabase, setOfflineDatabase] = React.useState(true)
    const [confirmRemove, setConfirmRemove] = React.useState(false)
    React.useEffect(() => setListOnly(!!userMedia?.length), [userMedia])
    React.useEffect(() => { if (!open) setConfirmRemove(false) }, [open])

    const { mutate: scan, isPending: scanning } = useScanLocalFiles()
    React.useEffect(() => setScanning(scanning), [scanning])
    const { mutate: bulk, isPending: bulkPending } = useLocalFileBulkAction()
    const { mutate: removeEmpty, isPending: removing } = useRemoveEmptyDirectories()

    const library = serverStatus?.settings?.library
    const folders = [library?.libraryPath, ...(library?.libraryPaths ?? [])].filter((path): path is string => !!path)
    const busy = scanning || bulkPending || removing

    // A queue opens in its own sheet; this one closes first, so Back leads to Home and never stacks two sheets.
    const openQueue = (set: (open: boolean) => void) => {
        setOpen(false)
        setTimeout(() => set(true), 150)
    }
    const lockAll = (action: "lock" | "unlock") => bulk({ action }, {
        onSuccess: () => toast.success(action === "lock" ? t("All files locked", "Alle Dateien gesperrt") : t("All files unlocked", "Alle Dateien entsperrt")),
    })

    if (confirmRemove) return <PhoneSheet title={t("Remove empty folders?", "Leere Ordner entfernen?")} open={open} onOpenChange={setOpen} data-library-phone-confirm
        footer={<>
            <button type="button" className="ps-secondary" onClick={() => setConfirmRemove(false)}>{t("Cancel", "Abbrechen")}</button>
            <button type="button" className="ps-primary" data-tone="danger" data-library-confirm-remove disabled={removing}
                onClick={() => removeEmpty(undefined, { onSuccess: () => setConfirmRemove(false) })}>{t("Remove", "Entfernen")}</button>
        </>}>
        <p className="ps-sheet-text">{t("Every folder in your library folders that holds no files is deleted from this device.",
            "Jeder Ordner in deinen Bibliotheksordnern, der keine Dateien enthält, wird von diesem Gerät gelöscht.")}</p>
    </PhoneSheet>

    return <PhoneSheet title={t("Local library", "Lokale Bibliothek")} open={open} onOpenChange={setOpen} data-library-phone-sheet
        footer={<button type="button" className="ps-primary" data-library-scan disabled={busy || !folders.length}
            onClick={() => {
                scan({ enhanced: !listOnly, skipLockedFiles: skipLocked, skipIgnoredFiles: skipIgnored, enhanceWithOfflineDatabase: offlineDatabase })
                setOpen(false)
            }}>
            <LuFolderSync aria-hidden />{hasEntries ? t("Refresh library", "Bibliothek aktualisieren") : t("Scan library", "Bibliothek scannen")}
        </button>}>
        {!folders.length
            ? <PhoneEmpty title={t("No library folder", "Kein Bibliotheksordner")}
                text={t("Choose the folder with your anime in Settings, then scan it here.", "Wähle in den Einstellungen den Ordner mit deinen Anime und scanne ihn dann hier.")}>
                <SeaLink href="/settings?tab=library" className="ps-text-action" onClick={() => setOpen(false)}>{t("Open settings", "Einstellungen öffnen")}</SeaLink>
            </PhoneEmpty>
            : <dl className="ps-facts" data-library-facts>
                <div><dt>{folders.length === 1 ? t("Folder", "Ordner") : t("Folders", "Ordner")}</dt><dd className="plib-path">{folders.map(path => <span key={path}>{path}</span>)}</dd></div>
                {!!stats && <div><dt>{t("Anime", "Anime")}</dt><dd>{stats.totalEntries}<small>{plural(t, stats.totalFiles, ["file", "files"], ["Datei", "Dateien"])} · {stats.totalSize}</small></dd></div>}
            </dl>}

        {(unmatchedFiles > 0 || unknownGroups.length > 0) && <PhoneSheetGroup title={t("Needs you", "Braucht dich")} data-library-group="queues">
            <div className="ps-rows">
                {unmatchedFiles > 0 && <PhoneRow tone="attention" icon={<LuFileQuestion />} label={t("Unmatched files", "Dateien ohne Anime")} value={unmatchedFiles} chevron
                    note={t("Pick the anime they belong to", "Wähle den passenden Anime")} data-library-open="unmatched" onClick={() => openQueue(setUnmatched)} />}
                {unknownGroups.length > 0 && <PhoneRow tone="attention" icon={<LuEyeOff />} label={t("Hidden anime", "Versteckte Anime")} value={unknownGroups.length} chevron
                    note={t("Matched, but not on your AniList yet", "Zugeordnet, aber noch nicht auf deiner AniList")} data-library-open="hidden" onClick={() => openQueue(setUnknown)} />}
            </div>
        </PhoneSheetGroup>}

        {!!folders.length && <PhoneSheetGroup title={t("Scan", "Scan")} data-library-group="scan"
            note={serverStatus?.user?.isSimulated ? t("Without an AniList account a large library scans slowly and can hit AniList's rate limit.",
                "Ohne AniList-Konto scannt eine große Bibliothek langsam und kann an AniLists Anfragelimit stoßen.") : undefined}>
            <div className="ps-rows">
                <PhoneSwitch label={t("Skip locked files", "Gesperrte Dateien überspringen")} note={t("Their anime stays as it is", "Ihr Anime bleibt, wie er ist")}
                    checked={skipLocked} onChange={setSkipLocked} data-library-option="skip-locked" />
                <PhoneSwitch label={t("Skip ignored files", "Ignorierte Dateien überspringen")} checked={skipIgnored} onChange={setSkipIgnored} data-library-option="skip-ignored" />
                <PhoneSwitch label={t("Only anime on my AniList", "Nur Anime auf meiner AniList")} disabled={!userMedia?.length}
                    note={listOnly ? t("Faster; files of other anime stay unmatched", "Schneller; Dateien anderer Anime bleiben ohne Zuordnung")
                        : t("Matches against every anime on AniList; slower", "Vergleicht mit allen Anime auf AniList; langsamer")}
                    checked={listOnly} onChange={setListOnly} data-library-option="list-only" />
            </div>
            {!listOnly && <div className="ps-rows" role="radiogroup" aria-label={t("Where titles come from", "Woher die Titel kommen")} data-library-option="source">
                <PhonePick role="radio" checked={offlineDatabase} onChange={() => setOfflineDatabase(true)} data-library-source="database"
                    label={t("Anime Offline Database", "Anime Offline Database")} note={t("One download, no requests per title", "Ein Download, keine Anfrage pro Titel")} />
                <PhonePick role="radio" checked={!offlineDatabase} onChange={() => setOfflineDatabase(false)} data-library-source="anilist"
                    label={t("AniList", "AniList")} note={t("One request per title; slow for large libraries", "Eine Anfrage pro Titel; langsam bei großen Bibliotheken")} />
            </div>}
        </PhoneSheetGroup>}

        {!!folders.length && <PhoneSheetGroup title={t("All files", "Alle Dateien")} data-library-group="files">
            <div className="ps-rows">
                <PhoneRow icon={<LuFolderTree />} label={t("Folders and files", "Ordner und Dateien")} note={t("Each file with its anime and state", "Jede Datei mit Anime und Status")}
                    chevron data-library-open="explorer" onClick={() => openQueue(setExplorer)} />
                <PhoneRow icon={<LuFileX />} label={t("Ignored files", "Ignorierte Dateien")} value={ignoredFiles.length} chevron data-library-open="ignored"
                    onClick={() => openQueue(setIgnored)} />
                <PhoneRow icon={<LuLock />} label={t("Lock all files", "Alle Dateien sperren")} note={t("Scans keep their anime", "Scans behalten ihren Anime")}
                    disabled={busy || !hasEntries} data-library-bulk="lock" onClick={() => lockAll("lock")} />
                <PhoneRow icon={<LuLockOpen />} label={t("Unlock all files", "Alle Dateien entsperren")} disabled={busy || !hasEntries} data-library-bulk="unlock"
                    onClick={() => lockAll("unlock")} />
                <PhoneRow icon={<LuFolderX />} tone="danger" label={t("Remove empty folders", "Leere Ordner entfernen")} disabled={busy} data-library-bulk="remove-empty"
                    onClick={() => setConfirmRemove(true)} />
                <PhoneRow icon={<TbReportSearch />} label={t("Scan summaries", "Scan-Berichte")} note={t("What the last scans found", "Was die letzten Scans gefunden haben")}
                    chevron href="/scan-summaries" data-library-open="summaries" />
            </div>
        </PhoneSheetGroup>}
    </PhoneSheet>
}

/**
 * Unmatched files: one folder at a time, its files to pick, the anime from suggestions or a search (an AniList ID works
 * too), then Match or Ignore for the picked files.
 */
export function UnmatchedPhoneSheet({ unmatchedGroups, onDone }: { unmatchedGroups: Anime_UnmatchedGroup[], /** Called when the sheet closes */ onDone?: () => void }) {
    const t = useTr()
    const serverStatus = useServerStatus()
    const [open, setOpenAtom] = useAtom(__unmatchedFileManagerIsOpen)
    const setOpen = (value: boolean) => {
        setOpenAtom(value)
        if (!value) onDone?.()
    }
    const library = serverStatus?.settings?.library
    const folders = [library?.libraryPath, ...(library?.libraryPaths ?? [])].filter((path): path is string => !!path)
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
    React.useEffect(() => {
        setPicked(files.map(lf => lf.path))
        setAnime(null)
        setQuery("")
        resetSuggestions()
        if (open && group?.dir) fetchSuggestions({ dir: group.dir })
    }, [group?.dir, open])
    React.useEffect(() => { if (open) setPage(0) }, [open])
    React.useEffect(() => { if (open && !unmatchedGroups.length) setOpen(false) }, [open, unmatchedGroups.length])

    if (!group) return null
    const done = (message: string) => {
        toast.success(message)
        if (unmatchedGroups.length <= 1) setOpen(false)
        else setPage(p => Math.min(p, unmatchedGroups.length - 2))
    }
    const choices: AL_BaseAnime[] = search
        ? (asId ? (byId?.media ? [byId.media] : []) : (results?.Page?.media ?? []))
        : (suggestions ?? [])
    const loading = search ? (asId ? loadingId : searching) : suggesting
    const allPicked = picked.length === files.length

    return <PhoneSheet title={t("Unmatched files", "Dateien ohne Anime")} open={open} onOpenChange={setOpen} className="plib-tall" data-library-unmatched
        footer={<>
            <button type="button" className="ps-secondary" data-unmatched-ignore disabled={!picked.length || matching || ignoring}
                onClick={() => updateFiles({ paths: picked, action: "ignore" }, { onSuccess: () => done(t("Files ignored", "Dateien ignoriert")) })}>
                {t("Ignore", "Ignorieren")}
            </button>
            <button type="button" className="ps-primary" data-unmatched-match disabled={!anime || !picked.length || matching || ignoring}
                onClick={() => anime && match({ paths: picked, mediaId: anime.id }, { onSuccess: () => done(t("Files matched", "Dateien zugeordnet")) })}>
                {picked.length ? t(`Match ${plural(t, picked.length, ["file", "files"], ["Datei", "Dateien"])}`, `${plural(t, picked.length, ["Datei", "Dateien"], ["Datei", "Dateien"])} zuordnen`)
                    : t("Match", "Zuordnen")}
            </button>
        </>}>
        <div className="plib-folder" data-unmatched-folder>
            <div className="plib-folder-text">
                <p>{upath.basename(group.dir) || group.dir}</p>
                <small>{[unmatchedGroups.length > 1 ? t(`Folder ${page + 1} of ${unmatchedGroups.length}`, `Ordner ${page + 1} von ${unmatchedGroups.length}`) : "", parentInLibrary(group.dir, folders)]
                    .filter(Boolean).join(" · ")}</small>
            </div>
            {unmatchedGroups.length > 1 && <>
                <PhoneIconButton label={t("Previous folder", "Vorheriger Ordner")} disabled={page === 0} onClick={() => setPage(p => p - 1)} data-unmatched-prev><LuChevronLeft aria-hidden /></PhoneIconButton>
                <PhoneIconButton label={t("Next folder", "Nächster Ordner")} disabled={page >= unmatchedGroups.length - 1} onClick={() => setPage(p => p + 1)} data-unmatched-next><LuChevronRight aria-hidden /></PhoneIconButton>
            </>}
        </div>

        <PhoneSheetGroup title={t("Which anime is it?", "Welcher Anime ist es?")} data-unmatched-anime
            note={search ? undefined : t("Suggestions from the folder's name. Search by title or enter an AniList ID.", "Vorschläge aus dem Ordnernamen. Suche nach Titel oder gib eine AniList-ID ein.")}>
            <PhoneSearchField t={t} value={query} onChange={setQuery} placeholder={t("Title or AniList ID", "Titel oder AniList-ID")} data-unmatched-search />
            {loading && !choices.length
                ? <p className="ps-sheet-note" role="status">{t("Looking…", "Suche…")}</p>
                : !choices.length
                    ? <p className="ps-sheet-note" data-unmatched-none>{search ? t("Nothing found. Try another title.", "Nichts gefunden. Versuch einen anderen Titel.")
                        : t("No suggestions for this folder. Search above.", "Keine Vorschläge für diesen Ordner. Such oben.")}</p>
                    : <div className="ps-rows" role="radiogroup" aria-label={t("Anime", "Anime")}>
                        {choices.map(media => <PhonePick key={media.id} role="radio" checked={anime?.id === media.id} onChange={() => setAnime(media)}
                            media={<Cover src={media.coverImage?.medium || media.coverImage?.large} />} label={animeTitle(media)} note={animeNote(t, media)} data-unmatched-choice={media.id} />)}
                    </div>}
        </PhoneSheetGroup>

        <PhoneSheetGroup title={t("Files", "Dateien")} data-unmatched-files
            action={files.length > 1 && <button type="button" className="ps-text-action" data-unmatched-all onClick={() => setPicked(allPicked ? [] : files.map(lf => lf.path))}>
                {allPicked ? t("Pick none", "Keine wählen") : t("Pick all", "Alle wählen")}
            </button>}
            note={t(`${picked.length} of ${files.length} picked`, `${picked.length} von ${files.length} gewählt`)}>
            <div className="ps-rows">
                {files.map(lf => <PhonePick key={lf.path} checked={picked.includes(lf.path)} label={fileName(lf)} data-unmatched-file
                    note={lf.parsedInfo?.episode ? t(`Episode ${lf.parsedInfo.episode}`, `Folge ${lf.parsedInfo.episode}`) : undefined}
                    onChange={() => setPicked(list => list.includes(lf.path) ? list.filter(path => path !== lf.path) : [...list, lf.path])} />)}
            </div>
        </PhoneSheetGroup>
    </PhoneSheet>
}

function HiddenAnime({ t, group, busy, onAdd, onUnmatch }: { t: Translate, group: Anime_UnknownGroup, busy: boolean, onAdd: () => void, onUnmatch: () => void }) {
    const { data: entry } = useGetAnimeEntry(group.mediaId)
    const [showFiles, setShowFiles] = React.useState(false)
    const files = [...(group.localFiles ?? [])].sort(byEpisode)
    const title = animeTitle(entry?.media) || t(`AniList ID ${group.mediaId}`, `AniList-ID ${group.mediaId}`)
    return <div className="plib-hidden" data-hidden-anime={group.mediaId}>
        <button type="button" className="plib-hidden-head" aria-expanded={showFiles} onClick={() => setShowFiles(v => !v)}>
            <Cover src={entry?.media?.coverImage?.medium || entry?.media?.coverImage?.large} />
            <span className="ps-pick-text"><span>{title}</span><small>{plural(t, files.length, ["file", "files"], ["Datei", "Dateien"])}{entry?.media ? ` · ${animeNote(t, entry.media)}` : ""}</small></span>
            <LuChevronRight className="ps-action-chevron plib-expand" aria-hidden />
        </button>
        {showFiles && <ul className="plib-files">{files.map(lf => <li key={lf.path}>{fileName(lf)}</li>)}</ul>}
        <div className="plib-hidden-actions">
            <button type="button" className="ps-secondary" disabled={busy} onClick={onUnmatch} data-hidden-unmatch>{t("Unmatch", "Zuordnung lösen")}</button>
            <button type="button" className="ps-secondary plib-accent" disabled={busy} onClick={onAdd} data-hidden-add>{t("Add to AniList", "Zu AniList hinzufügen")}</button>
        </div>
    </div>
}

/** Hidden anime: files matched to anime that are not on the user's AniList; add them (each or all) or unmatch the files. */
export function HiddenMediaPhoneSheet({ unknownGroups, onActionComplete }: { unknownGroups: Anime_UnknownGroup[], onActionComplete?: () => void }) {
    const t = useTr()
    const [open, setOpen] = useAtom(__unknownMedia_drawerIsOpen)
    const { mutate: add, isPending: adding } = useAddUnknownMedia()
    const { mutate: bulk, isPending: unmatching } = useAnimeEntryBulkAction()
    React.useEffect(() => { if (open && !unknownGroups.length) setOpen(false) }, [open, unknownGroups.length])
    if (!unknownGroups.length) return null
    const busy = adding || unmatching
    return <PhoneSheet title={t("Hidden anime", "Versteckte Anime")} open={open} onOpenChange={o => !adding && setOpen(o)} className="plib-tall" data-library-hidden
        footer={unknownGroups.length > 1 && <button type="button" className="ps-primary" disabled={busy} data-hidden-add-all
            onClick={() => add({ mediaIds: unknownGroups.map(group => group.mediaId) }, { onSuccess: () => onActionComplete?.() })}>
            {t(`Add all ${unknownGroups.length} to AniList`, `Alle ${unknownGroups.length} zu AniList hinzufügen`)}
        </button>}>
        <p className="ps-sheet-text">{t("These files belong to anime that aren't on your AniList, so your library doesn't show them. Add the anime, or unmatch the files if the match is wrong.",
            "Diese Dateien gehören zu Anime, die nicht auf deiner AniList stehen, darum zeigt deine Bibliothek sie nicht. Füge die Anime hinzu oder löse die Zuordnung, wenn sie falsch ist.")}</p>
        {unknownGroups.map(group => <HiddenAnime key={group.mediaId} t={t} group={group} busy={busy}
            onAdd={() => add({ mediaIds: [group.mediaId] }, { onSuccess: () => onActionComplete?.() })}
            onUnmatch={() => bulk({ mediaId: group.mediaId, action: "unmatch" }, {
                onSuccess: () => {
                    toast.success(t("Files unmatched", "Zuordnung gelöst"))
                    onActionComplete?.()
                },
            })} />)}
    </PhoneSheet>
}

/** Ignored files: pick the ones scans should look at again. */
export function IgnoredFilesPhoneSheet({ files }: { files: Anime_LocalFile[] }) {
    const t = useTr()
    const [open, setOpen] = useAtom(__ignoredFileManagerIsOpen)
    const [picked, setPicked] = React.useState<string[]>([])
    const { mutate: updateFiles, isPending } = useUpdateLocalFiles()
    React.useEffect(() => setPicked([]), [files, open])
    const allPicked = !!files.length && picked.length === files.length
    return <PhoneSheet title={t("Ignored files", "Ignorierte Dateien")} open={open} onOpenChange={setOpen} className="plib-tall" data-library-ignored
        footer={!!files.length && <button type="button" className="ps-primary" disabled={!picked.length || isPending} data-ignored-unignore
            onClick={() => updateFiles({ paths: picked, action: "unignore" }, { onSuccess: () => toast.success(t("Scans include these files again", "Scans beziehen diese Dateien wieder ein")) })}>
            {picked.length ? t(`Stop ignoring ${plural(t, picked.length, ["file", "files"], ["Datei", "Dateien"])}`, `${plural(t, picked.length, ["Datei", "Dateien"], ["Datei", "Dateien"])} nicht mehr ignorieren`)
                : t("Stop ignoring", "Nicht mehr ignorieren")}
        </button>}>
        {!files.length
            ? <PhoneEmpty title={t("No ignored files", "Keine ignorierten Dateien")} text={t("Files you ignore are skipped by every scan.", "Dateien, die du ignorierst, überspringt jeder Scan.")} />
            : <PhoneSheetGroup title={t("Files", "Dateien")} note={t(`${picked.length} of ${files.length} picked`, `${picked.length} von ${files.length} gewählt`)}
                action={files.length > 1 && <button type="button" className="ps-text-action" data-ignored-all onClick={() => setPicked(allPicked ? [] : files.map(lf => lf.path))}>
                    {allPicked ? t("Pick none", "Keine wählen") : t("Pick all", "Alle wählen")}
                </button>}>
                <div className="ps-rows">
                    {files.map(lf => <PhonePick key={lf.path} checked={picked.includes(lf.path)} label={fileName(lf)} note={upath.dirname(lf.path)} data-ignored-file
                        onChange={() => setPicked(list => list.includes(lf.path) ? list.filter(path => path !== lf.path) : [...list, lf.path])} />)}
                </div>
            </PhoneSheetGroup>}
    </PhoneSheet>
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
    if (progress != null) return <PhoneFloat progress={progress} data-library-status="scanning"
        text={autoScanning ? t("Refreshing your library", "Bibliothek wird aktualisiert") : t("Scanning your library", "Bibliothek wird gescannt")}
        detail={`${Math.round(progress)} %${status ? ` · ${status}` : ""}`} />
    if (changed) return <PhoneFloat data-library-status="changed" text={t("Your library folder changed", "Dein Bibliotheksordner hat sich geändert")}
        detail={t("Refresh to show the new files", "Aktualisiere, um die neuen Dateien zu sehen")}>
        <button type="button" className="ps-text-action" onClick={onDismiss} data-library-status-dismiss>{t("Later", "Später")}</button>
        <button type="button" className="ps-text-action" onClick={onRefresh} data-library-status-refresh>{t("Refresh", "Aktualisieren")}</button>
    </PhoneFloat>
    return null
}
