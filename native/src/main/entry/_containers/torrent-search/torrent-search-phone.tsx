import type { Anime_Entry, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { useDebridAddTorrents } from "@/api/hooks/debrid.hooks"
import { useTorrentClientDownload } from "@/api/hooks/torrent_client.hooks"
import { Choices, LoadingRows, Notice, PickRow, RowGroup, SearchField, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { EmptyState } from "@/components/ui/card/card"
import { swapIn } from "@/components/ui/core/animations"
import { cn } from "@/components/ui/core/styling"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { getAppLanguage, type Translate, useTr } from "@/lib/app-language"
import { MENU_ENTRIES } from "@/lib/nav/nav-items"
import { useRouter } from "@/lib/navigation"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useAutoPlaySelectedTorrent } from "@/main/_features/autoplay/autoplay.atoms"
import { IN_APP_PLAYER_READY } from "@/main/_features/player/player-availability"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useHandleStartDebridStream } from "@/main/entry/_containers/debrid-stream/_lib/handle-debrid-stream"
import { Torrent_SearchType, useHandleTorrentSearch } from "@/main/entry/_containers/torrent-search/_lib/handle-torrent-search"
import { useMeteredGuard } from "@/main/entry/_containers/torrent-search/_lib/metered-guard"
import {
    filterTorrents,
    LANGUAGE_SEARCH_WORD,
    sortTorrents,
    toggleProvider,
    type TorrentCodec,
    type TorrentLanguage,
    type TorrentSort,
    type TorrentSource,
} from "@/main/entry/_containers/torrent-search/_lib/torrent-filters"
import {
    __torrentSearchPhone_languagesAtom,
    __torrentSearchPhone_providersAtom,
    __torrentSearchPhone_sortAtom,
    canSmartSelect,
    decodeEntities,
    downloadError,
    episodeList,
    getDefaultDestination,
    RESOLUTIONS,
    shouldLookForBatches,
    SIZES,
    sizeLabel,
    streamKind,
    toggled,
    type TorrentSheetKind,
    torrentMeta,
} from "@/main/entry/_containers/torrent-search/_lib/torrent-search-phone"
import { __torrentSearch_selectionAtom, type TorrentSelectionType } from "@/main/entry/_containers/torrent-search/torrent-search.atoms"
import { useHandleStartTorrentStream } from "@/main/entry/_containers/torrent-stream/_lib/handle-torrent-stream"
import { useTorrentSearchSelectedStreamEpisode } from "@/main/entry/_containers/torrent-stream/torrent-stream.atoms"
import { useAtom } from "jotai"
import Check from "lucide-react-native/icons/check"
import React from "react"
import { Pressable, TextInput, View } from "react-native"
import Animated from "react-native-reanimated"

/*
 * The torrent sheet (torrent-search-phone.tsx + .css): one sheet to stream a torrent, stream it through debrid, or
 * download it with the app's torrent client. Providers searched together, search by episode or title, resolution, flags
 * (whole season, dual audio, seeders, 10-bit), languages, more filters (codec, source, size), then the results with their
 * own word search and sort. A download goes on to its own sheet (destination, debrid or client, only the missing episodes).
 *
 * Starting a stream needs the app's player: until it exists (IN_APP_PLAYER_READY, E3) the stream rows show the torrents
 * but cannot be tapped, like the episode rows. Links to Extensions (2.11) and Settings (2.12) show while their screens
 * are ready (MENU_ENTRIES.ready); "Choose a folder" opens the settings on Local library.
 */

