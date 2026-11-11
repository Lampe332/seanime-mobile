import type { AL_AnimeDetailsById_Media, Anime_Entry } from "@/api/generated/types"
import { useDeleteLocalFiles, useUpdateLocalFiles } from "@/api/hooks/localfiles.hooks"
import { useDeleteMediaMetadataParent, useGetMediaMetadataParent, usePopulateFillerData, useRemoveFillerData, useSaveMediaMetadataParent } from "@/api/hooks/metadata.hooks"
import { ActionRow, PickRow, RowGroup } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { copyToClipboard, openInAppBrowser } from "@/lib/helpers/browser"
import { upath } from "@/lib/helpers/upath"
import { MENU_ENTRIES } from "@/lib/nav/nav-items"
import { useRouter } from "@/lib/navigation"
import { isCustomSource } from "@/lib/server/utils"
import { colors } from "@/lib/theme/tokens"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { __anime_hiddenEntryViewsAtom, getEntryTabSettings } from "@/main/entry/_lib/anime-entry-view"
import { useAnimeListTorrentProviderExtensions } from "@/api/hooks/extensions.hooks"
import { __torrentSearch_selectionAtom } from "@/main/entry/_containers/torrent-search/torrent-search.atoms"
import { useAtom, useSetAtom } from "jotai"
import { usePluginActions, useRunPluginAction } from "@/main/_features/plugin/plugin-actions"
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right"
import Copy from "lucide-react-native/icons/copy"
import FileMinus from "lucide-react-native/icons/file-minus"
import Globe from "lucide-react-native/icons/globe"
import ListChecks from "lucide-react-native/icons/list-checks"
import Magnet from "lucide-react-native/icons/magnet"
import Puzzle from "lucide-react-native/icons/puzzle"
import Trash2 from "lucide-react-native/icons/trash"
import React from "react"
import { TextInput, View } from "react-native"

/*
 * The anime page's "More" (anime-entry-phone-menu.tsx): the anime elsewhere (AniList, AniDB, MyAnimeList), filler episodes
 * and specials metadata, for anime in the local library unmatching or deleting some of its files, and which streaming
 * tabs anime pages show on this device (a tab whose feature is off links to its setting).
 * "Download a torrent" (with a torrent provider installed) opens the torrent sheet. The plugins' items for the page are a
 * group of their own (2.17). A tab that is off in
 * the settings shows its "Off in the settings" row, which opens the settings on that area (`/settings?tab=…`, 2.12).
 */

type MenuView = "menu" | "metadata" | "unmatch" | "delete" | null
const plural = (t: Translate, n: number, en: [string, string], de: [string, string]) => `${n} ${n === 1 ? t(en[0], de[0]) : t(en[1], de[1])}`

export function ExternalRow({ href, label, note }: { href: string, label: string, note: string }) {
    return <ActionRow icon={Globe} label={label} note={note} onPress={() => openInAppBrowser(href)} trailing={<ArrowUpRight size={18} color={colors.smTextSubtle} />} />
}

