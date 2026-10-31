import { AL_AnimeDetailsById_Media, Anime_Entry } from "@/api/generated/types"
import { useDeleteLocalFiles, useUpdateLocalFiles } from "@/api/hooks/localfiles.hooks"
import {
    useDeleteMediaMetadataParent,
    useGetMediaMetadataParent,
    usePopulateFillerData,
    useRemoveFillerData,
    useSaveMediaMetadataParent,
} from "@/api/hooks/metadata.hooks"
import { PhoneEmpty, PhoneField, PhonePick, PhoneRow, PhoneSheet, PhoneSheetGroup, PhoneSwitch } from "@/app/(main)/_features/phone-screen/phone-screen"
import { usePluginAnimePageDropdownItems } from "@/app/(main)/_features/plugin/actions/plugin-actions"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { useAnimeEntryPageView } from "@/app/(main)/entry/_containers/anime-entry-page"
import { __anime_hiddenEntryViewsAtom } from "@/app/(main)/entry/_lib/hidden-entry-views"
import { __torrentSearch_selectionAtom } from "@/app/(main)/entry/_containers/torrent-search/torrent-search-drawer"
import { useAnimeListTorrentProviderExtensions } from "@/api/hooks/extensions.hooks"
import { useAtom, useSetAtom } from "jotai"
import { IconButton } from "@/components/ui/button"
import { copyToClipboard } from "@/lib/helpers/browser"
import { Translate, useTr } from "@/lib/app-language"
import { upath } from "@/lib/helpers/upath"
import { useRouter } from "@/lib/navigation"
import { isCustomSource } from "@/lib/server/utils"
import { TabletLabel } from "@/lib/tablet-ui"
import React from "react"
import { BiDotsVerticalRounded } from "react-icons/bi"
import { LuArrowUpRight, LuCopy, LuFileMinus, LuGlobe, LuListChecks, LuMagnet, LuPuzzle, LuTrash2 } from "react-icons/lu"
import { toast } from "sonner"

/**
 * The anime page's "More" on Android phones: the anime elsewhere (AniList, AniDB, MyAnimeList), filler episodes and
 * specials metadata, the plugins' actions, for anime in the local library unmatching or deleting some of its files, and
 * which streaming tabs anime pages show on this phone (a tab whose feature is off links to its setting).
 * Each opens a sheet of the phone kit instead of the desktop dropdown and its centred modals. Downloading files to the
 * browser is left out: on a phone they already are on the device.
 */

type View = "menu" | "metadata" | "unmatch" | "delete" | null
const plural = (t: Translate, n: number, en: [string, string], de: [string, string]) => `${n} ${n === 1 ? t(en[0], de[0]) : t(en[1], de[1])}`

export function ExternalRow({ href, label, note }: { href: string, label: string, note: string }) {
    return <a href={href} target="_blank" rel="noreferrer" className="ps-action" data-entry-link={label}>
        <LuGlobe className="ps-action-icon" aria-hidden />
        <span className="ps-action-text"><span>{label}</span><small>{note}</small></span>
        <LuArrowUpRight className="ps-action-chevron" aria-hidden />
    </a>
}

