import { useAnimeListTorrentProviderExtensions } from "@/api/hooks/extensions.hooks"
import { useGetMobileOfflineSnapshot, useMobileOfflineAction, useMobileOfflineSettings } from "@/api/hooks/mobile_offline.hooks"
import { offlineFailureText, offlineWaitingText } from "@/api/hooks/mobile_offline.helpers"
import { PhoneEmpty, PhoneSection, useTextZoom } from "@/components/shared/phone-cards"
import { Notice, RowGroup } from "@/components/shared/phone-kit"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { Button } from "@/components/ui/button/button"
import { useCloseOnBack } from "@/components/ui/core/back-handler"
import { cn } from "@/components/ui/core/styling"
import { Dialog } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Muted, Text } from "@/components/ui/text/text"
import { appLanguageAtom, type Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { Paths } from "expo-file-system"
import { useIsFocused } from "expo-router"
import { useAtomValue } from "jotai"
import ArrowLeft from "lucide-react-native/icons/arrow-left"
import Check from "lucide-react-native/icons/check"
import Pause from "lucide-react-native/icons/pause"
import Play from "lucide-react-native/icons/play"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import Trash2 from "lucide-react-native/icons/trash"
import X from "lucide-react-native/icons/x"
import React from "react"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"
import {
    animeKey, canResume, clock, type DownloadFilter, episodeWord, filterGroups, formatSize, groupItems, isActive, nextEpisode, offlineColumns,
    type OfflineGroup, type OfflineItem, plainText, resumeAction, showsProgress, STARTED_MS, startedItems, stateLabel, totalBytes, watchedShare,
} from "../_lib/offline-library"
import { usePlayOffline } from "../_lib/use-offline"
import { Artwork, PlayMark, ProgressLine } from "./downloads-parts"
import { MangaDownloads } from "./manga-downloads"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { readingColumn } from "@/lib/tablet-ui"
import { TorrentDownloads } from "./torrent-downloads"

/*
 * The Downloads tab (web android-downloads/page.tsx + downloads-mobile.css, OfflineActivity.kt): episodes saved on the
 * phone by the Go server (backend/internal/mobileoffline), kept current by the "mobile-offline-updated" events.
 *   Overview: what loads (pause / resume / retry / remove), "Continue offline", the anime as cover cards (select and
 *   delete several), the "Wi-Fi only" switch and the storage.
 *   Anime (?anime=media-1): cover, facts, the next episode to play, the saved episodes (one column on phones, a grid
 *   from 600dp like OfflineActivity).
 *   Torrents (?kind=torrents): the app's torrent client (torrent-downloads.tsx).
 *   Manga (?kind=manga&manga=ID): chapters downloaded by the server (manga-downloads.tsx, 2.8).
 */

const PATH = "/android-downloads"
// below this the Go server starts no download (manager.go minFree)
const MIN_FREE = 256 * 1024 ** 2

export function DownloadsPhone({ kind, animeKey: selectedKey, mangaId = 0 }: {
    kind: "anime" | "torrents" | "manga",
    animeKey: string | null,
    /** the manga opened in the Manga tab (?kind=manga&manga=ID), 0 = its overview */
    mangaId?: number,
}) {
    const t = useTr()
    const { rail } = useTabletLayout()
    const router = useRouter()
    const focused = useIsFocused()
    const { data: torrentProviders } = useAnimeListTorrentProviderExtensions()
    // Torrents get a tab once the app can find them (a torrent provider is installed) or one is already open
    const showTorrents = kind === "torrents" || !!torrentProviders?.length
    // Manga only with manga turned on in the settings, like the old page (or when a link opens it)
    const mangaEnabled = !!useServerStatus()?.settings?.library?.enableManga
    const showManga = kind === "manga" || mangaEnabled

    const { data: snapshot, isLoading, isError, refetch } = useGetMobileOfflineSnapshot()
    const items = React.useMemo(() => snapshot?.items ?? [], [snapshot?.items])
    const groups = React.useMemo(() => groupItems(items), [items])
    const selected = selectedKey ? groups.find(group => group.key === selectedKey) : undefined

    const [selecting, setSelecting] = React.useState(false)
    const [picked, setPicked] = React.useState<Set<string>>(new Set())
    const [deletingAnime, setDeletingAnime] = React.useState<string[]>([])
    const [deleting, setDeleting] = React.useState<OfflineItem | null>(null)

    // Selection belongs to the anime overview; switching tab or opening an anime ends it
    const [selectionScope, setSelectionScope] = React.useState(`${kind}:${selectedKey}`)
    if (selectionScope !== `${kind}:${selectedKey}`) {
        setSelectionScope(`${kind}:${selectedKey}`)
        setSelecting(false)
        setPicked(new Set())
    }

    const endSelection = () => {
        setSelecting(false)
        setPicked(new Set())
    }
    // Android back: the dialogs close themselves; then the selection ends, then the anime goes back to the overview
    useCloseOnBack(focused && selecting, endSelection)
    useCloseOnBack(focused && !selecting && !!selectedKey, () => router.replace(PATH))

    const { mutate: runAction } = useMobileOfflineAction()
    const act = (item: OfflineItem, action: "pause" | "resume" | "retry" | "remove") => runAction({ id: item.id, action })
    const playOffline = usePlayOffline()

    const deleteAnime = (keys: string[]) => {
        groups.filter(group => keys.includes(group.key)).forEach(group => group.items.forEach(item => act(item, "remove")))
        setDeletingAnime([])
        endSelection()
        if (selectedKey && keys.includes(selectedKey)) router.replace(PATH)
    }

    const language = useAtomValue(appLanguageAtom)
    const size = (bytes: number) => formatSize(bytes, language)

    const overview = kind === "manga" ? !mangaId : !selectedKey
    const facts = kind === "anime" && snapshot
        ? `${groups.length} Anime · ${items.length} ${episodeWord(items.length, t)} · ${size(totalBytes(items))}`
        : kind === "torrents" ? t("Saved to your library folder", "In deinem Bibliotheksordner gespeichert") : t("Saved on this device", "Auf diesem Gerät gespeichert")

    let body: React.ReactNode
    if (kind === "torrents") body = <TorrentDownloads active={focused} />
    else if (kind === "manga") body = <MangaDownloads selectedId={mangaId} />
    else if (isError && !snapshot) body = <Notice text={t("Downloads could not be loaded.", "Downloads konnten nicht geladen werden.")}>
        <Button intent="text" onPress={() => void refetch()}>{t("Try again", "Erneut versuchen")}</Button>
    </Notice>
    else if (isLoading || !snapshot) body = <View className="items-center py-12">
        <ActivityIndicator color={colors.smTextMuted} accessibilityLabel={t("Loading your downloads …", "Deine Downloads werden geladen …")} />
    </View>
    else if (selectedKey) body = selected
        ? <AnimeDetail group={selected} size={size} onBack={() => router.replace(PATH)} onAction={act} onPlay={playOffline}
            onDelete={setDeleting} onDeleteAll={() => setDeletingAnime([selected.key])} />
        : <View className="gap-4">
            <BackRow label={t("Back to anime overview", "Zurück zur Anime-Übersicht")} onPress={() => router.replace(PATH)} />
            <PhoneEmpty title={t("No downloads are stored for this anime anymore.", "Für diesen Anime sind keine Downloads mehr gespeichert.")}>
                <Button intent="secondary" onPress={() => router.replace(PATH)}>{t("Back to anime overview", "Zur Anime-Übersicht")}</Button>
            </PhoneEmpty>
        </View>
    else body = <Overview items={items} groups={groups} waiting={snapshot.waiting} wifiOnly={snapshot.wifiOnly} size={size}
        selecting={selecting} picked={picked} setPicked={setPicked}
        onSelect={() => selecting ? endSelection() : setSelecting(true)} onDeletePicked={keys => setDeletingAnime(keys)}
        onOpen={key => router.push(`${PATH}?anime=${encodeURIComponent(key)}`)} onAction={act} onPlay={playOffline} onRemove={setDeleting}
        onSearch={() => router.push("/search")} />

    const deletingGroups = groups.filter(group => deletingAnime.includes(group.key))

    return <PhoneScreen title={overview ? t("Downloads", "Downloads") : undefined} subtitle={overview ? facts : undefined}>
        {/* tablet.css: the tabs keep 26rem instead of the full width (.mdl-tabs) */}
        {/* 2.0.32 drew the tabs 8dp closer under the facts line (downloads-mobile.css); r16 (Nick 10.11.): the same 24dp as every tab */}
        {overview && <Tabs className={cn(rail && "w-full max-w-[416px]")} value={kind} onValueChange={value => router.replace(value === "anime" ? PATH : `${PATH}?kind=${value}`)}
            items={[
                { value: "anime", label: "Anime" },
                ...(showManga ? [{ value: "manga", label: "Manga" }] : []),
                ...(showTorrents ? [{ value: "torrents", label: "Torrents" }] : []),
            ]} />}
        {/* r16 (Nick 10.11., not in 2.0.33): next to the rail the rows stop at the reading width, so a switch stays near its label */}
        {rail ? <View className="gap-6" style={readingColumn(rail)}>{body}</View> : body}

        <Dialog title={t("Delete anime from phone?", "Anime vom Handy löschen?")} open={deletingAnime.length > 0} onOpenChange={open => { if (!open) setDeletingAnime([]) }}
            description={t("All saved episodes and pending downloads of the selected anime will be removed.", "Alle gespeicherten Folgen und ausstehenden Downloads der gewählten Anime werden entfernt.")}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setDeletingAnime([])}>{t("Cancel", "Abbrechen")}</Button>
                <Button intent="danger" wrapperClassName="flex-1" onPress={() => deleteAnime(deletingAnime)}>{t("Delete anime", "Anime löschen")}</Button>
            </>}>
            <RowGroup>
                {deletingGroups.map(group => <View key={group.key} className="gap-0.5 bg-sm-surface-raised px-3.5 py-2.5">
                    <Text className="text-[15px] font-semibold">{group.items[0].title}</Text>
                    <Muted className="text-[13px]">{group.items.length} {episodeWord(group.items.length, t)} · {size(totalBytes(group.items))}</Muted>
                </View>)}
            </RowGroup>
        </Dialog>

        <Dialog title={t("Delete episode from phone?", "Folge vom Handy löschen?")} open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null) }}
            description={deleting ? `${deleting.title ?? ""} · ${t("Episode", "Folge")} ${deleting.episode} · ${size(deleting.bytes)}` : undefined}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setDeleting(null)}>{t("Cancel", "Abbrechen")}</Button>
                <Button intent="danger" wrapperClassName="flex-1" onPress={() => { if (deleting) act(deleting, "remove"); setDeleting(null) }}>{t("Delete", "Löschen")}</Button>
            </>} />
    </PhoneScreen>
}