export function AnimeEntryPhoneMenu({ entry, details, open, onOpenChange, isLibraryView }: {
    entry: Anime_Entry
    details?: AL_AnimeDetailsById_Media
    open: boolean
    onOpenChange: (open: boolean) => void
    isLibraryView: boolean
}) {
    const t = useTr()
    const router = useRouter()
    const serverStatus = useServerStatus()
    const [view, setView] = React.useState<MenuView>(null)
    const [hiddenViews, setHiddenViews] = useAtom(__anime_hiddenEntryViewsAtom)
    const hasFiles = isLibraryView && !!entry.libraryData && !entry._isNakamaEntry && !!entry.localFiles?.length
    const files = entry.localFiles?.length ?? 0
    const settingsReady = MENU_ENTRIES.some(e => e.id === "settings" && e.ready)
    const tabs = getEntryTabSettings(t, serverStatus)
    const { data: torrentProviders } = useAnimeListTorrentProviderExtensions()
    const openTorrentSearch = useSetAtom(__torrentSearch_selectionAtom)
    const canDownloadTorrent = !!torrentProviders?.length && entry.media?.status !== "NOT_YET_RELEASED" && !entry._isNakamaEntry
    // the plugins' items for this page (usePluginAnimePageDropdownItems)
    const pluginItems = usePluginActions("animePageItems")
    const runPlugin = useRunPluginAction()

    // One sheet at a time, so Back always returns to the page: the menu leaves in the same render the next sheet comes in
    const shown: MenuView = view ?? (open ? "menu" : null)
    const go = (next: MenuView) => setView(next)
    const close = (isOpen: boolean) => {
        if (isOpen) return
        setView(null)
        onOpenChange(false)
    }

    return <>
        <Sheet title={t("More", "Mehr")} open={shown === "menu"} onOpenChange={close}>
            <SheetGroup title={t("Elsewhere", "Anderswo")}>
                <RowGroup>
                    {!isCustomSource(entry.mediaId) && <ExternalRow href={`https://anilist.co/anime/${entry.mediaId}`} label="AniList" note={t("Lists, reviews, staff", "Listen, Rezensionen, Mitwirkende")} />}
                    {!!entry.anidbId && <ExternalRow href={`https://anidb.net/anime/${entry.anidbId}`} label="AniDB" note={t("Episodes and files", "Folgen und Dateien")} />}
                    {!!entry.media?.idMal && <ExternalRow href={`https://myanimelist.net/anime/${entry.media.idMal}`} label="MyAnimeList" note={t("Scores and forums", "Wertungen und Foren")} />}
                    {isCustomSource(entry.mediaId) && <ActionRow icon={Copy} label={t("Copy ID", "ID kopieren")} value={entry.mediaId}
                        onPress={() => copyToClipboard(entry.mediaId.toString()).then(() => toast.success(t("ID copied", "ID kopiert")))} />}
                </RowGroup>
            </SheetGroup>
            <SheetGroup title={t("Episodes", "Folgen")}>
                <RowGroup>
                    <ActionRow icon={ListChecks} label={t("Filler and specials", "Filler und Specials")} chevron
                        note={t("Mark filler episodes, link specials to their series", "Filler-Folgen markieren, Specials ihrer Serie zuordnen")} onPress={() => go("metadata")} />
                    {canDownloadTorrent && <ActionRow icon={Magnet} label={t("Download a torrent", "Torrent herunterladen")} chevron
                        note={t("Into your library folder, with the app's own torrent client", "In deinen Bibliotheksordner, mit dem Torrent-Client der App")}
                        onPress={() => {
                            close(false)
                            openTorrentSearch("download")
                        }} />}
                </RowGroup>
            </SheetGroup>
            {hasFiles && <SheetGroup title={t("Files on this device", "Dateien auf diesem Gerät")} note={plural(t, files, ["file", "files"], ["Datei", "Dateien"])}>
                <RowGroup>
                    <ActionRow icon={FileMinus} label={t("Unmatch files", "Zuordnung lösen")} chevron
                        note={t("They go back to the unmatched files", "Sie kommen zurück zu den Dateien ohne Anime")} onPress={() => go("unmatch")} />
                    <ActionRow icon={Trash2} tone="danger" label={t("Delete files", "Dateien löschen")} chevron
                        note={t("Removes them from this device", "Entfernt sie von diesem Gerät")} onPress={() => go("delete")} />
                </RowGroup>
            </SheetGroup>}
            {pluginItems.length > 0 && <SheetGroup title="Plugins">
                <RowGroup>
                    {pluginItems.map(item => <ActionRow key={`${item.extensionId}:${item.id}`} icon={Puzzle} label={item.label || "???"} disabled={item.disabled}
                        onPress={() => {
                            close(false)
                            runPlugin(item, { media: entry.media })
                        }} />)}
                </RowGroup>
            </SheetGroup>}
            <SheetGroup title={t("Tabs", "Tabs")}>
                <Muted className="leading-[19.5px]">{t("For every anime page on this device. The library tab always stays.", "Für jede Anime-Seite auf diesem Gerät. Der Bibliothek-Tab bleibt immer.")}</Muted>
                <RowGroup>
                    {tabs.map(tab => tab.on
                        ? <SwitchRow key={tab.view} label={tab.label} checked={!hiddenViews.includes(tab.view)}
                            onCheckedChange={shown => setHiddenViews(list => shown ? list.filter(v => v !== tab.view) : [...list, tab.view])} />
                        : <ActionRow key={tab.view} label={tab.label} chevron={settingsReady}
                            note={settingsReady ? t("Off in the settings. Tap to turn it on.", "In den Einstellungen aus. Tippen zum Einschalten.") : t("Off in the settings.", "In den Einstellungen aus.")}
                            onPress={settingsReady ? () => {
                                close(false)
                                router.push(`/settings?tab=${tab.settingsTab}`)
                            } : undefined} />)}
                </RowGroup>
            </SheetGroup>
        </Sheet>

        <MetadataSheet t={t} entry={entry} details={details} open={shown === "metadata"} onOpenChange={close} />
        {hasFiles && <FilesSheet t={t} entry={entry} mode="unmatch" open={shown === "unmatch"} onOpenChange={close} />}
        {hasFiles && <FilesSheet t={t} entry={entry} mode="delete" open={shown === "delete"} onOpenChange={close} />}
    </>
}