export function AnimeEntryPhoneMenu({ entry, details }: { entry: Anime_Entry, details?: AL_AnimeDetailsById_Media }) {
    const t = useTr()
    const trigger = React.useRef<HTMLButtonElement>(null)
    const [view, setView] = React.useState<View>(null)
    const { isLibraryView } = useAnimeEntryPageView()
    const { items: pluginItems, handleClick: runPlugin } = usePluginAnimePageDropdownItems(entry.media)
    const hasFiles = isLibraryView && !!entry.libraryData && !entry._isNakamaEntry && !!entry.localFiles?.length
    const files = entry.localFiles?.length ?? 0
    const { data: torrentProviders } = useAnimeListTorrentProviderExtensions()
    const openTorrentSearch = useSetAtom(__torrentSearch_selectionAtom)
    const canDownloadTorrent = !!torrentProviders?.length && entry.media?.status !== "NOT_YET_RELEASED" && !entry._isNakamaEntry
    const serverStatus = useServerStatus()
    const [hiddenViews, setHiddenViews] = useAtom(__anime_hiddenEntryViewsAtom)
    const router = useRouter()
    // A tab whose feature is off in the settings has nothing to show; its row opens that setting instead
    const tabs = [
        { view: "torrentstream", settingsTab: "torrentstream", label: t("Torrent streaming", "Torrent-Streaming"), on: !!serverStatus?.torrentstreamSettings?.enabled },
        { view: "debridstream", settingsTab: "debrid", label: t("Debrid streaming", "Debrid-Streaming"), on: !!serverStatus?.debridSettings?.enabled },
        { view: "onlinestream", settingsTab: "onlinestream", label: t("Online streaming", "Online-Streaming"), on: !!serverStatus?.settings?.library?.enableOnlinestream },
    ]

    // One sheet at a time: the menu closes before the next one opens, so Back always returns to the page
    const go = (next: View) => {
        setView(null)
        setTimeout(() => setView(next), 150)
    }
    const close = (open: boolean) => { if (!open) setView(null) }

    return <>
        <IconButton ref={trigger} data-anime-entry-dropdown-menu-trigger intent="gray-subtle" size="md"
            icon={<><BiDotsVerticalRounded /><TabletLabel>{t("More", "Mehr")}</TabletLabel></>}
            aria-label={t("More for this anime", "Mehr zu diesem Anime")} aria-haspopup="dialog" onClick={() => setView("menu")} />

        <PhoneSheet title={t("More", "Mehr")} open={view === "menu"} onOpenChange={close} returnFocusRef={trigger} data-entry-phone-menu>
            <PhoneSheetGroup title={t("Elsewhere", "Anderswo")}>
                <div className="ps-rows">
                    {!isCustomSource(entry.mediaId) && <ExternalRow href={`https://anilist.co/anime/${entry.mediaId}`} label="AniList" note={t("Lists, reviews, staff", "Listen, Rezensionen, Mitwirkende")} />}
                    {!!entry.anidbId && <ExternalRow href={`https://anidb.net/anime/${entry.anidbId}`} label="AniDB" note={t("Episodes and files", "Folgen und Dateien")} />}
                    {!!entry.media?.idMal && <ExternalRow href={`https://myanimelist.net/anime/${entry.media.idMal}`} label="MyAnimeList" note={t("Scores and forums", "Wertungen und Foren")} />}
                    {isCustomSource(entry.mediaId) && <PhoneRow icon={<LuCopy />} label={t("Copy ID", "ID kopieren")} value={entry.mediaId} data-entry-copy-id
                        onClick={() => copyToClipboard(entry.mediaId.toString()).then(() => toast.success(t("ID copied", "ID kopiert")))} />}
                </div>
            </PhoneSheetGroup>
            <PhoneSheetGroup title={t("Episodes", "Folgen")}>
                <div className="ps-rows">
                    <PhoneRow icon={<LuListChecks />} label={t("Filler and specials", "Filler und Specials")} chevron data-entry-open="metadata"
                        note={t("Mark filler episodes, link specials to their series", "Filler-Folgen markieren, Specials ihrer Serie zuordnen")} onClick={() => go("metadata")} />
                    {canDownloadTorrent && <PhoneRow icon={<LuMagnet />} label={t("Download a torrent", "Torrent herunterladen")} chevron data-entry-open="torrent-download"
                        note={t("Into your library folder, with the app's own torrent client", "In deinen Bibliotheksordner, mit dem Torrent-Client der App")}
                        onClick={() => { setView(null); setTimeout(() => openTorrentSearch("download"), 150) }} />}
                </div>
            </PhoneSheetGroup>
            {hasFiles && <PhoneSheetGroup title={t("Files on this device", "Dateien auf diesem Gerät")} note={plural(t, files, ["file", "files"], ["Datei", "Dateien"])}>
                <div className="ps-rows">
                    <PhoneRow icon={<LuFileMinus />} label={t("Unmatch files", "Zuordnung lösen")} chevron data-entry-open="unmatch"
                        note={t("They go back to the unmatched files", "Sie kommen zurück zu den Dateien ohne Anime")} onClick={() => go("unmatch")} />
                    <PhoneRow icon={<LuTrash2 />} tone="danger" label={t("Delete files", "Dateien löschen")} chevron data-entry-open="delete"
                        note={t("Removes them from this device", "Entfernt sie von diesem Gerät")} onClick={() => go("delete")} />
                </div>
            </PhoneSheetGroup>}
            {pluginItems.length > 0 && <PhoneSheetGroup title={t("Plugins", "Plugins")}>
                <div className="ps-rows">
                    {pluginItems.map(item => <PhoneRow key={item.id} icon={<LuPuzzle />} label={item.label || "?"} disabled={item.disabled} data-entry-plugin={item.id}
                        onClick={() => {
                            setView(null)
                            runPlugin(item)
                        }} />)}
                </div>
            </PhoneSheetGroup>}
            <PhoneSheetGroup title={t("Tabs", "Tabs")} data-entry-tabs
                note={t("For every anime page on this device. The library tab always stays.", "Für jede Anime-Seite auf diesem Gerät. Der Bibliothek-Tab bleibt immer.")}>
                <div className="ps-rows">
                    {tabs.map(tab => tab.on
                        ? <PhoneSwitch key={tab.view} label={tab.label} checked={!hiddenViews.includes(tab.view)} data-entry-tab={tab.view}
                            onChange={shown => setHiddenViews(list => shown ? list.filter(view => view !== tab.view) : [...list, tab.view])} />
                        : <PhoneRow key={tab.view} label={tab.label} note={t("Off in the settings. Tap to turn it on.", "In den Einstellungen aus. Tippen zum Einschalten.")}
                            chevron data-entry-tab-settings={tab.view} onClick={() => {
                                setView(null)
                                router.push(`/settings?tab=${tab.settingsTab}`)
                            }} />)}
                </div>
            </PhoneSheetGroup>
        </PhoneSheet>

        <MetadataPhoneSheet t={t} entry={entry} details={details} open={view === "metadata"} onOpenChange={close} returnFocusRef={trigger} />
        {hasFiles && <FilesPhoneSheet t={t} entry={entry} mode="unmatch" open={view === "unmatch"} onOpenChange={close} returnFocusRef={trigger} />}
        {hasFiles && <FilesPhoneSheet t={t} entry={entry} mode="delete" open={view === "delete"} onOpenChange={close} returnFocusRef={trigger} />}
    </>
}

