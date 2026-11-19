import type { Anime_Entry, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { useGetAutoSelectProfile } from "@/api/hooks/auto_select.hooks"
import { useDebridAddTorrents } from "@/api/hooks/debrid.hooks"
import { useTorrentClientDownload, useTorrentFileList } from "@/api/hooks/torrent_client.hooks"
import { ChipRow } from "@/components/shared/phone-cards"
import { Choices, LoadingRows, Notice, PickRow, RowGroup, SearchField, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { EmptyState } from "@/components/ui/card/card"
import { swapIn } from "@/components/ui/core/animations"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import type { AutoSelectProfile } from "@/core/torrent/autoselect"
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
    chosenBytes,
    defaultFileChoice,
    fileChoiceRequest,
    fileRowsOf,
    spaceStateOf,
    wantsFileChoice,
} from "@/main/entry/_containers/torrent-search/_lib/file-choice"
import { bestMatchKey, sizeText, torrentFacts, torrentKey } from "@/main/entry/_containers/torrent-search/_lib/torrent-facts"
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
    __torrentSearchPhone_filtersOpenAtom,
    __torrentSearchPhone_languagesAtom,
    __torrentSearchPhone_providersAtom,
    __torrentSearchPhone_sortAtom,
    activeFilterLabels,
    canSmartSelect,
    downloadError,
    episodeList,
    filtersLine,
    getDefaultDestination,
    RESOLUTIONS,
    shouldLookForBatches,
    SIZES,
    sizeLabel,
    streamKind,
    toggled,
    type TorrentSheetKind,
} from "@/main/entry/_containers/torrent-search/_lib/torrent-search-phone"
import { useTorrentReads } from "@/main/entry/_containers/torrent-search/_lib/use-torrent-reads"
import { TorrentCard } from "@/main/entry/_containers/torrent-search/torrent-card"
import { TorrentFileChoice } from "@/main/entry/_containers/torrent-search/torrent-file-choice"
import { __torrentSearch_selectionAtom, type TorrentSelectionType } from "@/main/entry/_containers/torrent-search/torrent-search.atoms"
import { useHandleStartTorrentStream } from "@/main/entry/_containers/torrent-stream/_lib/handle-torrent-stream"
import { useTorrentSearchSelectedStreamEpisode } from "@/main/entry/_containers/torrent-stream/torrent-stream.atoms"
import { Paths } from "expo-file-system"
import { useAtom } from "jotai"
import React from "react"
import { TextInput, View } from "react-native"
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
    const [filtersOpen, setFiltersOpen] = useAtom(__torrentSearchPhone_filtersOpenAtom)
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
    const codecChips = [{ value: "hevc", label: "HEVC (x265)" }, { value: "avc", label: "AVC (x264)" }, { value: "av1", label: "AV1" }]
    const sourceChips = [{ value: "bluray", label: "Blu-ray" }, { value: "web", label: "WEB" }]
    // what the closed filters' head counts and its line names
    const filterLabels = activeFilterLabels({ resolution: smartSearchResolution, flags: activeFlags, languages, codecs, sources, maxSize }, (what, value) => {
        const chips: { value: string, label: string }[] = what === "flags" ? flags : what === "languages" ? languageChips : what === "codecs" ? codecChips : what === "sources" ? sourceChips : []
        if (what === "resolution") return `${value}p`
        if (what === "maxSize") return sizeLabel(Number(value))
        return chips.find(chip => chip.value === value)?.label ?? value
    })
    const searched = smart
        ? kind === "download" && !batchOnly ? t(`Episode ${smartSearchEpisode}`, `Folge ${smartSearchEpisode}`) : ""
        : globalFilter.trim() ? t(`Title "${globalFilter.trim()}"`, `Titel „${globalFilter.trim()}“`) : ""
    const sorts: { value: TorrentSort, label: string }[] = [
        { value: "best", label: t("Recommended", "Empfohlen") },
        { value: "seeders", label: t("Most seeders", "Meiste Seeder") },
        { value: "newest", label: t("Newest", "Neueste") },
        { value: "smallest", label: t("Smallest", "Kleinste") },
        { value: "largest", label: t("Largest", "Größte") },
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
    // One function for every card, so a card only draws again when its own torrent, reading or state changes
    const chooseRef = React.useRef(choose)
    React.useLayoutEffect(() => {
        chooseRef.current = choose
    })
    const onChoose = React.useCallback((torrent: HibikeTorrent_AnimeTorrent) => chooseRef.current(torrent), [])

    // What the names say (group, resolution, codec …): the search's own readings, the rest read a few per turn
    const readOf = useTorrentReads(found, data?.torrentMetadata)
    // "Best match": the one auto-select would take from the shown results, with the user's profile and resolution
    const { data: profile } = useGetAutoSelectProfile()
    const preferredResolution = serverStatus?.torrentstreamSettings?.preferredResolution ?? ""
    const wantedEpisode = kind === "download" ? (smart && !batchOnly ? smartSearchEpisode : 0) : torrentSearchStreamEpisode?.episodeNumber ?? 0
    const startYear = entry.media?.startDate?.year ?? 0
    const format = entry.media?.format ?? ""
    const [best, setBest] = React.useState("")
    const shownKey = torrents.map(torrentKey).join("\n")
    React.useEffect(() => {
        // after the frame that shows the cards: the rule reads every name once more
        const timer = setTimeout(() => setBest(profile && shownKey
            ? bestMatchKey(torrents, profile as unknown as AutoSelectProfile, wantedEpisode, preferredResolution, startYear, format) : ""), 0)
        return () => clearTimeout(timer)
        // the joined keys stand for the shown list: a new array of the same torrents must not choose again
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shownKey, profile, wantedEpisode, preferredResolution, startYear, format])

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
            {/*
              * 4.2.0 (A2): the search and its filters fold away above the results (closed at first, kept open or closed
              * for the next search), so the first screen shows cards. Closed, a line says what is searched and filtered.
              * `.tsp .ps-sheet-group`: .75rem between head, note and content.
              */}
            <SheetGroup className={TSP_GROUP} title={filterLabels.length ? t(`Filters · ${filterLabels.length}`, `Filter · ${filterLabels.length}`) : t("Filters", "Filter")}
                action={<TextAction expanded={filtersOpen} onPress={() => setFiltersOpen(!filtersOpen)}
                    accessibilityLabel={filtersOpen ? t("Hide filters", "Filter ausblenden") : t("Show filters", "Filter anzeigen")}
                    label={filtersOpen ? t("Hide", "Ausblenden") : t("Show", "Anzeigen")} />}>
                {!filtersOpen && <Text numberOfLines={2} className="-mt-1.5 text-[13px] leading-[19px] text-sm-text-muted">
                    {filtersLine(searched, filterLabels) || t("All results, no filter on.", "Alle Treffer, kein Filter an.")}
                </Text>}
                {filtersOpen && <>
                    {(providerExtensions?.length ?? 0) > 0 && <FilterField label={t("Providers", "Anbieter")}
                        note={(providerExtensions?.length ?? 0) > 1
                            ? t("All chosen providers are searched at the same time.", "Alle gewählten Anbieter werden gleichzeitig durchsucht.")
                            : t("Add more torrent providers to search them all at once.", "Füge weitere Torrent-Anbieter hinzu, um alle gleichzeitig zu durchsuchen.")}
                        action={extensionsReady ? <TextAction label={t("Add", "Hinzufügen")} onPress={openExtensions} /> : undefined}>
                        <Choices label={t("Providers", "Anbieter")} showCheck chips={(providerExtensions ?? []).map(ext => ({ value: ext.id, label: ext.name }))}
                            selected={providers} onToggle={id => setSavedProviders(toggleProvider(providers, id))} />
                    </FilterField>}
                    <FilterField label={t("Search", "Suche")}>
                        {canSmart && <Tabs value={searchType} onValueChange={value => setSearchType(value as Torrent_SearchType)}
                            items={[{ value: Torrent_SearchType.SMART, label: t("Episode", "Folge") }, { value: Torrent_SearchType.SIMPLE, label: t("Title", "Titel") }]} />}
                        {!smart && <SearchField value={globalFilter} onChangeText={setGlobalFilter} placeholder={t("Search torrents", "Torrents suchen")} />}
                        {smart && kind === "download" && !batchOnly && <EpisodeField label={t("Episode", "Folge")} value={String(smartSearchEpisode)}
                            onChange={value => setSmartSearchEpisode(Number(value) || 1)} />}
                    </FilterField>
                    <FilterField label={t("Resolution", "Auflösung")}>
                        <Choices label={t("Resolution", "Auflösung")} chips={[{ value: "", label: t("Any", "Alle") }, ...RESOLUTIONS.map(value => ({ value, label: `${value}p` }))]}
                            selected={[smartSearchResolution]} onToggle={value => setSmartSearchResolution(value)} />
                    </FilterField>
                    <FilterField label={t("Show only", "Nur zeigen")}>
                        <Choices label={t("Show only", "Nur zeigen")} showCheck chips={flags} selected={activeFlags} onToggle={toggleFlag} />
                    </FilterField>
                    <FilterField label={t("Language", "Sprache")}
                        note={t("Audio or subtitles, as the release name says. Untagged releases count as English.",
                            "Ton oder Untertitel, wie im Release-Namen angegeben. Releases ohne Angabe zählen als Englisch.")}>
                        <Choices label={t("Language", "Sprache")} showCheck chips={languageChips} selected={languages}
                            onToggle={value => setLanguages(toggled(languages, value as TorrentLanguage))} />
                    </FilterField>
                    {/* the rarer ones stay folded inside the open filters, as before 4.2.0 */}
                    <FilterField label={t("More filters", "Weitere Filter")}
                        action={<TextAction expanded={showMore} onPress={() => setShowMore(!showMore)}
                            label={showMore ? t("Hide", "Ausblenden") : moreOn ? t(`Show · ${moreOn} on`, `Anzeigen · ${moreOn} an`) : t("Show", "Anzeigen")} />}>
                        {showMore && <>
                            <FilterField label="Codec">
                                <Choices label="Codec" showCheck selected={codecs} chips={codecChips}
                                    onToggle={value => setCodecs(toggled(codecs, value as TorrentCodec))} />
                            </FilterField>
                            <FilterField label={t("Source", "Quelle")}>
                                <Choices label={t("Source", "Quelle")} showCheck selected={sources} chips={sourceChips}
                                    onToggle={value => setSources(toggled(sources, value as TorrentSource))} />
                            </FilterField>
                            <FilterField label={t("Largest size", "Höchstens")}>
                                <Choices label={t("Largest size", "Höchstens")} selected={[String(maxSize)]}
                                    chips={[{ value: "0", label: t("Any size", "Jede Größe") }, ...SIZES.map(bytes => ({ value: String(bytes), label: sizeLabel(bytes) }))]}
                                    onToggle={value => setMaxSize(Number(value))} />
                            </FilterField>
                        </>}
                    </FilterField>
                    {filterLabels.length > 0 && <View className="flex-row">
                        <TextAction label={t("Clear filters", "Filter zurücksetzen")} onPress={clearFilters} />
                    </View>}
                </>}
            </SheetGroup>

            {noEpisodeData && <Notice text={t("This episode has no episode data yet, so it can't be streamed.",
                "Für diese Folge fehlen noch Episodendaten, deshalb kann sie nicht gestreamt werden.")} />}

            {warnings.extensionDoesNotSupportAdult && <Notice text={t("This provider does not search adult titles.", "Dieser Anbieter sucht keine Titel für Erwachsene.")} />}

            {/* the note sits under the head (PhoneSheetGroup), above the results */}
            <SheetGroup className={TSP_GROUP} title={resultsTitle} intro={kind === "debrid" && debridOn ? t("Cached torrents start at once.", "Gecachte Torrents starten sofort.") : undefined}>
                {found.length > 0 && <>
                    <SearchField value={resultText} onChangeText={setResultText} placeholder={t("Search results: group, HEVC, -720p …", "In Treffern suchen: Gruppe, HEVC, -720p …")} />
                    {/* one row that scrolls sideways: five sort chips took two rows before the first card */}
                    <ChipRow label={t("Sort by", "Sortieren nach")} chips={sorts} selected={[sort]} onSelect={value => setSort(value as TorrentSort)} />
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
                                    {torrents.map(torrent => <TorrentCard key={torrentKey(torrent)} torrent={torrent} parsed={readOf(torrent)} t={t} language={language}
                                        mode={kind === "download" ? "pick" : "stream"} provider={providerName(torrent.provider)} best={best === torrentKey(torrent)}
                                        cached={!!torrent.infoHash && !!cached[torrent.infoHash]} checked={kind === "download" && picked.some(item => item.infoHash === torrent.infoHash)}
                                        disabled={kind !== "download" && !canStream} onChoose={onChoose} />)}
                                </Animated.View>}
            </SheetGroup>
        </>}
        {metered.dialog}
    </>
}

