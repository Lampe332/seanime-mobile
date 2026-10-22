import { Anime_Entry, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
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
    PhoneSelect,
    PhoneSheet,
    PhoneSheetGroup,
    PhoneTabs,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { useHandleStartDebridStream } from "@/app/(main)/entry/_containers/debrid-stream/_lib/handle-debrid-stream"
import { Torrent_SearchType, useHandleTorrentSearch } from "@/app/(main)/entry/_containers/torrent-search/_lib/handle-torrent-search"
import { useTorrentSearchSelectedStreamEpisode } from "@/app/(main)/entry/_containers/torrent-search/_lib/handle-torrent-selection"
import { getDefaultDestination } from "@/app/(main)/entry/_containers/torrent-search/torrent-download-file-selection"
import { __torrentSearch_selectionAtom, TorrentSelectionType } from "@/app/(main)/entry/_containers/torrent-search/torrent-search-drawer"
import { useHandleStartTorrentStream } from "@/app/(main)/entry/_containers/torrent-stream/_lib/handle-torrent-stream"
import { SeaLink } from "@/components/shared/sea-link"
import { getAppLanguage, Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { subDays, subMonths } from "date-fns"
import { useAtom } from "jotai/react"
import React from "react"
import "./torrent-search-phone.css"

const RESOLUTIONS = ["1080", "720", "480"]

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
        globalFilter, setGlobalFilter, searchType, setSearchType, smartSearchBatch, setSmartSearchBatch, smartSearchEpisode,
        setSmartSearchEpisode, smartSearchResolution, setSmartSearchResolution, smartSearchBest, setSmartSearchBest,
        data, isLoading, isFetching, isError, autoRetrySeconds, refetch,
    } = search

    // Title search starts from the anime's title, episode search from nothing (as on the desktop)
    React.useLayoutEffect(() => {
        if (searchType === Torrent_SearchType.SMART) setGlobalFilter("")
        else setGlobalFilter((entry.media?.title?.romaji || entry.media?.title?.english || entry.media?.title?.userPreferred || "").replaceAll(":", "").replaceAll("-", ""))
    }, [searchType, entry.media?.title])

    const { torrentSearchStreamEpisode } = useTorrentSearchSelectedStreamEpisode()
    const { handleStreamSelection: startTorrentStream } = useHandleStartTorrentStream()
    const { handleStreamSelection: startDebridStream } = useHandleStartDebridStream()
    const { setAutoPlayTorrent } = useAutoPlaySelectedTorrent()
    const [picked, setPicked] = React.useState<HibikeTorrent_AnimeTorrent[]>([])

    const settings = selectedProviderExtension?.settings
    const canSmart = !!settings?.canSmartSearch
    const flags = [
        ...(settings?.smartSearchFilters?.includes("batch") ? [{ value: "batch", label: t("Whole season", "Ganze Staffel") }] : []),
        ...(settings?.smartSearchFilters?.includes("bestReleases") ? [{ value: "best", label: t("Best releases", "Beste Releases") }] : []),
    ]
    const smart = searchType === Torrent_SearchType.SMART
    const debridOn = !!serverStatus?.debridSettings?.enabled
    // Only the debrid stream uses the debrid cache; the built-in client and torrent streaming download from peers
    const cached = debridOn && kind === "debrid" ? data?.debridInstantAvailability ?? {} : {}

    const torrents = React.useMemo(() => {
        const list = smart ? (data?.previews ?? []).map(preview => preview.torrent).filter((item): item is HibikeTorrent_AnimeTorrent => !!item) : data?.torrents ?? []
        return [...list].sort((a, b) => Number(b.isBestRelease) - Number(a.isBestRelease))
    }, [data?.previews, data?.torrents, smart])

    function choose(torrent: HibikeTorrent_AnimeTorrent) {
        if (kind === "download") {
            setPicked(prev => prev.some(item => item.infoHash === torrent.infoHash) ? prev.filter(item => item.infoHash !== torrent.infoHash) : [...prev, torrent])
            return
        }
        const episode = torrentSearchStreamEpisode
        if (!episode?.aniDBEpisode) return
        setAutoPlayTorrent(torrent, entry)
        const common = { torrent, mediaId: entry.mediaId, episodeNumber: episode.episodeNumber, aniDBEpisode: episode.aniDBEpisode, batchEpisodeFiles: undefined }
        if (kind === "debrid") startDebridStream({ ...common, chosenFileId: "" })
        else startTorrentStream({ ...common, chosenFileIndex: undefined })
        onDone()
    }

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

        <PhoneSheetGroup title={t("Search", "Suche")}>
            {(providerExtensions?.length ?? 0) > 1 && <label className="tsp-field">
                <span>{t("Provider", "Anbieter")}</span>
                <PhoneSelect id="tsp-provider" label={t("Provider", "Anbieter")} value={selectedProviderExtensionId}
                    onChange={setSelectedProviderExtensionId} data-torrent-provider
                    options={(providerExtensions ?? []).map(ext => ({ value: ext.id, label: ext.name }))} />
            </label>}
            {canSmart && <PhoneTabs label={t("Search by", "Suchen nach")} variant="segment" value={searchType} data-torrent-mode
                onChange={value => setSearchType(value as Torrent_SearchType)}
                tabs={[{ value: Torrent_SearchType.SMART, label: t("Episode", "Folge") }, { value: Torrent_SearchType.SIMPLE, label: t("Title", "Titel") }]} />}
            {!smart && <PhoneSearchField t={t} value={globalFilter} onChange={setGlobalFilter} placeholder={t("Search torrents", "Torrents suchen")} data-torrent-query />}
            {smart && kind === "download" && !smartSearchBatch && <PhoneField id="tsp-episode" label={t("Episode", "Folge")} numeric
                value={String(smartSearchEpisode)} onChange={value => setSmartSearchEpisode(Number(value) || 1)} data-torrent-episode />}
            {smart && <PhoneChips label={t("Resolution", "Auflösung")} variant="wrap" data-torrent-resolution
                chips={[{ value: "", label: t("Any", "Alle") }, ...RESOLUTIONS.map(value => ({ value, label: `${value}p` }))]}
                selected={[smartSearchResolution]} onToggle={value => setSmartSearchResolution(value)} />}
            {smart && flags.length > 0 && <PhoneChips label={t("Filters", "Filter")} variant="wrap" showCheck data-torrent-flags chips={flags}
                selected={[smartSearchBatch ? "batch" : "", smartSearchBest ? "best" : ""].filter(Boolean)}
                onToggle={value => value === "batch" ? setSmartSearchBatch(!smartSearchBatch) : setSmartSearchBest(!smartSearchBest)} />}
        </PhoneSheetGroup>

        {warnings.extensionDoesNotSupportAdult && <PhoneNotice text={t("This provider does not search adult titles.", "Dieser Anbieter sucht keine Titel für Erwachsene.")} />}

        <PhoneSheetGroup title={isFetching && !isLoading ? t("Results · updating", "Ergebnisse · wird aktualisiert") : t("Results", "Ergebnisse")}
            note={kind === "debrid" && debridOn ? t("Cached torrents start at once.", "Gecachte Torrents starten sofort.") : undefined}>
            {isLoading ? <PhoneLoading label={t("Searching torrents", "Torrents werden gesucht")} layout={["row", "row", "row", "row"]} />
                : isError ? <PhoneNotice text={t("The provider did not answer.", "Der Anbieter hat nicht geantwortet.")} data-torrent-error>
                        <button type="button" className="ps-text-action" onClick={() => void refetch()}>{t("Try again", "Erneut versuchen")}</button>
                    </PhoneNotice>
                    : torrents.length === 0 ? <PhoneEmpty title={t("No torrents found", "Keine Torrents gefunden")} data-torrent-empty
                            text={autoRetrySeconds ? t(`Trying again in ${autoRetrySeconds} s.`, `Neuer Versuch in ${autoRetrySeconds} s.`)
                                : smart ? t("Search by title finds more.", "Die Suche nach Titel findet mehr.") : undefined}>
                            {smart && <button type="button" className="ps-secondary" onClick={() => setSearchType(Torrent_SearchType.SIMPLE)}>{t("Search by title", "Nach Titel suchen")}</button>}
                        </PhoneEmpty>
                        : <ul className="tsp-list" data-torrent-list>
                            {torrents.map(torrent => {
                                const isCached = !!torrent.infoHash && !!cached[torrent.infoHash]
                                const meta = torrentMeta(torrent, t, isCached)
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
    const { mutate, isPending } = useTorrentClientDownload(() => {
        onDone()
        router.push("/android-downloads?kind=torrents")
    })

    function start() {
        if (!torrents?.length || !media || !destination) return
        mutate({
            torrents,
            destination,
            smartSelect: { enabled: canSmartSelect && onlyMissing, missingEpisodeNumbers: canSmartSelect && onlyMissing ? missing : [] },
            media,
        })
    }

    return <PhoneSheet title={t("Download", "Herunterladen")} open={!!torrents} onOpenChange={open => !open && onBack()} data-torrent-download-sheet
        footer={<>
            <button type="button" className="ps-secondary" onClick={onBack}>{t("Back", "Zurück")}</button>
            <button type="button" className="ps-primary" disabled={!destination || isPending} aria-busy={isPending || undefined} onClick={start}
                data-torrent-download-start>{t("Start download", "Download starten")}</button>
        </>}>
        {!!torrents && <>
            <PhoneSheetGroup title={torrents.length === 1 ? t("Torrent", "Torrent") : t(`${torrents.length} torrents`, `${torrents.length} Torrents`)}>
                <ul className="tsp-chosen">{torrents.map(torrent => <li key={torrent.infoHash || torrent.link}>
                    <span className="tsp-name">{torrent.name}</span>
                    <small>{torrentMeta(torrent, t, false)}</small>
                </li>)}</ul>
            </PhoneSheetGroup>
            {canSmartSelect && <PhoneSheetGroup title={t("Episodes", "Folgen")}>
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
                <p className="ps-sheet-note">{t("Torrents download over your connection, also on mobile data. Progress is under Downloads → Torrents.",
                    "Torrents laden über deine Verbindung, auch mobil. Den Fortschritt siehst du unter Downloads → Torrents.")}</p>
            </PhoneSheetGroup>
        </>}
    </PhoneSheet>
}

function torrentMeta(torrent: HibikeTorrent_AnimeTorrent, t: Translate, cached: boolean) {
    const parts = [
        torrent.isBestRelease ? t("Best release", "Bestes Release") : "",
        cached ? t("Cached", "Gecacht") : "",
        torrent.isBatch ? "Batch" : "",
        torrent.releaseGroup || "",
        torrent.resolution || "",
        torrent.formattedSize || "",
        torrent.seeders > 0 ? t(`${torrent.seeders} seeders`, `${torrent.seeders} Seeder`) : t("No seeders", "Keine Seeder"),
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