export function TorrentSearchPhone({ entry }: { entry: Anime_Entry }) {
    const t = useTr()
    const [type, setType] = useAtom(__torrentSearch_selectionAtom)
    const kind = streamKind(type)
    const [downloading, setDownloading] = React.useState<HibikeTorrent_AnimeTorrent[] | null>(null)
    // The torrents picked for a download; they stay picked when the download sheet goes back to the search
    const [picked, setPicked] = React.useState<HibikeTorrent_AnimeTorrent[]>([])
    const close = () => {
        setDownloading(null)
        setPicked([])
        setType(undefined)
    }
    const title = kind === "download" ? t("Download a torrent", "Torrent herunterladen")
        : kind === "debrid" ? t("Stream with debrid", "Mit Debrid streamen")
            : t("Stream a torrent", "Torrent streamen")
    const footer = kind === "download" && picked.length > 0
        ? <Button size="lg" wrapperClassName="flex-1" onPress={() => setDownloading(picked)}>
            {picked.length === 1 ? t("Continue", "Weiter") : t(`Continue with ${picked.length}`, `Weiter mit ${picked.length}`)}
        </Button>
        : undefined

    return <>
        {/* Stays open under the download sheet: closing it unmounted the body, so Back from the download sheet found the
            search reset (episode mode, whole season, the default filters) while the picked torrents were still picked */}
        <Sheet title={title} open={!!kind} onOpenChange={open => !open && close()} footer={footer}>
            {!!kind && <TorrentSearchBody entry={entry} type={type!} kind={kind} t={t} onDone={close} picked={picked} setPicked={setPicked} />}
        </Sheet>
        <TorrentDownloadSheet entry={entry} torrents={downloading} t={t} onBack={() => setDownloading(null)} onDone={close} />
    </>
}