function BackRow({ label, onPress }: { label: string, onPress: () => void }) {
    return <View className="-ml-2 min-h-14 flex-row items-center">
        <Button intent="icon" accessibilityLabel={label} onPress={onPress}><ArrowLeft size={22} color={colors.smText} /></Button>
    </View>
}

/** Pause, resume or retry of a download on its way. */
function ToggleButton({ item, onAction }: { item: OfflineItem, onAction: (item: OfflineItem, action: "pause" | "resume" | "retry") => void }) {
    const t = useTr()
    const resume = canResume(item)
    return <Button intent="icon" onPress={() => onAction(item, resume ? resumeAction(item) : "pause")}
        accessibilityLabel={resume
            ? item.status === "failed" ? t(`Retry episode ${item.episode}`, `Folge ${item.episode} erneut versuchen`) : t(`Resume episode ${item.episode}`, `Folge ${item.episode} fortsetzen`)
            : t(`Pause episode ${item.episode}`, `Folge ${item.episode} pausieren`)}>
        {resume ? <RefreshCw size={20} color={colors.smTextMuted} /> : <Pause size={20} color={colors.smTextMuted} />}
    </Button>
}

function pendingMeta(item: OfflineItem, t: Translate) {
    return `${stateLabel(item, t)}${showsProgress(item) ? ` · ${Math.round(item.progress)} %` : ""}`
}