/** torrent-search-phone.css `.tsp .ps-sheet-group { gap: .75rem }` (the plain sheet group has .625rem) */
const TSP_GROUP = "gap-3"

/** One filter inside the open filters: its name (an action beside it), a note, the choices */
function FilterField({ label, note, action, children }: { label: string, note?: string, action?: React.ReactNode, children: React.ReactNode }) {
    return <View className="gap-1.5">
        {action
            ? <View className="min-h-6 flex-row items-center justify-between gap-3">
                <Text className="min-w-0 flex-1 text-sm font-semibold">{label}</Text>
                <View className="-my-3 -mr-2">{action}</View>
            </View>
            : <Text className="text-sm font-semibold">{label}</Text>}
        {!!note && <Text className="text-[13px] leading-[19px] text-sm-text-muted">{note}</Text>}
        {children}
    </View>
}

/** The phone's free storage (expo-file-system, a quick synchronous read, as the Downloads tab shows it); null: not known */
function readFreeSpace(): number | null {
    try {
        return Paths.availableDiskSpace
    }
    catch {
        return null
    }
}

/** `.ps-field` with digits only: the episode searched for */
function EpisodeField({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) {
    return <View className="gap-1.5">
        <Text className="text-sm font-semibold">{label}</Text>
        <TextInput value={value} onChangeText={v => onChange(v.replace(/\D/g, ""))} keyboardType="number-pad" accessibilityLabel={label}
            className="min-h-[52px] rounded-surface bg-sm-surface-raised px-4 font-sans text-base text-sm-text" style={{ fontVariant: ["tabular-nums"] }} />
    </View>
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
    // a debrid download into a folder needs the server (phase 7f): without it only the torrent client downloads
    const debridOn = false
    const [viaDebrid, setViaDebrid] = React.useState(false)
    const metered = useMeteredGuard(t)
    const settingsReady = MENU_ENTRIES.some(e => e.id === "settings" && e.ready)
    const language = getAppLanguage()
    const readOf = useTorrentReads(torrents)
    // 4.2.0 (A2): one batch torrent lists its files to choose from (the stream's file chooser's list)
    const only = torrents.length === 1 ? torrents[0] : undefined
    const onlyRead = only ? readOf(only) : undefined
    const batchByName = React.useMemo(() => !!only && torrentFacts(only, onlyRead, t, language).batch, [only, onlyRead, t, language])
    const choosing = !viaDebrid && wantsFileChoice(torrents, batchByName)
    const fileList = useTorrentFileList(only, !!shown && choosing)
    const rows = React.useMemo(() => fileRowsOf(fileList.data), [fileList.data])
    // the choice a list starts from (the missing episodes, else every file); a new list starts again from its own
    const missingKey = missing.join(",")
    const startChoice = React.useMemo(() => rows.length ? defaultFileChoice(rows, missingKey ? missingKey.split(",").map(Number) : [], smartSelect) : null,
        [rows, missingKey, smartSelect])
    const [picks, setPicks] = React.useState<{ from: Set<number> | null, chosen: Set<number> } | null>(null)
    const chosen = picks && picks.from === startChoice ? picks.chosen : startChoice
    const setChosen = (next: Set<number>) => setPicks({ from: startChoice, chosen: next })
    const listWaiting = choosing && fileList.isLoading
    const listed = choosing && !!chosen && rows.length > 0
    const chosenSize = listed ? chosenBytes(rows, chosen) : 0
    const free = listed ? readFreeSpace() : null
    const noRoom = listed && spaceStateOf(chosenSize, free) === "full"
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
        if (listWaiting || (listed && (chosen.size === 0 || noRoom))) return
        void metered.guard(() => mutate({
            torrents,
            destination,
            // the files left out go by the request's own `deselect` (client.ts choiceOf)
            ...(listed ? fileChoiceRequest(rows, chosen)
                : { smartSelect: { enabled: smartSelect && onlyMissing, missingEpisodeNumbers: smartSelect && onlyMissing ? missing : [] } }),
            media,
        }))
    }

    return <Sheet title={t("Download", "Herunterladen")} open={!!shown} onOpenChange={open => !open && onBack()}
        footer={<>
            <Button intent="secondary" size="lg" wrapperClassName="flex-1" onPress={onBack}>{t("Back", "Zurück")}</Button>
            <Button size="lg" wrapperClassName="flex-[2]" loading={isPending || isAddingToDebrid}
                disabled={!destination || isPending || isAddingToDebrid || listWaiting || (listed && (chosen.size === 0 || noRoom))}
                onPress={start}>{listed && chosenSize > 0 ? t(`Download · ${sizeText(chosenSize)}`, `Laden · ${sizeText(chosenSize)}`) : t("Start download", "Download starten")}</Button>
        </>}>
        <SheetGroup title={torrents.length === 1 ? t("Torrent", "Torrent") : t(`${torrents.length} torrents`, `${torrents.length} Torrents`)}>
            <RowGroup>
                {torrents.map(torrent => <TorrentCard key={torrentKey(torrent)} torrent={torrent} parsed={readOf(torrent)} t={t} language={language} mode="show" />)}
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
        {choosing && <TorrentFileChoice t={t} rows={rows} chosen={chosen} onChange={setChosen} loading={listWaiting} failed={fileList.isError}
            onRetry={() => void fileList.refetch()} free={free} />}
        {/* without a list to choose from: the whole torrent or only the missing episodes, as before */}
        {smartSelect && !debrid && !listed && !listWaiting && <SheetGroup title={t("Episodes", "Folgen")}>
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
