import { Anime_Entry, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { useDebridAddTorrents } from "@/api/hooks/debrid.hooks"
import { useTorrentClientDownload } from "@/api/hooks/torrent_client.hooks"
import { useAutoPlaySelectedTorrent } from "@/app/(main)/_features/autoplay/autoplay"
import {
    PhoneChips,
    PhoneEmpty,
    PhoneField,
    PhoneLoading,
    PhoneNotice,
    PhonePick,
    PhoneSearchField,
    PhoneSheet,
    PhoneSheetGroup,
    PhoneTabs,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { useHandleStartDebridStream } from "@/app/(main)/entry/_containers/debrid-stream/_lib/handle-debrid-stream"
import { Torrent_SearchType, useHandleTorrentSearch } from "@/app/(main)/entry/_containers/torrent-search/_lib/handle-torrent-search"
import { useTorrentSearchSelectedStreamEpisode } from "@/app/(main)/entry/_containers/torrent-search/_lib/handle-torrent-selection"
import {
    filterTorrents,
    LANGUAGE_SEARCH_WORD,
    sortTorrents,
    toggleProvider,
    TorrentCodec,
    TorrentLanguage,
    TorrentSort,
    TorrentSource,
} from "@/app/(main)/entry/_containers/torrent-search/_lib/torrent-filters"
import { getDefaultDestination } from "@/app/(main)/entry/_containers/torrent-search/torrent-download-file-selection"
import { useMeteredGuard } from "@/app/(main)/entry/_containers/torrent-search/_lib/metered-guard"
import { __torrentSearch_selectionAtom, TorrentSelectionType } from "@/app/(main)/entry/_containers/torrent-search/torrent-search-drawer"
import { useHandleStartTorrentStream } from "@/app/(main)/entry/_containers/torrent-stream/_lib/handle-torrent-stream"
import { SeaLink } from "@/components/shared/sea-link"
import { getAppLanguage, Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { subDays, subMonths } from "date-fns"
import { useAtom } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import React from "react"
import { toast } from "sonner"
import "./torrent-search-phone.css"

const RESOLUTIONS = ["2160", "1080", "720", "480"]
const SIZES = [500, 1000, 2000, 5000].map(mb => mb * 1_000_000)

// The German switch of earlier versions becomes the German language
const hadGermanFilter = (() => {
    try {
        return localStorage.getItem("sea-torrent-search-phone-german") === "true"
    }
    catch {
        return false
    }
})()

// The providers searched together (the first decides what the search can do) and the languages, kept for the next search
const __torrentSearchPhone_providersAtom = atomWithStorage<string[]>("sea-torrent-search-phone-providers", [], undefined, { getOnInit: true })
const __torrentSearchPhone_languagesAtom = atomWithStorage<TorrentLanguage[]>("sea-torrent-search-phone-languages", hadGermanFilter ? ["de"] : [],
    undefined, { getOnInit: true })
const __torrentSearchPhone_sortAtom = atomWithStorage<TorrentSort>("sea-torrent-search-phone-sort", "best", undefined, { getOnInit: true })

/** Phones pick the episode's file from a batch automatically; the desktop file pickers are not used here. */
function streamKind(type: TorrentSelectionType | undefined): "torrent" | "debrid" | "download" | undefined {
    if (type === "torrentstream-select" || type === "torrentstream-select-file") return "torrent"
    if (type === "debridstream-select" || type === "debridstream-select-file") return "debrid"
    if (type === "download") return "download"
    return undefined
}

/** Torrent search on phones: one sheet for streaming a torrent, streaming through debrid, or downloading with the app's torrent client. */
export function TorrentSearchPhone({ entry }: { entry: Anime_Entry }) {
    const t = useTr()
    const [type, setType] = useAtom(__torrentSearch_selectionAtom)
    const kind = streamKind(type)
    const [downloading, setDownloading] = React.useState<HibikeTorrent_AnimeTorrent[] | null>(null)
    const close = () => {
        setDownloading(null)
        setType(undefined)
    }
    const title = kind === "download" ? t("Download a torrent", "Torrent herunterladen")
        : kind === "debrid" ? t("Stream with debrid", "Mit Debrid streamen")
            : t("Stream a torrent", "Torrent streamen")

    return <>
        <PhoneSheet title={title} open={!!kind && !downloading} onOpenChange={open => !open && close()} data-torrent-search-phone={kind}>
            {!!kind && !downloading && <TorrentSearchBody entry={entry} type={type!} kind={kind} t={t} onDone={close} onDownload={setDownloading} />}
        </PhoneSheet>
        <TorrentDownloadSheet entry={entry} torrents={downloading} t={t} onBack={() => setDownloading(null)} onDone={close} />
    </>
}

function TorrentSearchBody({ entry, type, kind, t, onDone, onDownload }: {
    entry: Anime_Entry
    type: TorrentSelectionType
    kind: "torrent" | "debrid" | "download"
    t: Translate
    onDone: () => void
    onDownload: (torrents: HibikeTorrent_AnimeTorrent[]) => void
}) {
    const serverStatus = useServerStatus()
    const downloadInfo = entry.downloadInfo

    const shouldLookForBatches = React.useMemo(() => {
        const end = entry.media?.endDate?.year
            ? new Date(entry.media.endDate.year, (entry.media.endDate.month || 1) - 1, entry.media.endDate.day || 1)
            : null
        if (kind === "download") return !!downloadInfo?.canBatch && !!downloadInfo?.episodesToDownload?.length && !(end && subDays(new Date(), 6) < end)
        return !!downloadInfo?.canBatch && !(end && subMonths(new Date(), 1) < end)
    }, [downloadInfo?.canBatch, downloadInfo?.episodesToDownload?.length, kind, entry.media?.endDate])

    const search = useHandleTorrentSearch({
        isAdult: false,
        hasEpisodesToDownload: !!downloadInfo?.episodesToDownload?.length,
        shouldLookForBatches,
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
    React.useEffect(() => {
        if (!providers.length) return
        if (providers[0] !== selectedProviderExtensionId) setSelectedProviderExtensionId(providers[0])
        setExtraProviderIds(providers.slice(1))
        setSearchAcrossProviders(providers.length > 1)
    }, [providers.join(",")])
    const providerName = (id?: string) => providerExtensions?.find(ext => ext.id === id)?.name ?? id ?? ""

    const [languages, setLanguages] = useAtom(__torrentSearchPhone_languagesAtom)
    const [batchOnly, setBatchOnly] = React.useState(smartSearchBatch)
    // A language word the next title search adds, e.g. " German"
    const titleSearchWord = React.useRef("")

    // Title search starts from the anime's title, episode search from nothing (as on the desktop)
    React.useLayoutEffect(() => {
        if (searchType === Torrent_SearchType.SMART) setGlobalFilter("")
        else setGlobalFilter((entry.media?.title?.romaji || entry.media?.title?.english || entry.media?.title?.userPreferred || "").replaceAll(":", "").replaceAll("-", "")
            + titleSearchWord.current)
        titleSearchWord.current = ""
    }, [searchType, entry.media?.title])

    const { torrentSearchStreamEpisode } = useTorrentSearchSelectedStreamEpisode()
    const { handleStreamSelection: startTorrentStream } = useHandleStartTorrentStream()
    const { handleStreamSelection: startDebridStream } = useHandleStartDebridStream()
    const { setAutoPlayTorrent } = useAutoPlaySelectedTorrent()
    const [picked, setPicked] = React.useState<HibikeTorrent_AnimeTorrent[]>([])

    const settings = selectedProviderExtension?.settings
    const canSmart = !!settings?.canSmartSearch
    const smart = searchType === Torrent_SearchType.SMART
    const providerBatch = smart && !!settings?.smartSearchFilters?.includes("batch")
    // The main provider searches whole seasons itself when it can; otherwise the results are filtered here
    React.useEffect(() => setSmartSearchBatch(batchOnly && providerBatch), [batchOnly, providerBatch])
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
    const torrents = React.useMemo(() => sortTorrents(filterTorrents(found, filters, batchOnly && providerBatch), sort),
        [found, smartSearchResolution, batchOnly, languages, dualAudio, seeded, tenBit, codecs, sources, maxSize, resultText, providerBatch, sort])
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

    function choose(torrent: HibikeTorrent_AnimeTorrent) {
        if (kind === "download") {
            setPicked(prev => prev.some(item => item.infoHash === torrent.infoHash) ? prev.filter(item => item.infoHash !== torrent.infoHash) : [...prev, torrent])
            return
        }
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
        else metered.guard(start)
    }
    const metered = useMeteredGuard(t)
    const noEpisodeData = kind !== "download" && !!torrentSearchStreamEpisode && !torrentSearchStreamEpisode.aniDBEpisode

    const missing = downloadInfo?.episodesToDownload?.map(item => item.episodeNumber).sort((a, b) => a - b) ?? []
    const context = kind === "download"
        ? missing.length ? t(`Missing episodes: ${episodeList(missing)}`, `Fehlende Folgen: ${episodeList(missing)}`) : undefined
        : torrentSearchStreamEpisode ? t(`Episode ${torrentSearchStreamEpisode.episodeNumber}`, `Folge ${torrentSearchStreamEpisode.episodeNumber}`) : undefined

    if (!providerExtensions?.length && providerExtensions !== undefined) {
        return <PhoneEmpty title={t("No torrent provider", "Kein Torrent-Anbieter")}
            text={t("Torrents are found by provider extensions. Install one under Extensions.", "Torrents finden Anbieter-Erweiterungen. Installiere eine unter Erweiterungen.")}
            data-torrent-no-provider>
            <SeaLink href="/extensions" className="ps-primary" onClick={onDone}>{t("Open Extensions", "Erweiterungen öffnen")}</SeaLink>
        </PhoneEmpty>
    }

    return <div className="tsp" data-torrent-search-body>
        {!!context && <p className="tsp-context" data-torrent-context>{context}</p>}

        {(providerExtensions?.length ?? 0) > 0 && <PhoneSheetGroup title={t("Providers", "Anbieter")}
            note={(providerExtensions?.length ?? 0) > 1
                ? t("All chosen providers are searched at the same time.", "Alle gewählten Anbieter werden gleichzeitig durchsucht.")
                : t("Add more torrent providers to search them all at once.", "Füge weitere Torrent-Anbieter hinzu, um alle gleichzeitig zu durchsuchen.")}
            action={<SeaLink href="/extensions" className="ps-text-action" onClick={onDone} data-torrent-add-provider>{t("Add", "Hinzufügen")}</SeaLink>}>
            <PhoneChips label={t("Providers", "Anbieter")} variant="wrap" showCheck data-torrent-providers
                chips={(providerExtensions ?? []).map(ext => ({ value: ext.id, label: ext.name }))}
                selected={providers} onToggle={id => setSavedProviders(toggleProvider(providers, id))} />
        </PhoneSheetGroup>}

        <PhoneSheetGroup title={t("Search", "Suche")}>
            {canSmart && <PhoneTabs label={t("Search by", "Suchen nach")} variant="segment" value={searchType} data-torrent-mode
                onChange={value => setSearchType(value as Torrent_SearchType)}
                tabs={[{ value: Torrent_SearchType.SMART, label: t("Episode", "Folge") }, { value: Torrent_SearchType.SIMPLE, label: t("Title", "Titel") }]} />}
            {!smart && <PhoneSearchField t={t} value={globalFilter} onChange={setGlobalFilter} placeholder={t("Search torrents", "Torrents suchen")} data-torrent-query />}
            {smart && kind === "download" && !batchOnly && <PhoneField id="tsp-episode" label={t("Episode", "Folge")} numeric
                value={String(smartSearchEpisode)} onChange={value => setSmartSearchEpisode(Number(value) || 1)} data-torrent-episode />}
            <PhoneChips label={t("Resolution", "Auflösung")} variant="wrap" data-torrent-resolution
                chips={[{ value: "", label: t("Any", "Alle") }, ...RESOLUTIONS.map(value => ({ value, label: `${value}p` }))]}
                selected={[smartSearchResolution]} onToggle={value => setSmartSearchResolution(value)} />
            <PhoneChips label={t("Filters", "Filter")} variant="wrap" showCheck data-torrent-flags chips={flags}
                selected={activeFlags} onToggle={toggleFlag} />
        </PhoneSheetGroup>

        <PhoneSheetGroup title={t("Language", "Sprache")}
            note={t("Audio or subtitles, as the release name says. Untagged releases count as English.",
                "Ton oder Untertitel, wie im Release-Namen angegeben. Releases ohne Angabe zählen als Englisch.")}>
            <PhoneChips label={t("Language", "Sprache")} variant="wrap" showCheck data-torrent-languages chips={languageChips}
                selected={languages} onToggle={value => setLanguages(toggled(languages, value as TorrentLanguage))} />
        </PhoneSheetGroup>

        <PhoneSheetGroup title={t("More filters", "Weitere Filter")}
            action={<button type="button" className="ps-text-action" aria-expanded={showMore} onClick={() => setShowMore(!showMore)} data-torrent-more>
                {showMore ? t("Hide", "Ausblenden") : moreOn ? t(`Show · ${moreOn} on`, `Anzeigen · ${moreOn} an`) : t("Show", "Anzeigen")}
            </button>}>
            {showMore && <>
                <div className="tsp-field">
                    <span>Codec</span>
                    <PhoneChips label="Codec" variant="wrap" showCheck data-torrent-codecs selected={codecs}
                        chips={[{ value: "hevc", label: "HEVC (x265)" }, { value: "avc", label: "AVC (x264)" }, { value: "av1", label: "AV1" }]}
                        onToggle={value => setCodecs(toggled(codecs, value as TorrentCodec))} />
                </div>
                <div className="tsp-field">
                    <span>{t("Source", "Quelle")}</span>
                    <PhoneChips label={t("Source", "Quelle")} variant="wrap" showCheck data-torrent-sources selected={sources}
                        chips={[{ value: "bluray", label: "Blu-ray" }, { value: "web", label: "WEB" }]}
                        onToggle={value => setSources(toggled(sources, value as TorrentSource))} />
                </div>
                <div className="tsp-field">
                    <span>{t("Largest size", "Höchstens")}</span>
                    <PhoneChips label={t("Largest size", "Höchstens")} variant="wrap" data-torrent-size selected={[String(maxSize)]}
                        chips={[{ value: "0", label: t("Any size", "Jede Größe") }, ...SIZES.map(bytes => ({ value: String(bytes), label: sizeLabel(bytes) }))]}
                        onToggle={value => setMaxSize(Number(value))} />
                </div>
            </>}
        </PhoneSheetGroup>

        {noEpisodeData && <PhoneNotice text={t("This episode has no episode data yet, so it can't be streamed.",
            "Für diese Folge fehlen noch Episodendaten, deshalb kann sie nicht gestreamt werden.")} data-torrent-no-episode-data />}

        {warnings.extensionDoesNotSupportAdult && <PhoneNotice text={t("This provider does not search adult titles.", "Dieser Anbieter sucht keine Titel für Erwachsene.")} />}

        <PhoneSheetGroup title={isFetching && !isLoading ? t("Results · updating", "Ergebnisse · wird aktualisiert")
                : torrents.length < found.length ? t(`Results · ${torrents.length} of ${found.length}`, `Ergebnisse · ${torrents.length} von ${found.length}`)
                    : found.length ? t(`Results · ${found.length}`, `Ergebnisse · ${found.length}`) : t("Results", "Ergebnisse")}
            note={kind === "debrid" && debridOn ? t("Cached torrents start at once.", "Gecachte Torrents starten sofort.") : undefined}>
            {found.length > 0 && <>
                <PhoneSearchField t={t} value={resultText} onChange={setResultText} data-torrent-result-search
                    placeholder={t("Search results: group, HEVC, -720p …", "In Treffern suchen: Gruppe, HEVC, -720p …")} />
                <PhoneChips label={t("Sort by", "Sortieren nach")} variant="wrap" data-torrent-sort chips={sorts}
                    selected={[sort]} onToggle={value => setSort(value as TorrentSort)} />
            </>}
            {isLoading ? <PhoneLoading label={t("Searching torrents", "Torrents werden gesucht")} layout={["row", "row", "row", "row"]} />
                : isError ? <PhoneNotice text={t("The provider did not answer.", "Der Anbieter hat nicht geantwortet.")} data-torrent-error>
                        <button type="button" className="ps-text-action" onClick={() => void refetch()}>{t("Try again", "Erneut versuchen")}</button>
                    </PhoneNotice>
                    : torrents.length === 0 && found.length > 0 ? <PhoneEmpty data-torrent-filtered
                            title={t("No torrents match the filters", "Kein Torrent passt zu den Filtern")}
                            text={<>
                                {t(`The filters hide ${found.length} results.`, `Die Filter blenden ${found.length} Treffer aus.`)}
                                {multiCount > 0 && t(` ${multiCount} multi-sub releases often hold more subtitle languages without naming them.`,
                                    ` ${multiCount} Multi-Sub-Releases enthalten oft weitere Untertitel-Sprachen, ohne sie zu nennen.`)}
                                {canSearchWithLanguage && t(` Releases in a language are often only found with "${searchWord}" in the search.`,
                                    ` Releases in einer Sprache findet oft erst die Suche mit „${searchWord}“.`)}
                            </>}>
                            {multiCount > 0 && <button type="button" className="ps-secondary" onClick={() => setLanguages([...languages, "multi"])}
                                data-torrent-add-multi>{t("Add Multi-Sub", "Multi-Sub dazunehmen")}</button>}
                            {canSearchWithLanguage && <button type="button" className="ps-secondary" onClick={searchWithLanguage}
                                data-torrent-search-language>{t(`Search with "${searchWord}"`, `Mit „${searchWord}“ suchen`)}</button>}
                            <button type="button" className="ps-secondary" onClick={clearFilters}>{t("Clear filters", "Filter zurücksetzen")}</button>
                        </PhoneEmpty>
                    : torrents.length === 0 ? <PhoneEmpty title={t("No torrents found", "Keine Torrents gefunden")} data-torrent-empty
                            text={autoRetrySeconds ? t(`Trying again in ${autoRetrySeconds} s.`, `Neuer Versuch in ${autoRetrySeconds} s.`)
                                : smart ? t("Search by title finds more.", "Die Suche nach Titel findet mehr.") : undefined}>
                            {smart && <button type="button" className="ps-secondary" onClick={() => setSearchType(Torrent_SearchType.SIMPLE)}>{t("Search by title", "Nach Titel suchen")}</button>}
                        </PhoneEmpty>
                        : <ul className="tsp-list" data-torrent-list>
                            {torrents.map(torrent => {
                                const isCached = !!torrent.infoHash && !!cached[torrent.infoHash]
                                const meta = torrentMeta(torrent, t, isCached, providers.length > 1 ? providerName(torrent.provider) : "")
                                return <li key={torrent.infoHash || torrent.link}>
                                    {kind === "download"
                                        ? <PhonePick label={<span className="tsp-name">{torrent.name}</span>} note={meta}
                                            checked={picked.some(item => item.infoHash === torrent.infoHash)} onChange={() => choose(torrent)} data-torrent-row={torrent.infoHash} />
                                        : <button type="button" className="tsp-row" onClick={() => choose(torrent)} data-torrent-row={torrent.infoHash}>
                                            <span className="tsp-name">{torrent.name}</span>
                                            <small>{meta}</small>
                                        </button>}
                                </li>
                            })}
                        </ul>}
        </PhoneSheetGroup>

        {kind === "download" && picked.length > 0 && <div className="ps-sheet-actions tsp-actions">
            <button type="button" className="ps-primary" onClick={() => onDownload(picked)} data-torrent-continue>
                {picked.length === 1 ? t("Continue", "Weiter") : t(`Continue with ${picked.length}`, `Weiter mit ${picked.length}`)}
            </button>
        </div>}
        {metered.dialog}
    </div>
}

/** Destination and episode choice, then the download through the app's own torrent client. */
function TorrentDownloadSheet({ entry, torrents, t, onBack, onDone }: {
    entry: Anime_Entry
    torrents: HibikeTorrent_AnimeTorrent[] | null
    t: Translate
    onBack: () => void
    onDone: () => void
}) {
    const serverStatus = useServerStatus()
    const router = useRouter()
    const library = serverStatus?.settings?.library
    const libraryPath = library?.libraryPath || library?.libraryPaths?.[0] || ""
    const destination = getDefaultDestination(entry, libraryPath)
    const missing = entry.downloadInfo?.episodesToDownload?.map(item => item.episodeNumber) ?? []
    const media = entry.media
    const canSmartSelect = torrents?.length === 1 && !!torrents[0].isBatch && media?.format !== "MOVIE" && media?.status === "FINISHED"
        && (media?.episodes ?? 0) > 1 && missing.length > 0 && missing.length !== media?.episodes
    const [onlyMissing, setOnlyMissing] = React.useState(true)
    const debridOn = !!serverStatus?.debridSettings?.enabled && !!serverStatus?.debridSettings?.provider
    const [viaDebrid, setViaDebrid] = React.useState(false)
    const metered = useMeteredGuard(t)
    const { mutate, isPending } = useTorrentClientDownload(() => {
        onDone()
        router.push("/android-downloads?kind=torrents")
    }, failure => toast.error(downloadError(String(failure.response?.data?.error ?? failure.message ?? ""), t)))
    const { mutate: addToDebrid, isPending: isAddingToDebrid } = useDebridAddTorrents(() => {
        onDone()
        router.push("/android-downloads?kind=torrents")
    })
    const debrid = debridOn && viaDebrid

    function start() {
        if (!torrents?.length || !media || !destination) return
        // The debrid service downloads the torrent and the server fetches the finished files from it
        if (debrid) return addToDebrid({ torrents, destination, media })
        metered.guard(() => mutate({
            torrents,
            destination,
            smartSelect: { enabled: canSmartSelect && onlyMissing, missingEpisodeNumbers: canSmartSelect && onlyMissing ? missing : [] },
            media,
        }))
    }

    return <PhoneSheet title={t("Download", "Herunterladen")} open={!!torrents} onOpenChange={open => !open && onBack()} data-torrent-download-sheet
        footer={<>
            <button type="button" className="ps-secondary" onClick={onBack}>{t("Back", "Zurück")}</button>
            <button type="button" className="ps-primary" disabled={!destination || isPending || isAddingToDebrid} aria-busy={isPending || isAddingToDebrid || undefined} onClick={start}
                data-torrent-download-start>{t("Start download", "Download starten")}</button>
        </>}>
        {!!torrents && <>
            <PhoneSheetGroup title={torrents.length === 1 ? t("Torrent", "Torrent") : t(`${torrents.length} torrents`, `${torrents.length} Torrents`)}>
                <ul className="tsp-chosen">{torrents.map(torrent => <li key={torrent.infoHash || torrent.link}>
                    <span className="tsp-name">{torrent.name}</span>
                    <small>{torrentMeta(torrent, t, false)}</small>
                </li>)}</ul>
            </PhoneSheetGroup>
            {debridOn && <PhoneSheetGroup title={t("Download with", "Laden über")}>
                <div role="radiogroup" className="ps-rows" aria-label={t("Download with", "Laden über")}>
                    <PhonePick role="radio" checked={!viaDebrid} onChange={() => setViaDebrid(false)} data-torrent-via-client
                        label={t("Torrent client", "Torrent-Client")} note={t("Loads from other people's devices", "Lädt von den Geräten anderer Nutzer")} />
                    <PhonePick role="radio" checked={viaDebrid} onChange={() => setViaDebrid(true)} data-torrent-via-debrid
                        label={t("Debrid service", "Debrid-Dienst")} note={t("Faster, also without seeders", "Schneller, auch ohne Seeder")} />
                </div>
            </PhoneSheetGroup>}
            {canSmartSelect && !debrid && <PhoneSheetGroup title={t("Episodes", "Folgen")}>
                <div role="radiogroup" className="ps-rows" aria-label={t("Episodes", "Folgen")}>
                    <PhonePick role="radio" checked={onlyMissing} onChange={() => setOnlyMissing(true)} data-torrent-only-missing
                        label={t("Only the episodes you are missing", "Nur fehlende Folgen")} note={episodeList(missing)} />
                    <PhonePick role="radio" checked={!onlyMissing} onChange={() => setOnlyMissing(false)}
                        label={t("Everything in the torrent", "Alles im Torrent")} />
                </div>
            </PhoneSheetGroup>}
            <PhoneSheetGroup title={t("Saved to", "Speicherort")}>
                {destination
                    ? <p className="tsp-path" data-torrent-destination>{destination}</p>
                    : <PhoneNotice text={t("Pick a library folder first. Downloads are saved there and show up on the anime page.",
                        "Wähle zuerst einen Bibliotheksordner. Downloads landen dort und erscheinen auf der Anime-Seite.")} data-torrent-no-library>
                        <SeaLink href="/settings?tab=library" className="ps-text-action" onClick={onDone}>{t("Choose a folder", "Ordner wählen")}</SeaLink>
                    </PhoneNotice>}
                <p className="ps-sheet-note">{debrid
                    ? t("The debrid service downloads the torrent, then the files are saved here. Progress is under Downloads → Torrents.",
                        "Der Debrid-Dienst lädt den Torrent, danach werden die Dateien hier gespeichert. Den Fortschritt siehst du unter Downloads → Torrents.")
                    : t("Torrents download over your connection. On mobile data the app asks first. Progress is under Downloads → Torrents.",
                        "Torrents laden über deine Verbindung. Im Mobilnetz fragt die App vorher. Den Fortschritt siehst du unter Downloads → Torrents.")}</p>
            </PhoneSheetGroup>
        </>}
        {metered.dialog}
    </PhoneSheet>
}

/** "Only the episodes you are missing" needs a torrent that holds all of them, from one season; the sheet stays open to pick another way. */
function downloadError(reason: string, t: Translate) {
    if (/could not find the right season files/i.test(reason)) {
        return t("This torrent doesn't hold every missing episode. Choose \"Everything in the torrent\" or another torrent.",
            "Dieser Torrent enthält nicht alle fehlenden Folgen. Wähle „Alles im Torrent“ oder einen anderen Torrent.")
    }
    if (/can't tell seasons apart/i.test(reason)) {
        return t("This torrent mixes seasons. Choose \"Everything in the torrent\" or another torrent.",
            "Dieser Torrent mischt Staffeln. Wähle „Alles im Torrent“ oder einen anderen Torrent.")
    }
    return reason
}

function torrentMeta(torrent: HibikeTorrent_AnimeTorrent, t: Translate, cached: boolean, provider = "") {
    const parts = [
        provider,
        torrent.isBestRelease ? t("Best release", "Bestes Release") : "",
        cached ? t("Cached", "Gecacht") : "",
        torrent.isBatch ? "Batch" : "",
        torrent.releaseGroup || "",
        torrent.resolution || "",
        torrent.formattedSize || "",
        // Providers without seeder counts send -1
        torrent.seeders > 0 ? t(`${torrent.seeders} seeders`, `${torrent.seeders} Seeder`)
            : torrent.seeders < 0 ? t("Seeders unknown", "Seeder unbekannt") : t("No seeders", "Keine Seeder"),
        ago(torrent.date),
    ]
    return parts.filter(Boolean).join(" · ")
}

function ago(date: string) {
    const time = Date.parse(date)
    if (!time) return ""
    const rtf = new Intl.RelativeTimeFormat(getAppLanguage(), { numeric: "auto" })
    const hours = Math.round((time - Date.now()) / 3_600_000)
    if (Math.abs(hours) < 24) return rtf.format(hours, "hour")
    const days = Math.round(hours / 24)
    if (Math.abs(days) < 31) return rtf.format(days, "day")
    if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), "month")
    return rtf.format(Math.round(days / 365), "year")
}

/** "1–3, 5" */
function episodeList(numbers: number[]) {
    const out: string[] = []
    for (let i = 0; i < numbers.length; i++) {
        let j = i
        while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++
        out.push(j > i ? `${numbers[i]}–${numbers[j]}` : `${numbers[i]}`)
        i = j
    }
    return out.join(", ")
}

function toggled<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter(item => item !== value) : [...list, value]
}

/** "≤ 500 MB", "≤ 2 GB" */
function sizeLabel(bytes: number) {
    return bytes >= 1_000_000_000 ? `≤ ${bytes / 1_000_000_000} GB` : `≤ ${bytes / 1_000_000} MB`
}