function Overview({ items, groups, waiting, wifiOnly, size, selecting, picked, setPicked, onSelect, onDeletePicked, onOpen, onAction, onPlay, onRemove, onSearch }: {
    items: OfflineItem[]
    groups: OfflineGroup[]
    waiting: string
    wifiOnly: boolean
    size: (bytes: number) => string
    selecting: boolean
    picked: Set<string>
    setPicked: React.Dispatch<React.SetStateAction<Set<string>>>
    onSelect: () => void
    onDeletePicked: (keys: string[]) => void
    onOpen: (key: string) => void
    onAction: (item: OfflineItem, action: "pause" | "resume" | "retry" | "remove") => void
    onPlay: (item: OfflineItem) => void
    onRemove: (item: OfflineItem) => void
    onSearch: () => void
}) {
    const t = useTr()
    const zoom = useTextZoom()
    const [width, setWidth] = React.useState(0)
    const [filter, setFilter] = React.useState<DownloadFilter>("all")
    const active = items.filter(isActive)
    // once nothing is pending the chips disappear; the filter does not jump back to "Active" when the next one starts
    const view: DownloadFilter = active.length ? filter : "all"
    const filtered = filterGroups(groups, view)
    const started = startedItems(items)
    // anime deleted elsewhere drop out of the selection
    const chosen = [...picked].filter(key => groups.some(group => group.key === key))
    const counts = { all: groups.length, ready: filterGroups(groups, "ready").length, active: filterGroups(groups, "active").length }
    const waitingText = offlineWaitingText(waiting, t)
    // `.mdl-grid`: covers of at least 84dp × text zoom, 12dp apart (3 columns normally, 2 at 200 %)
    const gap = 12
    const columns = Math.max(1, Math.floor((width + gap) / (84 * zoom + gap)))
    const cardWidth = width ? (width - gap * (columns - 1)) / columns : 0
    const toggle = (key: string) => setPicked(previous => {
        const next = new Set(previous)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
    })

    return <>
        {active.length > 0 && <PhoneSection title={t("Downloading", "Wird geladen")} count={active.length}
            note={waiting === "wifi" ? `${waitingText}. ${t("Episode downloads continue on Wi-Fi.", "Die Folgen werden im WLAN weiter heruntergeladen.")}` : waitingText || undefined}>
            <RowGroup>
                {active.map(item => <View key={item.id} className="flex-row items-center bg-sm-surface-raised pr-1">
                    <Pressable accessibilityRole="button" onPress={() => onOpen(animeKey(item))}
                        className="min-h-[72px] min-w-0 flex-1 flex-row items-center gap-3.5 px-3 py-2.5 active:bg-sm-surface-control">
                        <Artwork asset={item.episodeImageAsset || item.bannerAsset || item.coverAsset} url={item.episodeImageUrl || item.bannerUrl || item.coverUrl}
                            className="aspect-video w-24 rounded-lg" iconSize={20} />
                        <View className="min-w-0 flex-1 gap-0.5">
                            <Text numberOfLines={1} className="text-xs text-sm-text-subtle">{item.title}</Text>
                            <Text className="text-[15px] font-semibold">{t("Episode", "Folge")} {item.episode}</Text>
                            {showsProgress(item) && <ProgressLine value={item.progress} label={t(`Episode ${item.episode} download`, `Download Folge ${item.episode}`)} />}
                            <Text className={cn("text-[13px]", item.status === "failed" ? "text-sm-danger" : "text-sm-text-muted")} style={{ fontVariant: ["tabular-nums"] }}>
                                {pendingMeta(item, t)}
                            </Text>
                            {item.status === "failed" && <Muted className="text-[13px]">{offlineFailureText(item.failure, t)}</Muted>}
                        </View>
                    </Pressable>
                    <ToggleButton item={item} onAction={onAction} />
                    <Button intent="icon" onPress={() => onRemove(item)} accessibilityLabel={t(`Remove episode ${item.episode}`, `Folge ${item.episode} entfernen`)}>
                        <X size={20} color={colors.smTextMuted} />
                    </Button>
                </View>)}
            </RowGroup>
        </PhoneSection>}

        {started.length > 0 && !selecting && <PhoneSection title={t("Continue offline", "Offline weiterschauen")}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4 grow-0" contentContainerClassName="gap-3 px-4">
                {started.map(item => {
                    const share = watchedShare(item)
                    return <Pressable key={item.id} accessibilityRole="button" onPress={() => onPlay(item)} className="w-64 gap-1 active:opacity-85"
                        accessibilityLabel={t(`${item.title}: resume episode ${item.episode} at ${clock(item.position)}`, `${item.title}: Folge ${item.episode} bei ${clock(item.position)} fortsetzen`)}>
                        <View className="mb-1 aspect-video overflow-hidden rounded-surface-sm">
                            <Artwork asset={item.episodeImageAsset || item.bannerAsset || item.coverAsset} url={item.episodeImageUrl || item.bannerUrl || item.coverUrl} className="absolute inset-0" />
                            <PlayMark size={44} />
                            {share !== undefined && <ProgressLine overlay value={share * 100} label={t("Watched", "Gesehen")} />}
                        </View>
                        <Text numberOfLines={1} className="text-[15px] font-semibold">{item.title}</Text>
                        <Muted className="text-[13px]">{t("Episode", "Folge")} {item.episode} · {t(`at ${clock(item.position)}`, `bei ${clock(item.position)}`)}</Muted>
                    </Pressable>
                })}
            </ScrollView>
        </PhoneSection>}

        <PhoneSection title={selecting ? t(`${chosen.length} anime selected`, `${chosen.length} Anime ausgewählt`) : t("Your anime", "Deine Anime")}
            action={groups.length > 0 ? <Button intent="text" onPress={onSelect}>{selecting ? t("Cancel", "Abbrechen") : t("Select", "Auswählen")}</Button> : undefined}>
            {selecting && <View className="flex-row flex-wrap gap-2">
                <Button intent="secondary" wrapperClassName="min-w-36 flex-1" onPress={() => setPicked(new Set(filtered.map(group => group.key)))}>{t("Select all", "Alle auswählen")}</Button>
                <Button intent="secondary" wrapperClassName="min-w-36 flex-1" labelClassName="text-sm-danger" disabled={!chosen.length} onPress={() => onDeletePicked(chosen)}>
                    {`${t("Delete selected", "Ausgewählte löschen")} (${chosen.length})`}
                </Button>
            </View>}
            {active.length > 0 && !selecting && <View className="flex-row flex-wrap gap-2" accessibilityLabel={t("Filter downloads", "Downloads filtern")}>
                {([["all", t("All", "Alle")], ["ready", t("Ready", "Bereit")], ["active", t("Active", "Aktiv")]] as const).map(([name, label]) => {
                    const on = view === name
                    return <Pressable key={name} accessibilityRole="togglebutton" accessibilityState={{ checked: on }} onPress={() => setFilter(name)}
                        className={cn("min-h-12 flex-row items-center gap-1.5 rounded-full px-4", on ? "bg-sm-accent-soft" : "bg-sm-surface-raised active:bg-sm-surface-control")}>
                        <Text className={cn("text-sm", on ? "font-semibold text-sm-accent" : "font-medium text-sm-text-muted")}>{label}</Text>
                        <Text className={cn("text-sm", on ? "text-sm-accent" : "text-sm-text-subtle")} style={{ fontVariant: ["tabular-nums"] }}>{counts[name]}</Text>
                    </Pressable>
                })}
            </View>}
            {filtered.length > 0
                ? <View onLayout={event => setWidth(event.nativeEvent.layout.width)} className="flex-row flex-wrap" style={{ columnGap: gap, rowGap: 16 }}>
                    {!!cardWidth && filtered.map(group => {
                        const item = group.items.find(entry => entry.coverAsset) ?? group.items[0]
                        const ready = group.items.filter(entry => entry.ready).length
                        const pending = group.items.length - ready
                        const isPicked = picked.has(group.key)
                        return <Pressable key={group.key} style={{ width: cardWidth }} className="gap-1 active:opacity-85"
                            accessibilityRole={selecting ? "checkbox" : "button"} accessibilityState={selecting ? { checked: isPicked } : undefined}
                            accessibilityLabel={t(`${item.title} – open downloaded episodes`, `${item.title} – heruntergeladene Folgen öffnen`)}
                            onPress={() => selecting ? toggle(group.key) : onOpen(group.key)}>
                            <View className={cn("mb-1 aspect-[2/3] overflow-hidden rounded-surface-sm", isPicked && "border-2 border-sm-accent")}>
                                <Artwork asset={item.coverAsset} url={item.coverUrl} className="absolute inset-0" iconSize={28} />
                                {selecting && <View className={cn("absolute right-1.5 top-1.5 h-7 w-7 items-center justify-center rounded-full",
                                    isPicked ? "bg-sm-accent-strong" : "border-2 border-white/70 bg-[rgba(12,12,14,0.78)]")}>
                                    {isPicked && <Check size={16} color="#ffffff" strokeWidth={3} />}
                                </View>}
                            </View>
                            <Text numberOfLines={2} className="text-[13px] font-medium leading-[18px]">{item.title}</Text>
                            <Text className="text-xs text-sm-text-subtle" style={{ fontVariant: ["tabular-nums"] }}>
                                {[ready ? `${ready} ${episodeWord(ready, t)}` : null, size(totalBytes(group.items))].filter(Boolean).join(" · ")}
                            </Text>
                            {pending > 0 && <Text className="text-xs text-sm-accent">{pending} {t("pending", "ausstehend")}</Text>}
                        </Pressable>
                    })}
                </View>
                : <PhoneEmpty title={items.length ? t("Nothing here right now", "Hier ist gerade alles erledigt") : t("Your offline library starts here", "Deine Offline-Bibliothek beginnt hier")}
                    text={items.length ? t("Pick another filter to see your anime.", "Wähle einen anderen Filter, um deine Anime zu sehen.")
                        : t("Download an episode on an anime page. Covers, info and episodes will show up here.", "Lade eine Folge auf einer Anime-Seite herunter. Cover, Infos und Folgen findest du anschließend hier.")}>
                    {/* `.mdl-secondary`: 1rem to the sides, --sm-radius-sm */}
                    {!items.length && <Button intent="secondary" className="rounded-[0.75rem] px-4" onPress={onSearch}>{t("Search anime", "Anime suchen")}</Button>}
                </PhoneEmpty>}
        </PhoneSection>

        {!selecting && <DownloadSettings wifiOnly={wifiOnly} usedBytes={totalBytes(items)} size={size} />}
    </>
}