type SheetProps = { t: Translate, entry: Anime_Entry, open: boolean, onOpenChange: (open: boolean) => void }

function NumberField({ label, value, onChange, placeholder, note }: { label: string, value: string, onChange: (v: string) => void, placeholder: string, note?: string }) {
    return <View className="gap-1.5">
        <Text className="text-[13px] font-medium text-sm-text-muted">{label}</Text>
        <TextInput value={value} onChangeText={v => onChange(v.replace(/[^0-9]/g, ""))} placeholder={placeholder} keyboardType="number-pad"
            placeholderTextColor={colors.smTextSubtle} accessibilityLabel={label}
            className="min-h-12 rounded-surface-sm bg-sm-surface-raised px-4 font-sans text-base text-sm-text" />
        {!!note && <Muted>{note}</Muted>}
    </View>
}

/** Filler episodes from AnimeFillerList, and for specials without AniDB data the parent series their metadata comes from */
function MetadataSheet({ t, entry, details, open, onOpenChange }: SheetProps & { details?: AL_AnimeDetailsById_Media }) {
    const { mutate: populate, isPending: populating } = usePopulateFillerData()
    const { mutate: removeFiller, isPending: removing } = useRemoveFillerData()
    const { data: stored, isLoading } = useGetMediaMetadataParent(entry.mediaId)
    const { mutate: saveParent, isPending: saving } = useSaveMediaMetadataParent()
    const { mutate: deleteParent, isPending: deleting } = useDeleteMediaMetadataParent()
    const [edited, setEdited] = React.useState<{ parentId?: string, offset?: string }>({})
    const parentId = edited.parentId ?? (stored?.id ? String(stored.parentId || "") : "")
    const offset = edited.offset ?? (stored?.id ? String(stored.specialOffset || "") : "")
    const series = entry.media?.format === "TV" || entry.media?.format === "TV_SHORT" || entry.media?.format === "ONA"
    const suggested = details?.relations?.edges?.find(edge => edge?.relationType === "PARENT")?.node?.id
    const busy = populating || removing
    const parentBusy = saving || deleting

    return <Sheet title={t("Filler and specials", "Filler und Specials")} open={open} onOpenChange={onOpenChange}
        footer={!entry.anidbId ? <>
            {!!stored?.id && <Button intent="secondary" wrapperClassName="flex-1" disabled={parentBusy}
                onPress={() => deleteParent({ mediaId: entry.mediaId })}>{t("Unlink", "Verknüpfung lösen")}</Button>}
            <Button wrapperClassName="flex-1" disabled={parentBusy || !Number(parentId)}
                onPress={() => saveParent({ mediaId: entry.mediaId, parentId: Number(parentId), specialOffset: Number(offset) || 0 })}>
                {t("Save series link", "Serien-Verknüpfung speichern")}
            </Button>
        </> : undefined}>
        <SheetGroup title={t("Filler episodes", "Filler-Folgen")}
            note={series ? t("From AnimeFillerList. Filler episodes are marked in the episode list.", "Von AnimeFillerList. Filler-Folgen werden in der Folgenliste markiert.")
                : t("AnimeFillerList only covers TV and web series.", "AnimeFillerList kennt nur TV- und Web-Serien.")}>
            <RowGroup>
                <ActionRow label={populating ? t("Fetching…", "Wird abgerufen…") : t("Fetch filler info", "Filler-Infos abrufen")} disabled={!series || busy}
                    onPress={() => populate({ mediaId: entry.mediaId })} />
                <ActionRow label={removing ? t("Removing…", "Wird entfernt…") : t("Remove filler info", "Filler-Infos entfernen")} disabled={!series || busy}
                    onPress={() => removeFiller({ mediaId: entry.mediaId })} />
            </RowGroup>
        </SheetGroup>
        {!entry.anidbId && <SheetGroup title={t("Specials", "Specials")}
            note={t("Without AniDB data, specials can take their episode titles and pictures from the series they belong to.",
                "Ohne AniDB-Daten können Specials Folgentitel und Bilder von ihrer Serie übernehmen.")}>
            {!!suggested && String(suggested) !== parentId && <Button intent="text" className="self-start"
                onPress={() => setEdited(e => ({ ...e, parentId: String(suggested) }))}>{t("Use the parent series", "Hauptserie nehmen")}</Button>}
            {isLoading ? <Muted accessibilityRole="progressbar">{t("Loading…", "Wird geladen…")}</Muted> : <>
                <NumberField label={t("Series (AniList ID)", "Serie (AniList-ID)")} value={parentId} placeholder="21" onChange={v => setEdited(e => ({ ...e, parentId: v }))} />
                <NumberField label={t("Special offset", "Special-Versatz")} value={offset} placeholder="0" onChange={v => setEdited(e => ({ ...e, offset: v }))}
                    note={t("0 = the series' first specials, 1 = the second, and so on", "0 = erste Specials der Serie, 1 = zweite, usw.")} />
            </>}
        </SheetGroup>}
    </Sheet>
}