type SheetProps = { t: Translate, entry: Anime_Entry, open: boolean, onOpenChange: (open: boolean) => void, returnFocusRef: React.RefObject<HTMLElement | null> }

/** Filler episodes from AnimeFillerList, and for specials without AniDB data the parent series their metadata comes from. */
function MetadataPhoneSheet({ t, entry, details, open, onOpenChange, returnFocusRef }: SheetProps & { details?: AL_AnimeDetailsById_Media }) {
    const { mutate: populate, isPending: populating } = usePopulateFillerData()
    const { mutate: removeFiller, isPending: removing } = useRemoveFillerData()
    const { data: stored, isLoading } = useGetMediaMetadataParent(entry.mediaId)
    const { mutate: saveParent, isPending: saving } = useSaveMediaMetadataParent()
    const { mutate: deleteParent, isPending: deleting } = useDeleteMediaMetadataParent()
    const [parentId, setParentId] = React.useState("")
    const [offset, setOffset] = React.useState("")
    React.useEffect(() => {
        if (!stored?.id) return
        setParentId(String(stored.parentId || ""))
        setOffset(String(stored.specialOffset || ""))
    }, [stored])
    const series = entry.media?.format === "TV" || entry.media?.format === "TV_SHORT" || entry.media?.format === "ONA"
    const suggested = details?.relations?.edges?.find(edge => edge.relationType === "PARENT")?.node?.id
    const busy = populating || removing
    const parentBusy = saving || deleting

    return <PhoneSheet title={t("Filler and specials", "Filler und Specials")} open={open} onOpenChange={onOpenChange} returnFocusRef={returnFocusRef} data-entry-metadata
        footer={!entry.anidbId && <>
            {!!stored?.id && <button type="button" className="ps-secondary" disabled={parentBusy} data-metadata-parent-remove
                onClick={() => deleteParent({ mediaId: entry.mediaId })}>{t("Unlink", "Verknüpfung lösen")}</button>}
            <button type="button" className="ps-primary" disabled={parentBusy || !Number(parentId)} data-metadata-parent-save
                onClick={() => saveParent({ mediaId: entry.mediaId, parentId: Number(parentId), specialOffset: Number(offset) || 0 })}>
                {t("Save series link", "Serien-Verknüpfung speichern")}
            </button>
        </>}>
        <PhoneSheetGroup title={t("Filler episodes", "Filler-Folgen")} data-metadata-group="filler"
            note={series ? t("From AnimeFillerList. Filler episodes are marked in the episode list.", "Von AnimeFillerList. Filler-Folgen werden in der Folgenliste markiert.")
                : t("AnimeFillerList only covers TV and web series.", "AnimeFillerList kennt nur TV- und Web-Serien.")}>
            <div className="ps-rows">
                <PhoneRow label={populating ? t("Fetching…", "Wird abgerufen…") : t("Fetch filler info", "Filler-Infos abrufen")} disabled={!series || busy}
                    data-metadata-filler="fetch" onClick={() => populate({ mediaId: entry.mediaId })} />
                <PhoneRow label={removing ? t("Removing…", "Wird entfernt…") : t("Remove filler info", "Filler-Infos entfernen")} disabled={!series || busy}
                    data-metadata-filler="remove" onClick={() => removeFiller({ mediaId: entry.mediaId })} />
            </div>
        </PhoneSheetGroup>
        {!entry.anidbId && <PhoneSheetGroup title={t("Specials", "Specials")} data-metadata-group="parent"
            note={t("Without AniDB data, specials can take their episode titles and pictures from the series they belong to.",
                "Ohne AniDB-Daten können Specials Folgentitel und Bilder von ihrer Serie übernehmen.")}
            action={!!suggested && String(suggested) !== parentId && <button type="button" className="ps-text-action" data-metadata-parent-suggest
                onClick={() => setParentId(String(suggested))}>{t("Use the parent series", "Hauptserie nehmen")}</button>}>
            {isLoading ? <p className="ps-sheet-note" role="status">{t("Loading…", "Wird geladen…")}</p> : <>
                <PhoneField id="entry-metadata-parent" label={t("Series (AniList ID)", "Serie (AniList-ID)")} numeric value={parentId} onChange={setParentId}
                    placeholder="21" data-metadata-parent-id />
                <PhoneField id="entry-metadata-offset" label={t("Special offset", "Special-Versatz")} numeric value={offset} onChange={setOffset} placeholder="0"
                    note={t("0 = the series' first specials, 1 = the second, and so on", "0 = erste Specials der Serie, 1 = zweite, usw.")} data-metadata-offset />
            </>}
        </PhoneSheetGroup>}
    </PhoneSheet>
}