function readFreeSpace(): number | null {
    try {
        return Paths.availableDiskSpace
    } catch {
        return null
    }
}

/** "Wi-Fi only" (old SeanimeAndroid get/setDownloadsWifiOnly, now in the Go queue) and the phone's storage. */
function DownloadSettings({ wifiOnly, usedBytes, size }: { wifiOnly: boolean, usedBytes: number, size: (bytes: number) => string }) {
    const t = useTr()
    const { rail } = useTabletLayout()
    const { mutate: saveSettings, isPending } = useMobileOfflineSettings()
    // free space of the phone's internal storage (expo-file-system Paths, a quick synchronous read), on every render:
    // each snapshot event re-renders the tab, so it follows the downloads
    const free = readFreeSpace()
    return <PhoneSection title={rail ? t("Downloads on this tablet", "Downloads auf diesem Tablet") : t("Downloads on this phone", "Downloads auf diesem Handy")}>
        <RowGroup>
            <SwitchRow label={t("Download on Wi-Fi only", "Nur über WLAN herunterladen")}
                description={t("On mobile data, episode downloads wait until you are on Wi-Fi.", "Mit mobilen Daten warten die Folgen-Downloads, bis du im WLAN bist.")}
                checked={wifiOnly} disabled={isPending} onCheckedChange={checked => saveSettings({ wifiOnly: checked })} />
            <View className="min-h-14 justify-center gap-0.5 bg-sm-surface-raised px-4 py-2.5">
                <Text className="text-[15px]">{t("Storage", "Speicher")}</Text>
                <Muted style={{ fontVariant: ["tabular-nums"] }}>
                    {[t(`${size(usedBytes)} used by downloads`, `${size(usedBytes)} durch Downloads belegt`), free !== null ? t(`${size(free)} free`, `${size(free)} frei`) : null].filter(Boolean).join(" · ")}
                </Muted>
                {free !== null && free < MIN_FREE && <Text className="text-[13px] text-sm-danger">
                    {t("Less than 256 MB free. Downloads start again once you free up storage.", "Weniger als 256 MB frei. Downloads starten erst wieder, wenn du Speicher freigibst.")}
                </Text>}
            </View>
        </RowGroup>
    </PhoneSection>
}