function TorrentSearchBody({ entry, type, kind, t, onDone, picked, setPicked }: {
    entry: Anime_Entry
    type: TorrentSelectionType
    kind: TorrentSheetKind
    t: Translate
    onDone: () => void
    picked: HibikeTorrent_AnimeTorrent[]
    setPicked: React.Dispatch<React.SetStateAction<HibikeTorrent_AnimeTorrent[]>>
}) {
    const serverStatus = useServerStatus()
    const router = useRouter()
    const { isTablet } = useTabletLayout()
    const downloadInfo = entry.downloadInfo
    const extensionsReady = MENU_ENTRIES.some(e => e.id === "extensions" && e.ready)
    const lookForBatches = React.useMemo(() => shouldLookForBatches(kind, downloadInfo, entry.media?.endDate),
        [kind, downloadInfo, entry.media?.endDate])

    const search = useHandleTorrentSearch({
        isAdult: false,
        hasEpisodesToDownload: !!downloadInfo?.episodesToDownload?.length,
        shouldLookForBatches: lookForBatches,
        downloadInfo,
        entry,
        type,
    })
    const {
        warnings, providerExtensions, selectedProviderExtension, selectedProviderExtensionId, setSelectedProviderExtensionId,
        setExtraProviderIds, setSearchAcrossProviders,
        globalFilter, setGlobalFilter, searchType, setSearchType, smartSearchBatch, setSmartSearchBatch, smartSearchEpisode,
        setSmartSearchEpisode, smartSearchResolution, setSmartSearchResolution, smartSearchBest, setSmartSearchBest,
        data, isLoading, isFetching, isError, autoRetrySeconds, refetch,
    } = search

    // Several providers are searched at once; the saved choice still installed, else the default provider alone
    const [savedProviders, setSavedProviders] = useAtom(__torrentSearchPhone_providersAtom)
    const providerKey = (providerExtensions ?? []).map(ext => ext.id).join(",")
    const providers = React.useMemo(() => {
        const installed = new Set(providerKey.split(","))
        const saved = savedProviders.filter(id => installed.has(id))
        return saved.length ? saved : selectedProviderExtensionId !== "none" ? [selectedProviderExtensionId] : []
    }, [savedProviders, providerKey, selectedProviderExtensionId])
    const providersKey = providers.join(",")
    React.useEffect(() => {
        if (!providers.length) return
        if (providers[0] !== selectedProviderExtensionId) setSelectedProviderExtensionId(providers[0])
        setExtraProviderIds(providers.slice(1))
        setSearchAcrossProviders(providers.length > 1)
        // the joined ids stand for the list: a new array with the same providers must not search again
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [providersKey])
    const providerName = (id?: string) => providerExtensions?.find(ext => ext.id === id)?.name ?? id ?? ""

    const [languages, setLanguages] = useAtom(__torrentSearchPhone_languagesAtom)
    const [batchOnly, setBatchOnly] = React.useState(smartSearchBatch)
    // A language word the next title search adds, e.g. " German"
    const titleSearchWord = React.useRef("")

    // Title search starts from the anime's title, episode search from nothing (as on the desktop)
    const titles = entry.media?.title
    React.useLayoutEffect(() => {
        if (searchType === Torrent_SearchType.SMART) setGlobalFilter("")
        else setGlobalFilter((titles?.romaji || titles?.english || titles?.userPreferred || "").replaceAll(":", "").replaceAll("-", "")
            + titleSearchWord.current)
        titleSearchWord.current = ""
    }, [searchType, titles, setGlobalFilter])

    const { torrentSearchStreamEpisode } = useTorrentSearchSelectedStreamEpisode()
    const { handleStreamSelection: startTorrentStream } = useHandleStartTorrentStream()
    const { handleStreamSelection: startDebridStream } = useHandleStartDebridStream()
    const { setAutoPlayTorrent } = useAutoPlaySelectedTorrent()
    const metered = useMeteredGuard(t)

    const settings = selectedProviderExtension?.settings
    const canSmart = !!settings?.canSmartSearch
    const smart = searchType === Torrent_SearchType.SMART
    const providerBatch = smart && !!settings?.smartSearchFilters?.includes("batch")
    // The main provider searches whole seasons itself when it can; otherwise the results are filtered here
    React.useEffect(() => setSmartSearchBatch(batchOnly && providerBatch), [batchOnly, providerBatch, setSmartSearchBatch])
    const [dualAudio, setDualAudio] = React.useState(false)
    const [seeded, setSeeded] = React.useState(false)
    const [tenBit, setTenBit] = React.useState(false)
    const [codecs, setCodecs] = React.useState<TorrentCodec[]>([])
    const [sources, setSources] = React.useState<TorrentSource[]>([])
    const [maxSize, setMaxSize] = React.useState(0)
    const [showMore, setShowMore] = React.useState(false)
    const [resultText, setResultText] = React.useState("")
    const [sort, setSort] = useAtom(__torrentSearchPhone_sortAtom)
    const flags = [
        { value: "batch", label: t("Whole season", "Ganze Staffel") },
        { value: "dual", label: "Dual Audio" },
        { value: "seeded", label: t("With seeders", "Mit Seedern") },
        { value: "tenbit", label: "10-Bit" },
        ...(smart && settings?.smartSearchFilters?.includes("bestReleases") ? [{ value: "best", label: t("Best releases", "Beste Releases") }] : []),
    ]
    const activeFlags = [batchOnly && "batch", dualAudio && "dual", seeded && "seeded", tenBit && "tenbit", smartSearchBest && "best"]
        .filter((flag): flag is string => !!flag)
    const toggleFlag = (value: string) => {
        if (value === "batch") setBatchOnly(!batchOnly)
        else if (value === "dual") setDualAudio(!dualAudio)
        else if (value === "seeded") setSeeded(!seeded)
        else if (value === "tenbit") setTenBit(!tenBit)
        else setSmartSearchBest(!smartSearchBest)
    }
    const languageChips: { value: TorrentLanguage, label: string }[] = [
        { value: "de", label: t("German", "Deutsch") },
        { value: "en", label: t("English", "Englisch") },
        { value: "fr", label: t("French", "Französisch") },
        { value: "es", label: t("Spanish", "Spanisch") },
        { value: "it", label: t("Italian", "Italienisch") },
        { value: "pt", label: t("Portuguese", "Portugiesisch") },
        { value: "ru", label: t("Russian", "Russisch") },
        { value: "ar", label: t("Arabic", "Arabisch") },
        { value: "zh", label: t("Chinese", "Chinesisch") },
        { value: "multi", label: "Multi-Sub" },
    ]
    const moreOn = codecs.length + sources.length + (maxSize ? 1 : 0)
    const sorts: { value: TorrentSort, label: string }[] = [
        { value: "best", label: t("Recommended", "Empfohlen") },
        { value: "seeders", label: t("Most seeders", "Meiste Seeder") },
        { value: "newest", label: t("Newest", "Neueste") },
        { value: "smallest", label: t("Smallest", "Kleinste") },
    ]
    const debridOn = !!serverStatus?.debridSettings?.enabled
    // Only the debrid stream uses the debrid cache; the built-in client and torrent streaming download from peers
    const cached = debridOn && kind === "debrid" ? data?.debridInstantAvailability ?? {} : {}

    const found = React.useMemo(() => {
        return smart ? (data?.previews ?? []).map(preview => preview.torrent).filter((item): item is HibikeTorrent_AnimeTorrent => !!item) : data?.torrents ?? []
    }, [data?.previews, data?.torrents, smart])
    const filters = { resolution: smartSearchResolution, batch: batchOnly, languages, dualAudio, seeded, tenBit, codecs, sources, maxSize, text: resultText }
    const torrents = sortTorrents(filterTorrents(found, filters, batchOnly && providerBatch), sort)
    const clearFilters = () => {
        setBatchOnly(false)
        setLanguages([])
        setDualAudio(false)
        setSeeded(false)
        setTenBit(false)
        setCodecs([])
        setSources([])
        setMaxSize(0)
        setResultText("")
        setSmartSearchResolution("")
    }

    // When a language finds nothing: multi-sub releases often hold it without naming it, and whole seasons are found by title
    const multiCount = torrents.length || !languages.length || languages.includes("multi") ? 0
        : filterTorrents(found, { ...filters, languages: ["multi"] }, batchOnly && providerBatch).length
    const searchWord = languages.map(language => LANGUAGE_SEARCH_WORD[language]).find(Boolean)
    const canSearchWithLanguage = !!searchWord && (smart || !globalFilter.toLowerCase().includes(searchWord.toLowerCase()))
    const searchWithLanguage = () => {
        if (!smart) return setGlobalFilter(`${globalFilter.trim()} ${searchWord}`)
        titleSearchWord.current = ` ${searchWord}`
        setSearchType(Torrent_SearchType.SIMPLE)
    }

    // Streams start in the app's player; until it exists a stream row cannot be chosen (E3)
    const canStream = IN_APP_PLAYER_READY
    function choose(torrent: HibikeTorrent_AnimeTorrent) {
        if (kind === "download") {
            setPicked(prev => prev.some(item => item.infoHash === torrent.infoHash) ? prev.filter(item => item.infoHash !== torrent.infoHash) : [...prev, torrent])
            return
        }
        if (!canStream) return
        const episode = torrentSearchStreamEpisode
        if (!episode?.aniDBEpisode) {
            toast.error(t("This episode has no episode data yet, so it can't be streamed.", "Für diese Folge fehlen noch Episodendaten, deshalb kann sie nicht gestreamt werden."))
            return
        }
        const aniDBEpisode = episode.aniDBEpisode
        const start = () => {
            setAutoPlayTorrent(torrent, entry)
            const common = { torrent, mediaId: entry.mediaId, episodeNumber: episode.episodeNumber, aniDBEpisode, batchEpisodeFiles: undefined }
            if (kind === "debrid") startDebridStream({ ...common, chosenFileId: "" })
            else startTorrentStream({ ...common, chosenFileIndex: undefined })
            onDone()
        }
        // Torrent streams load through the phone's own connection; debrid streams come from the service
        if (kind === "debrid") start()
        else void metered.guard(start)
    }
    const noEpisodeData = kind !== "download" && !!torrentSearchStreamEpisode && !torrentSearchStreamEpisode.aniDBEpisode

    const missing = downloadInfo?.episodesToDownload?.map(item => item.episodeNumber).sort((a, b) => a - b) ?? []
    const context = kind === "download"
        ? missing.length ? t(`Missing episodes: ${episodeList(missing)}`, `Fehlende Folgen: ${episodeList(missing)}`) : undefined
        : torrentSearchStreamEpisode ? t(`Episode ${torrentSearchStreamEpisode.episodeNumber}`, `Folge ${torrentSearchStreamEpisode.episodeNumber}`) : undefined
    const openExtensions = () => {
        onDone()
        router.push("/extensions")
    }
    const language = getAppLanguage()

    const resultsTitle = isFetching && !isLoading ? t("Results · updating", "Ergebnisse · wird aktualisiert")
        : torrents.length < found.length ? t(`Results · ${torrents.length} of ${found.length}`, `Ergebnisse · ${torrents.length} von ${found.length}`)
            : found.length ? t(`Results · ${found.length}`, `Ergebnisse · ${found.length}`) : t("Results", "Ergebnisse")

    return <>
        {/* without a provider 2.0.32 shows only the empty state, not the missing episodes */}
        {!!context && (providerExtensions === undefined || (providerExtensions?.length ?? 0) > 0) && <Text className="-mt-1 text-[15px] text-sm-text-muted">{context}</Text>}

        {!providerExtensions?.length && providerExtensions !== undefined ? <EmptyState title={t("No torrent provider", "Kein Torrent-Anbieter")}
            description={t("Torrents are found by provider extensions. Install one under Extensions.", "Torrents finden Anbieter-Erweiterungen. Installiere eine unter Erweiterungen.")}>
            {extensionsReady && <Button onPress={openExtensions}>{t("Open Extensions", "Erweiterungen öffnen")}</Button>}
        </EmptyState> : <>
            {/* `.tsp .ps-sheet-group`: .75rem between head, note and content */}
            {(providerExtensions?.length ?? 0) > 0 && <SheetGroup className={TSP_GROUP} title={t("Providers", "Anbieter")}
                intro={(providerExtensions?.length ?? 0) > 1
                    ? t("All chosen providers are searched at the same time.", "Alle gewählten Anbieter werden gleichzeitig durchsucht.")
                    : t("Add more torrent providers to search them all at once.", "Füge weitere Torrent-Anbieter hinzu, um alle gleichzeitig zu durchsuchen.")}
                action={extensionsReady ? <TextAction label={t("Add", "Hinzufügen")} onPress={openExtensions} /> : undefined}>
                <Choices label={t("Providers", "Anbieter")} showCheck chips={(providerExtensions ?? []).map(ext => ({ value: ext.id, label: ext.name }))}
                    selected={providers} onToggle={id => setSavedProviders(toggleProvider(providers, id))} />
            </SheetGroup>}

            <SheetGroup className={TSP_GROUP} title={t("Search", "Suche")}>
                {canSmart && <Tabs value={searchType} onValueChange={value => setSearchType(value as Torrent_SearchType)}
                    items={[{ value: Torrent_SearchType.SMART, label: t("Episode", "Folge") }, { value: Torrent_SearchType.SIMPLE, label: t("Title", "Titel") }]} />}
                {!smart && <SearchField value={globalFilter} onChangeText={setGlobalFilter} placeholder={t("Search torrents", "Torrents suchen")} />}
                {smart && kind === "download" && !batchOnly && <EpisodeField label={t("Episode", "Folge")} value={String(smartSearchEpisode)}
                    onChange={value => setSmartSearchEpisode(Number(value) || 1)} />}
                <Choices label={t("Resolution", "Auflösung")} chips={[{ value: "", label: t("Any", "Alle") }, ...RESOLUTIONS.map(value => ({ value, label: `${value}p` }))]}
                    selected={[smartSearchResolution]} onToggle={value => setSmartSearchResolution(value)} />
                <Choices label={t("Filters", "Filter")} showCheck chips={flags} selected={activeFlags} onToggle={toggleFlag} />
            </SheetGroup>

            <SheetGroup className={TSP_GROUP} title={t("Language", "Sprache")}
                intro={t("Audio or subtitles, as the release name says. Untagged releases count as English.",
                    "Ton oder Untertitel, wie im Release-Namen angegeben. Releases ohne Angabe zählen als Englisch.")}>
                <Choices label={t("Language", "Sprache")} showCheck chips={languageChips} selected={languages}
                    onToggle={value => setLanguages(toggled(languages, value as TorrentLanguage))} />
            </SheetGroup>

            <SheetGroup className={TSP_GROUP} title={t("More filters", "Weitere Filter")}
                action={<TextAction expanded={showMore} onPress={() => setShowMore(!showMore)}
                    label={showMore ? t("Hide", "Ausblenden") : moreOn ? t(`Show · ${moreOn} on`, `Anzeigen · ${moreOn} an`) : t("Show", "Anzeigen")} />}>
                {showMore && <>
                    <FilterField label="Codec">
                        <Choices label="Codec" showCheck selected={codecs}
                            chips={[{ value: "hevc", label: "HEVC (x265)" }, { value: "avc", label: "AVC (x264)" }, { value: "av1", label: "AV1" }]}
                            onToggle={value => setCodecs(toggled(codecs, value as TorrentCodec))} />
                    </FilterField>
                    <FilterField label={t("Source", "Quelle")}>
                        <Choices label={t("Source", "Quelle")} showCheck selected={sources}
                            chips={[{ value: "bluray", label: "Blu-ray" }, { value: "web", label: "WEB" }]}
                            onToggle={value => setSources(toggled(sources, value as TorrentSource))} />
                    </FilterField>
                    <FilterField label={t("Largest size", "Höchstens")}>
                        <Choices label={t("Largest size", "Höchstens")} selected={[String(maxSize)]}
                            chips={[{ value: "0", label: t("Any size", "Jede Größe") }, ...SIZES.map(bytes => ({ value: String(bytes), label: sizeLabel(bytes) }))]}
                            onToggle={value => setMaxSize(Number(value))} />
                    </FilterField>
                </>}
            </SheetGroup>

            {noEpisodeData && <Notice text={t("This episode has no episode data yet, so it can't be streamed.",
                "Für diese Folge fehlen noch Episodendaten, deshalb kann sie nicht gestreamt werden.")} />}

            {warnings.extensionDoesNotSupportAdult && <Notice text={t("This provider does not search adult titles.", "Dieser Anbieter sucht keine Titel für Erwachsene.")} />}

            {/* the note sits under the head (PhoneSheetGroup), above the results */}
            <SheetGroup className={TSP_GROUP} title={resultsTitle} intro={kind === "debrid" && debridOn ? t("Cached torrents start at once.", "Gecachte Torrents starten sofort.") : undefined}>
                {found.length > 0 && <>
                    <SearchField value={resultText} onChangeText={setResultText} placeholder={t("Search results: group, HEVC, -720p …", "In Treffern suchen: Gruppe, HEVC, -720p …")} />
                    <Choices label={t("Sort by", "Sortieren nach")} chips={sorts} selected={[sort]} onToggle={value => setSort(value as TorrentSort)} />
                </>}
                {isLoading ? <LoadingRows label={t("Searching torrents", "Torrents werden gesucht")} />
                    : isError ? <Notice text={t("The provider did not answer.", "Der Anbieter hat nicht geantwortet.")}>
                            <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => void refetch()} />
                        </Notice>
                        : torrents.length === 0 && found.length > 0 ? <EmptyState title={t("No torrents match the filters", "Kein Torrent passt zu den Filtern")}
                                description={t(`The filters hide ${found.length} results.`, `Die Filter blenden ${found.length} Treffer aus.`)
                                    + (multiCount > 0 ? t(` ${multiCount} multi-sub releases often hold more subtitle languages without naming them.`,
                                        ` ${multiCount} Multi-Sub-Releases enthalten oft weitere Untertitel-Sprachen, ohne sie zu nennen.`) : "")
                                    + (canSearchWithLanguage ? t(` Releases in a language are often only found with "${searchWord}" in the search.`,
                                        ` Releases in einer Sprache findet oft erst die Suche mit „${searchWord}“.`) : "")}>
                                {multiCount > 0 && <Button intent="secondary" onPress={() => setLanguages([...languages, "multi"])}>{t("Add Multi-Sub", "Multi-Sub dazunehmen")}</Button>}
                                {canSearchWithLanguage && <Button intent="secondary" onPress={searchWithLanguage}>{t(`Search with "${searchWord}"`, `Mit „${searchWord}“ suchen`)}</Button>}
                                <Button intent="secondary" onPress={clearFilters}>{t("Clear filters", "Filter zurücksetzen")}</Button>
                            </EmptyState>
                            : torrents.length === 0 ? <EmptyState title={t("No torrents found", "Keine Torrents gefunden")}
                                    description={autoRetrySeconds ? t(`Trying again in ${autoRetrySeconds} s.`, `Neuer Versuch in ${autoRetrySeconds} s.`)
                                        : smart ? t("Search by title finds more.", "Die Suche nach Titel findet mehr.") : undefined}>
                                    {smart && <Button intent="secondary" onPress={() => setSearchType(Torrent_SearchType.SIMPLE)}>{t("Search by title", "Nach Titel suchen")}</Button>}
                                </EmptyState>
                                // A new sort order rises in instead of the rows jumping to their new places in one frame
                                : <Animated.View key={sort} entering={swapIn(isTablet)} className="gap-0.5 overflow-hidden rounded-surface">
                                    {torrents.map(torrent => {
                                        const isCached = !!torrent.infoHash && !!cached[torrent.infoHash]
                                        const meta = torrentMeta(torrent, t, language, isCached, providers.length > 1 ? providerName(torrent.provider) : "")
                                        const name = decodeEntities(torrent.name)
                                        return kind === "download"
                                            ? <TorrentPick key={torrent.infoHash || torrent.link} name={name} meta={meta}
                                                checked={picked.some(item => item.infoHash === torrent.infoHash)} onPress={() => choose(torrent)} />
                                            : <TorrentRow key={torrent.infoHash || torrent.link} name={name} meta={meta} disabled={!canStream} onPress={() => choose(torrent)} />
                                    })}
                                </Animated.View>}
            </SheetGroup>
        </>}
        {metered.dialog}
    </>
}