/** Pick some of the anime's files, then unmatch or delete them after one confirmation in the same sheet. */
function FilesPhoneSheet({ t, entry, mode, open, onOpenChange, returnFocusRef }: SheetProps & { mode: "unmatch" | "delete" }) {
    const files = React.useMemo(() => [...(entry.localFiles ?? [])]
        .sort((a, b) => (a.metadata?.episode ?? 0) - (b.metadata?.episode ?? 0) || a.path.localeCompare(b.path)), [entry.localFiles])
    const [picked, setPicked] = React.useState<string[]>([])
    const [confirming, setConfirming] = React.useState(false)
    const { mutate: updateFiles, isPending: unmatching } = useUpdateLocalFiles()
    const { mutate: deleteFiles, isPending: deleting } = useDeleteLocalFiles()
    React.useEffect(() => {
        setPicked([])
        setConfirming(false)
    }, [open])
    const busy = unmatching || deleting
    const count = plural(t, picked.length, ["file", "files"], ["Datei", "Dateien"])
    const allPicked = !!files.length && picked.length === files.length
    const done = () => onOpenChange(false)

    if (confirming) return <PhoneSheet title={mode === "delete" ? t(`Delete ${count}?`, `${count} löschen?`) : t(`Unmatch ${count}?`, `Zuordnung von ${count} lösen?`)}
        open={open} onOpenChange={onOpenChange} returnFocusRef={returnFocusRef} data-entry-files-confirm={mode}
        footer={<>
            <button type="button" className="ps-secondary" onClick={() => setConfirming(false)}>{t("Back", "Zurück")}</button>
            <button type="button" className="ps-primary" data-tone={mode === "delete" ? "danger" : undefined} disabled={busy} data-entry-files-confirm-action
                onClick={() => mode === "delete" ? deleteFiles({ paths: picked }, { onSuccess: done })
                    : updateFiles({ paths: picked, action: "unmatch" }, { onSuccess: done })}>
                {mode === "delete" ? t("Delete", "Löschen") : t("Unmatch", "Zuordnung lösen")}
            </button>
        </>}>
        <p className="ps-sheet-text">{mode === "delete"
            ? t("The files are deleted from this device. This can't be undone.", "Die Dateien werden von diesem Gerät gelöscht. Das lässt sich nicht rückgängig machen.")
            : t("The files stay on this device and wait under unmatched files until you pick an anime for them.",
                "Die Dateien bleiben auf diesem Gerät und warten bei den Dateien ohne Anime, bis du ihnen einen Anime zuordnest.")}</p>
    </PhoneSheet>

    return <PhoneSheet title={mode === "delete" ? t("Delete files", "Dateien löschen") : t("Unmatch files", "Zuordnung lösen")} open={open} onOpenChange={onOpenChange}
        returnFocusRef={returnFocusRef} data-entry-files={mode}
        footer={<button type="button" className="ps-primary" data-tone={mode === "delete" ? "danger" : undefined} disabled={!picked.length || busy} data-entry-files-action
            onClick={() => setConfirming(true)}>
            {!picked.length ? t("Pick files", "Dateien wählen") : mode === "delete" ? t(`Delete ${count}`, `${count} löschen`) : t(`Unmatch ${count}`, `Zuordnung von ${count} lösen`)}
        </button>}>
        {!files.length ? <PhoneEmpty title={t("No files", "Keine Dateien")} />
            : <PhoneSheetGroup title={t("Files", "Dateien")} note={t(`${picked.length} of ${files.length} picked`, `${picked.length} von ${files.length} gewählt`)}
                action={files.length > 1 && <button type="button" className="ps-text-action" data-entry-files-all onClick={() => setPicked(allPicked ? [] : files.map(f => f.path))}>
                    {allPicked ? t("Pick none", "Keine wählen") : t("Pick all", "Alle wählen")}
                </button>}>
                <div className="ps-rows">
                    {files.map(file => <PhonePick key={file.path} checked={picked.includes(file.path)} label={upath.basename(file.path)} data-entry-file
                        note={file.metadata?.episode ? t(`Episode ${file.metadata.episode}`, `Folge ${file.metadata.episode}`) : upath.basename(upath.dirname(file.path))}
                        onChange={() => setPicked(list => list.includes(file.path) ? list.filter(path => path !== file.path) : [...list, file.path])} />)}
                </div>
            </PhoneSheetGroup>}
    </PhoneSheet>
}