function AnimeDetail({ group, size, onBack, onAction, onPlay, onDelete, onDeleteAll }: {
    group: OfflineGroup
    size: (bytes: number) => string
    onBack: () => void
    onAction: (item: OfflineItem, action: "pause" | "resume" | "retry" | "remove") => void
    onPlay: (item: OfflineItem) => void
    onDelete: (item: OfflineItem) => void
    onDeleteAll: () => void
}) {
    const t = useTr()
    const [width, setWidth] = React.useState(0)
    const [about, setAbout] = React.useState(false)
    const items = group.items
    const media = items.find(item => item.coverAsset) ?? items[0]
    const next = nextEpisode(items)
    const saved = items.filter(item => item.ready).length
    const description = plainText(media.description)
    const facts = [media.year, media.format, media.duration ? `${media.duration} ${t("min", "Min.")}` : null, media.score ? `★ ${media.score / 10}` : null].filter(Boolean).join(" · ")
    // OfflineActivity.kt: one column on phones, a grid from 600dp (tablets, landscape foldables)
    const columns = offlineColumns(width)
    const gap = 12
    const cellWidth = width ? (width - gap * (columns - 1)) / columns : 0

    return <>
        <BackRow label={t("Back to anime overview", "Zurück zur Anime-Übersicht")} onPress={onBack} />
        <View className="gap-4">
            <View className="flex-row flex-wrap items-end gap-4">
                <Artwork asset={media.coverAsset} url={media.coverUrl} className="h-[124px] w-[88px] rounded-surface-sm" iconSize={28} />
                <View className="min-w-40 flex-1 gap-1">
                    <Text accessibilityRole="header" numberOfLines={4} className="text-[22px] font-bold leading-7 tracking-[-0.44px]">{media.title}</Text>
                    {!!facts && <Muted className="text-[13px]">{facts}</Muted>}
                    {!!media.genres?.length && <Muted className="text-[13px]">{media.genres.slice(0, 4).join(" · ")}</Muted>}
                </View>
            </View>
            <View className="min-h-12 flex-row flex-wrap items-center justify-between gap-x-3 border-y border-sm-line py-2.5" style={{ alignContent: "center" }}>
                <View className="flex-row items-center gap-1.5">
                    <Check size={16} color={colors.smAccent} />
                    <Text className="text-sm font-semibold">{saved} {saved === 1 ? t("episode saved", "Folge gespeichert") : t("episodes saved", "Folgen gespeichert")}</Text>
                </View>
                <Muted className="text-sm" style={{ fontVariant: ["tabular-nums"] }}>{size(totalBytes(items))}</Muted>
            </View>
            {next && <Button size="lg" leftIcon={<Play size={18} color="#ffffff" fill="#ffffff" />} onPress={() => onPlay(next)}>
                {next.position >= STARTED_MS ? t(`Resume episode ${next.episode} at ${clock(next.position)}`, `Folge ${next.episode} bei ${clock(next.position)} fortsetzen`)
                    : t(`Watch episode ${next.episode}`, `Folge ${next.episode} ansehen`)}
            </Button>}
            {!!description && <Pressable accessibilityRole="button" accessibilityState={{ expanded: about }} onPress={() => setAbout(open => !open)} className="gap-2 py-1">
                <Text className="text-[15px] font-semibold">{t("About this anime", "Über den Anime")}</Text>
                <Muted numberOfLines={about ? undefined : 3} className="leading-[21px]">{description}</Muted>
            </Pressable>}
        </View>

        <PhoneSection title={t("Saved episodes", "Gespeicherte Folgen")} count={items.length}>
            <View onLayout={event => setWidth(event.nativeEvent.layout.width)} className="flex-row flex-wrap" style={{ columnGap: gap }}>
                {!!cellWidth && items.map(item => <EpisodeRow key={item.id} item={item} width={cellWidth} size={size} onAction={onAction} onPlay={onPlay} onDelete={onDelete} />)}
            </View>
            <Button intent="text" className="self-start" labelClassName="text-sm-danger" leftIcon={<Trash2 size={18} color={colors.smDanger} />} onPress={onDeleteAll}>
                {t("Delete anime", "Anime löschen")}
            </Button>
        </PhoneSection>
    </>
}