/** torrent-search-phone.css `.tsp .ps-sheet-group { gap: .75rem }` (the plain sheet group has .625rem) */
const TSP_GROUP = "gap-3"

function FilterField({ label, children }: { label: string, children: React.ReactNode }) {
    return <View className="gap-1.5">
        <Text className="text-sm font-semibold">{label}</Text>
        {children}
    </View>
}

/** `.ps-field` with digits only: the episode searched for */
function EpisodeField({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) {
    return <View className="gap-1.5">
        <Text className="text-sm font-semibold">{label}</Text>
        <TextInput value={value} onChangeText={v => onChange(v.replace(/\D/g, ""))} keyboardType="number-pad" accessibilityLabel={label}
            className="min-h-[52px] rounded-surface bg-sm-surface-raised px-4 font-sans text-base text-sm-text" style={{ fontVariant: ["tabular-nums"] }} />
    </View>
}

/** `.tsp-row`: the release name (two lines) over its facts; a tap streams it */
function TorrentRow({ name, meta, disabled, onPress }: { name: string, meta: string, disabled?: boolean, onPress: () => void }) {
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} accessibilityLabel={`${name}, ${meta}`}
        onPress={onPress} className="min-h-14 gap-1 bg-sm-surface-raised px-4 py-3 active:bg-sm-surface-control">
        <Text numberOfLines={2} className="text-[15px] font-semibold leading-[20px]">{name}</Text>
        <Muted className="leading-[19px]">{meta}</Muted>
    </Pressable>
}