/** Pick some of the anime's files, then unmatch or delete them after one confirmation in the same sheet */
function FilesSheet({ t, entry, mode, open, onOpenChange }: SheetProps & { mode: "unmatch" | "delete" }) {
    const files = React.useMemo(() => [...(entry.localFiles ?? [])]
        .sort((a, b) => (a.metadata?.episode ?? 0) - (b.metadata?.episode ?? 0) || a.path.localeCompare(b.path)), [entry.localFiles])
    const [picked, setPicked] = React.useState<string[]>([])
    const [confirming, setConfirming] = React.useState(false)
    const { mutate: updateFiles, isPending: unmatching } = useUpdateLocalFiles()
    const { mutate: deleteFiles, isPending: deleting } = useDeleteLocalFiles()
    const [wasOpen, setWasOpen] = React.useState(open)
    if (wasOpen !== open) {
        setWasOpen(open)
        setPicked([])
        setConfirming(false)
    }
    const busy = unmatching || deleting
    const count = plural(t, picked.length, ["file", "files"], ["Datei", "Dateien"])
    const allPicked = !!files.length && picked.length === files.length
    const done = () => onOpenChange(false)
    const danger = mode === "delete"

    if (confirming) return <Sheet title={danger ? t(`Delete ${count}?`, `${count} löschen?`) : t(`Unmatch ${count}?`, `Zuordnung von ${count} lösen?`)}
        open={open} onOpenChange={onOpenChange}
        footer={<>
            <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setConfirming(false)}>{t("Back", "Zurück")}</Button>
            <Button intent={danger ? "danger" : "primary"} wrapperClassName="flex-1" disabled={busy}
                onPress={() => danger ? deleteFiles({ paths: picked }, { onSuccess: done }) : updateFiles({ paths: picked, action: "unmatch" }, { onSuccess: done })}>
                {danger ? t("Delete", "Löschen") : t("Unmatch", "Zuordnung lösen")}
            </Button>
        </>}>
        <Text>{danger
            ? t("The files are deleted from this device. This can't be undone.", "Die Dateien werden von diesem Gerät gelöscht. Das lässt sich nicht rückgängig machen.")
            : t("The files stay on this device and wait under unmatched files until you pick an anime for them.",
                "Die Dateien bleiben auf diesem Gerät und warten bei den Dateien ohne Anime, bis du ihnen einen Anime zuordnest.")}</Text>
    </Sheet>

    return <Sheet title={danger ? t("Delete files", "Dateien löschen") : t("Unmatch files", "Zuordnung lösen")} open={open} onOpenChange={onOpenChange}
        footer={<Button intent={danger ? "danger" : "primary"} wrapperClassName="flex-1" disabled={!picked.length || busy} onPress={() => setConfirming(true)}>
            {!picked.length ? t("Pick files", "Dateien wählen") : danger ? t(`Delete ${count}`, `${count} löschen`) : t(`Unmatch ${count}`, `Zuordnung von ${count} lösen`)}
        </Button>}>
        {!files.length ? <Muted>{t("No files", "Keine Dateien")}</Muted>
            : <SheetGroup title={t("Files", "Dateien")} note={t(`${picked.length} of ${files.length} picked`, `${picked.length} von ${files.length} gewählt`)}>
                {files.length > 1 && <Button intent="text" className="self-start" onPress={() => setPicked(allPicked ? [] : files.map(f => f.path))}>
                    {allPicked ? t("Pick none", "Keine wählen") : t("Pick all", "Alle wählen")}
                </Button>}
                <RowGroup>
                    {files.map(file => <PickRow key={file.path} checked={picked.includes(file.path)} label={upath.basename(file.path)}
                        note={file.metadata?.episode ? t(`Episode ${file.metadata.episode}`, `Folge ${file.metadata.episode}`) : upath.basename(upath.dirname(file.path))}
                        onPress={() => setPicked(list => list.includes(file.path) ? list.filter(path => path !== file.path) : [...list, file.path])} />)}
                </RowGroup>
            </SheetGroup>}
    </Sheet>
}