function EpisodeRow({ item, width, size, onAction, onPlay, onDelete }: {
    item: OfflineItem
    width: number
    size: (bytes: number) => string
    onAction: (item: OfflineItem, action: "pause" | "resume" | "retry" | "remove") => void
    onPlay: (item: OfflineItem) => void
    onDelete: (item: OfflineItem) => void
}) {
    const t = useTr()
    const share = watchedShare(item)
    const meta = item.ready
        ? [item.position >= STARTED_MS ? t(`at ${clock(item.position)}`, `bei ${clock(item.position)}`) : null, item.duration ? `${item.duration} ${t("min", "Min.")}` : null, size(item.bytes)].filter(Boolean).join(" · ")
        : pendingMeta(item, t)
    return <View style={{ width }} className="flex-row items-center border-b border-sm-line">
        <Pressable accessibilityRole="button" disabled={!item.ready} onPress={() => onPlay(item)}
            accessibilityLabel={item.ready ? t(`Play episode ${item.episode}`, `Folge ${item.episode} abspielen`) : `${t("Episode", "Folge")} ${item.episode}`}
            className="min-h-[72px] min-w-0 flex-1 flex-row items-center gap-3.5 px-1 py-2.5 active:bg-sm-surface-raised">
            <View className="aspect-video w-24 overflow-hidden rounded-lg">
                <Artwork asset={item.episodeImageAsset || item.bannerAsset} url={item.episodeImageUrl || item.bannerUrl} className="absolute inset-0" iconSize={20} />
                {item.ready && <PlayMark />}
                {share !== undefined && item.position >= STARTED_MS && <ProgressLine overlay value={share * 100} label={t("Watched", "Gesehen")} />}
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={1} className="text-xs text-sm-text-subtle">{t("Episode", "Folge")} {item.episode}</Text>
                <Text numberOfLines={2} className={cn("text-[15px] font-semibold leading-5", !item.ready && "text-sm-text-muted")}>
                    {item.episodeTitle || `${t("Episode", "Folge")} ${item.episode}`}
                </Text>
                {showsProgress(item) && <ProgressLine value={item.progress} label={t(`Episode ${item.episode} download`, `Download Folge ${item.episode}`)} />}
                <Text className={cn("text-[13px]", item.status === "failed" ? "text-sm-danger" : "text-sm-text-muted")} style={{ fontVariant: ["tabular-nums"] }}>{meta}</Text>
                {item.status === "failed" && <Muted className="text-[13px]">{offlineFailureText(item.failure, t)}</Muted>}
            </View>
        </Pressable>
        {!item.ready && <ToggleButton item={item} onAction={onAction} />}
        <Button intent="icon" onPress={() => onDelete(item)} accessibilityLabel={t(`Delete episode ${item.episode}`, `Folge ${item.episode} löschen`)}>
            <Trash2 size={20} color={colors.smTextMuted} />
        </Button>
    </View>
}