/** `.tsp .ps-pick`: a box on the left, then the release as in the stream rows; several can be picked for a download */
function TorrentPick({ name, meta, checked, onPress }: { name: string, meta: string, checked: boolean, onPress: () => void }) {
    return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={`${name}, ${meta}`} onPress={onPress}
        className="min-h-[52px] flex-row items-center gap-3.5 bg-sm-surface-raised px-4 py-2.5 active:bg-sm-surface-control">
        <View className={cn("h-[22px] w-[22px] items-center justify-center rounded-[6px]", checked ? "bg-sm-accent-strong" : "border-2 border-sm-text-subtle")}>
            {checked && <Check size={16} color="#ffffff" strokeWidth={3} />}
        </View>
        {/* `.ps-pick-text`: .125rem between name and facts (the stream row's `.tsp-row` keeps .25rem) */}
        <View className="min-w-0 flex-1 gap-0.5">
            <Text numberOfLines={2} className="text-[15px] font-semibold leading-[20px]">{name}</Text>
            <Muted className="leading-[19px]">{meta}</Muted>
        </View>
    </Pressable>
}

/** Destination and episode choice, then the download through the app's own torrent client (or the debrid service). */
function TorrentDownloadSheet({ entry, torrents: shown, t, onBack, onDone }: {
    entry: Anime_Entry
    torrents: HibikeTorrent_AnimeTorrent[] | null
    t: Translate
    onBack: () => void
    onDone: () => void
}) {
    const serverStatus = useServerStatus()
    const router = useRouter()
    const torrents = shown ?? []
    const library = serverStatus?.settings?.library
    const libraryPath = library?.libraryPath || library?.libraryPaths?.[0] || ""
    const destination = getDefaultDestination(entry, libraryPath)
    const missing = entry.downloadInfo?.episodesToDownload?.map(item => item.episodeNumber) ?? []
    const media = entry.media
    const smartSelect = canSmartSelect(torrents, media, missing)
    const [onlyMissing, setOnlyMissing] = React.useState(true)
    const debridOn = !!serverStatus?.debridSettings?.enabled && !!serverStatus?.debridSettings?.provider
    const [viaDebrid, setViaDebrid] = React.useState(false)
    const metered = useMeteredGuard(t)
    const settingsReady = MENU_ENTRIES.some(e => e.id === "settings" && e.ready)
    const language = getAppLanguage()
    const toDownloads = () => {
        onDone()
        router.push("/android-downloads?kind=torrents")
    }
    const { mutate, isPending } = useTorrentClientDownload(toDownloads,
        failure => toast.error(downloadError(String(failure.response?.data?.error ?? failure.message ?? ""), t)))
    const { mutate: addToDebrid, isPending: isAddingToDebrid } = useDebridAddTorrents(toDownloads)
    const debrid = debridOn && viaDebrid

    function start() {
        if (!torrents.length || !media || !destination) return
        // The debrid service downloads the torrent and the server fetches the finished files from it
        if (debrid) return addToDebrid({ torrents, destination, media })
        void metered.guard(() => mutate({
            torrents,
            destination,
            smartSelect: { enabled: smartSelect && onlyMissing, missingEpisodeNumbers: smartSelect && onlyMissing ? missing : [] },
            media,
        }))
    }

    return <Sheet title={t("Download", "Herunterladen")} open={!!shown} onOpenChange={open => !open && onBack()}
        footer={<>
            <Button intent="secondary" size="lg" wrapperClassName="flex-1" onPress={onBack}>{t("Back", "Zurück")}</Button>
            <Button size="lg" wrapperClassName="flex-[2]" disabled={!destination || isPending || isAddingToDebrid} loading={isPending || isAddingToDebrid}
                onPress={start}>{t("Start download", "Download starten")}</Button>
        </>}>
        <SheetGroup title={torrents.length === 1 ? t("Torrent", "Torrent") : t(`${torrents.length} torrents`, `${torrents.length} Torrents`)}>
            <RowGroup>
                {torrents.map(torrent => <View key={torrent.infoHash || torrent.link} className="min-h-14 gap-1 bg-sm-surface-raised px-4 py-3">
                    <Text numberOfLines={2} className="text-[15px] font-semibold leading-[20px]">{decodeEntities(torrent.name)}</Text>
                    <Muted className="leading-[19px]">{torrentMeta(torrent, t, language, false)}</Muted>
                </View>)}
            </RowGroup>
        </SheetGroup>
        {debridOn && <SheetGroup title={t("Download with", "Laden über")}>
            <RowGroup>
                <PickRow radio checked={!viaDebrid} onPress={() => setViaDebrid(false)}
                    label={t("Torrent client", "Torrent-Client")} note={t("Loads from other people's devices", "Lädt von den Geräten anderer Nutzer")} />
                <PickRow radio checked={viaDebrid} onPress={() => setViaDebrid(true)}
                    label={t("Debrid service", "Debrid-Dienst")} note={t("Faster, also without seeders", "Schneller, auch ohne Seeder")} />
            </RowGroup>
        </SheetGroup>}
        {smartSelect && !debrid && <SheetGroup title={t("Episodes", "Folgen")}>
            <RowGroup>
                <PickRow radio checked={onlyMissing} onPress={() => setOnlyMissing(true)}
                    label={t("Only the episodes you are missing", "Nur fehlende Folgen")} note={episodeList(missing.slice().sort((a, b) => a - b))} />
                <PickRow radio checked={!onlyMissing} onPress={() => setOnlyMissing(false)} label={t("Everything in the torrent", "Alles im Torrent")} />
            </RowGroup>
        </SheetGroup>}
        <SheetGroup title={t("Saved to", "Speicherort")}
            note={debrid
                ? t("The debrid service downloads the torrent, then the files are saved here. Progress is under Downloads → Torrents.",
                    "Der Debrid-Dienst lädt den Torrent, danach werden die Dateien hier gespeichert. Den Fortschritt siehst du unter Downloads → Torrents.")
                : t("Torrents download over your connection. On mobile data the app asks first. Progress is under Downloads → Torrents.",
                    "Torrents laden über deine Verbindung. Im Mobilnetz fragt die App vorher. Den Fortschritt siehst du unter Downloads → Torrents.")}>
            {destination
                ? <View className="rounded-surface-sm bg-sm-surface-raised px-4 py-3"><Text className="text-sm leading-[20px]">{destination}</Text></View>
                : <Notice text={t("Pick a library folder first. Downloads are saved there and show up on the anime page.",
                    "Wähle zuerst einen Bibliotheksordner. Downloads landen dort und erscheinen auf der Anime-Seite.")}>
                    {settingsReady && <TextAction label={t("Choose a folder", "Ordner wählen")} onPress={() => {
                        onDone()
                        router.push("/settings?tab=library")
                    }} />}
                </Notice>}
        </SheetGroup>
        {metered.dialog}
    </Sheet>
}
