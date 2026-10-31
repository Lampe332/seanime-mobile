import { Manga_CollectionEntry, Manga_CollectionList, Manga_MangaLatestChapterNumberItem } from "@/api/generated/types"
import { useGetMangaSourceRefresh } from "@/api/hooks/manga.hooks"
import { useUpdateTheme } from "@/api/hooks/theme.hooks"
import { SeaContextMenu } from "@/app/(main)/_features/context-menu/sea-context-menu"
import { MediaEntryCardAdultVeil } from "@/app/(main)/_features/media/_components/media-entry-card-components"
import { useMediaPreviewModal } from "@/app/(main)/_features/media/_containers/media-preview-modal"
import { PluginMediaCardContextMenuItems, usePluginMangaLibraryDropdownItems } from "@/app/(main)/_features/plugin/actions/plugin-actions"
import { PluginWebviewSlot } from "@/app/(main)/_features/plugin/webview/plugin-webviews"
import { CommandItemMedia } from "@/app/(main)/_features/sea-command/_components/command-utils"
import { SeaCommandInjectableItem, useSeaCommandInject } from "@/app/(main)/_features/sea-command/use-inject"
import { seaCommand_compareMediaTitles } from "@/app/(main)/_features/sea-command/utils"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { MangaSourceRefreshModal } from "@/app/(main)/manga/_components/manga-source-refresh-modal"
import { __mangaLibrary_paramsAtom } from "@/app/(main)/manga/_lib/handle-manga-collection"
import { __manga_resumeLocationsAtom } from "@/app/(main)/manga/_lib/manga-chapter-reader.atoms"
import { __manga_continueIntentAtom, getMangaContinueReading, MangaContinueItem } from "@/app/(main)/manga/_lib/manga-continue"
import { getMangaGenreCounts, getMangaStatusTabs, MANGA_PHONE_SORTING_OPTIONS, MangaPhoneStatus, pickMangaStatus } from "@/app/(main)/manga/_lib/manga-library-phone"
import { MangaEntryFilters } from "@/app/(main)/manga/_lib/manga-preferences"
import { getMangaEntryUnreadState } from "@/app/(main)/manga/_lib/manga-unread"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Modal } from "@/components/ui/modal"
import { Translate, useTr } from "@/lib/app-language"
import { TabletLabel } from "@/lib/tablet-ui"
import { useRouter } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useAtom, useAtomValue, useSetAtom } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import React from "react"
import { useSwap } from "@/lib/motion"
import { LuBookOpen, LuCheck, LuChevronDown, LuEllipsisVertical, LuEye, LuRefreshCcw, LuSearch, LuSlidersHorizontal } from "react-icons/lu"
import "@/components/shared/mobile-surface.css"
import "./manga-library-phone.css"

const statusAtom = atomWithStorage<string>("sea-mobile-manga-library-status", "CURRENT", undefined, { getOnInit: true })

type MangaLibraryPhoneProps = {
    /** Every status, filtered and sorted */
    lists: Manga_CollectionList[] | undefined
    /** Every status as loaded, for the tabs and genre chips */
    rawLists: Manga_CollectionList[] | undefined
    loading: boolean
    error: boolean
    onRetry: () => void
    latestChapterNumbers: Record<number, Manga_MangaLatestChapterNumberItem[]> | undefined
    storedProviders: Record<string, string>
    storedFilters: Record<string, MangaEntryFilters>
}

/**
 * Android phone Manga tab in the Home / Downloads language: title with icon actions, "Continue reading",
 * the list statuses as tabs over a cover grid; sorting and filters live in a sheet.
 */
export function MangaLibraryPhone(props: MangaLibraryPhoneProps) {
    const { lists, rawLists, loading, error, latestChapterNumbers, storedProviders, storedFilters } = props
    const t = useTr()
    const router = useRouter()
    const ts = useThemeSettings()
    const serverStatus = useServerStatus()
    const blurAdult = !!serverStatus?.settings?.anilist?.blurAdultContent
    const showUnread = !!ts.showMangaUnreadCount

    const [params, setParams] = useAtom(__mangaLibrary_paramsAtom)
    const resumeLocations = useAtomValue(__manga_resumeLocationsAtom)
    const setContinueIntent = useSetAtom(__manga_continueIntentAtom)
    const [storedStatus, setStoredStatus] = useAtom(statusAtom)
    const [filtersOpen, setFiltersOpen] = React.useState(false)
    const [refreshOpen, setRefreshOpen] = React.useState(false)
    const [menuOpen, setMenuOpen] = React.useState(false)
    const refreshButtonRef = React.useRef<HTMLButtonElement>(null)
    const filterButtonRef = React.useRef<HTMLButtonElement>(null)

    const { data: refreshJob } = useGetMangaSourceRefresh()
    const refreshRunning = refreshJob?.status === "running" || refreshJob?.status === "stopping"
    const { items: pluginItems, handleClick: onPluginItem } = usePluginMangaLibraryDropdownItems()

    const tabs = React.useMemo(() => getMangaStatusTabs(rawLists, lists), [rawLists, lists])
    const status = pickMangaStatus(storedStatus, tabs)
    const panelRef = React.useRef<HTMLDivElement>(null)
    useSwap(panelRef, status)
    const entries = React.useMemo(() => lists?.find(list => list.type === status)?.entries ?? [], [lists, status])
    const rawReading = React.useMemo(() => rawLists?.find(list => list.type === "CURRENT")?.entries, [rawLists])
    const unreadOf = React.useCallback((entry: Manga_CollectionEntry) => getMangaEntryUnreadState(entry.mediaId, entry.listData?.progress || 0,
        latestChapterNumbers ?? {}, storedProviders, storedFilters), [latestChapterNumbers, storedProviders, storedFilters])

    const continueItems = React.useMemo(() => getMangaContinueReading(rawReading, {
        resumeLocations, latestChapterNumbers: latestChapterNumbers ?? {}, storedProviders, storedFilters, now: Date.now(),
    }), [rawReading, resumeLocations, latestChapterNumbers, storedProviders, storedFilters])

    const total = rawLists?.reduce((n, list) => n + (list.entries?.length ?? 0), 0) ?? 0
    const withNew = rawReading?.filter(entry => { const state = unreadOf(entry); return state.known && state.unread > 0 }).length ?? 0
    const activeFilters = (params.genre?.length ?? 0) + (params.unreadOnly ? 1 : 0)

    const facts = loading ? t("Loading your list…", "Deine Liste wird geladen …")
        : error ? t("Not loaded", "Nicht geladen")
            : `${total} Manga${showUnread && withNew > 0 ? ` · ${withNew} ${t("with new chapters", "mit neuen Kapiteln")}` : ""}`

    // Android-only text zoom: it scales text but not lengths, so the grid widens its cards by the measured factor.
    const root = React.useRef<HTMLDivElement>(null)
    React.useLayoutEffect(() => {
        const probe = document.createElement("span")
        probe.style.cssText = "position:absolute;visibility:hidden;font:16px/1 sans-serif"
        probe.textContent = "M"
        document.body.append(probe)
        const zoom = probe.getBoundingClientRect().height / 16
        probe.remove()
        if (zoom > 0) root.current?.style.setProperty("--mml-text-zoom", zoom.toFixed(2))
    }, [])

    // Android Back closes what is open on this page first.
    React.useEffect(() => {
        if (!filtersOpen && !refreshOpen && !menuOpen) return
        const back = (event: Event) => {
            if (event.defaultPrevented) return
            event.preventDefault()
            if (menuOpen) setMenuOpen(false)
            else if (filtersOpen) setFiltersOpen(false)
            else setRefreshOpen(false)
        }
        window.addEventListener("seanime:android-back", back)
        return () => window.removeEventListener("seanime:android-back", back)
    }, [filtersOpen, refreshOpen, menuOpen])

    // Reading manga stay searchable from the command palette, as on the desktop library.
    const { inject, remove } = useSeaCommandInject()
    React.useEffect(() => {
        if (!rawReading?.length) return
        inject("currently-reading-manga", {
            items: rawReading.map(entry => ({
                data: entry,
                id: `manga-${entry.mediaId}`,
                value: entry.media?.title?.userPreferred || "",
                heading: "Currently Reading",
                priority: 100,
                render: () => <CommandItemMedia media={entry.media!} type="manga" />,
                onSelect: () => router.push(`/manga/entry?id=${entry.mediaId}`),
            })),
            filter: ({ item, input }: { item: SeaCommandInjectableItem, input: string }) => {
                if (!input) return true
                return seaCommand_compareMediaTitles((item.data as Manga_CollectionEntry)?.media?.title, input)
            },
            priority: 100,
        })
        return () => remove("currently-reading-manga")
    }, [rawReading])

    const continueReading = React.useCallback((mediaId: number) => {
        setContinueIntent({ mediaId, at: Date.now() })
        router.push(`/manga/entry?id=${mediaId}`)
    }, [])

    const resetFilters = () => setParams(draft => {
        draft.genre = []
        draft.unreadOnly = false
    })

    const hasManga = total > 0
    const selectedTab = tabs.find(tab => tab.value === status)

    return <PageWrapper ref={root} className="mml" data-mobile-manga-library="true">
        <header className="mml-header">
            <div className="mml-header-text">
                <h1>Manga</h1>
                <p>{facts}</p>
            </div>
            <div className="mml-actions">
                <SeaLink href="/search?type=manga" className="mml-icon-button" aria-label={t("Search manga on AniList", "Manga auf AniList suchen")}>
                    <LuSearch aria-hidden /><TabletLabel>{t("Search", "Suche")}</TabletLabel>
                </SeaLink>
                <button ref={refreshButtonRef} type="button" className="mml-icon-button" onClick={() => setRefreshOpen(true)} data-manga-source-refresh
                    aria-label={refreshRunning ? t("Source refresh running", "Quellen werden aktualisiert") : t("Refresh manga sources", "Manga-Quellen aktualisieren")}>
                    <LuRefreshCcw aria-hidden /><TabletLabel>{t("Sources", "Quellen")}</TabletLabel>
                    {refreshRunning && <span className="mml-dot" aria-hidden />}
                </button>
                <button ref={filterButtonRef} type="button" className="mml-icon-button" onClick={() => setFiltersOpen(true)} data-manga-filter-button
                    aria-label={activeFilters ? `${t("Filter and sort", "Filtern und sortieren")}, ${activeFilters} ${t("active", "aktiv")}` : t("Filter and sort", "Filtern und sortieren")}>
                    <LuSlidersHorizontal aria-hidden /><TabletLabel>{t("Filter", "Filter")}</TabletLabel>
                    {activeFilters > 0 && <span className="mml-dot" aria-hidden />}
                </button>
                {pluginItems.length > 0 && <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} className="mml-menu" trigger={
                    <button type="button" className="mml-icon-button" aria-label={t("More actions", "Weitere Aktionen")} data-manga-library-menu>
                        <LuEllipsisVertical aria-hidden />
                    </button>}>
                    {pluginItems.map(item => <DropdownMenuItem key={item.id} onClick={() => onPluginItem(item)} style={item.style} disabled={item.disabled}>
                        {item.label || "???"}
                    </DropdownMenuItem>)}
                </DropdownMenu>}
            </div>
        </header>

        {error ? <div className="mml-notice" role="alert" data-manga-library-error>
                <p>{typeof navigator !== "undefined" && navigator.onLine === false
                    ? t("No internet connection, so your manga list could not be loaded.", "Keine Internetverbindung, deshalb konnte deine Manga-Liste nicht geladen werden.")
                    : t("Your manga list could not be loaded.", "Deine Manga-Liste konnte nicht geladen werden.")}</p>
                <div className="mml-notice-actions">
                    <button type="button" className="mml-text-action" onClick={props.onRetry}>{t("Try again", "Erneut versuchen")}</button>
                    <SeaLink href="/android-downloads?kind=manga" className="mml-text-action">{t("Read downloads", "Downloads lesen")}</SeaLink>
                </div>
            </div>
            : loading ? <LoadingState t={t} />
                : !hasManga ? <div className="mml-empty" data-manga-library-empty>
                        <p>{t("No manga in your list yet", "Noch keine Manga in deiner Liste")}</p>
                        <p>{t("Manga you add on AniList appear here, sorted by status.", "Manga, die du auf AniList hinzufügst, erscheinen hier nach Status sortiert.")}</p>
                        <SeaLink href="/discover?type=manga" className="mml-secondary">{t("Browse manga", "Manga entdecken")}</SeaLink>
                    </div>
                    : <>
                        {continueItems.length > 0 && <section className="mml-section" aria-labelledby="mml-continue-title" data-manga-continue-section>
                            <div className="mml-section-head"><h2 id="mml-continue-title">{t("Continue reading", "Weiterlesen")}</h2></div>
                            <div className="mml-continue">
                                {continueItems.map(item => <ContinueCard key={item.entry.mediaId} item={item} blurAdult={blurAdult} t={t} onContinue={continueReading} />)}
                            </div>
                        </section>}

                        <section className="mml-section" aria-labelledby="mml-list-title">
                            <div className="mml-section-head">
                                <h2 id="mml-list-title">{t("Your list", "Deine Liste")}</h2>
                                {selectedTab && <span>{selectedTab.count} Manga</span>}
                            </div>
                            <div className="mml-status" role="tablist" aria-label={t("List status", "Listenstatus")}>
                                {tabs.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={tab.value === status} aria-controls="mml-grid"
                                    onClick={() => setStoredStatus(tab.value)} data-manga-status={tab.value}>
                                    {t(tab.en, tab.de)}<span>{tab.count}</span>
                                </button>)}
                            </div>
                            <div ref={panelRef} id="mml-grid" role="tabpanel" aria-label={selectedTab ? t(selectedTab.en, selectedTab.de) : undefined}>
                                {entries.length > 0 ? <div className="mml-grid" data-manga-grid={status}>
                                        {entries.map(entry => {
                                            const state = unreadOf(entry)
                                            return <MangaCard key={entry.mediaId} entry={entry} blurAdult={blurAdult}
                                                latest={state.latest} fresh={showUnread && state.known ? state.unread : 0} />
                                        })}
                                    </div>
                                    : <div className="mml-empty" data-manga-status-empty>
                                        <p>{t("No manga match the filter", "Keine Manga passen zum Filter")}</p>
                                        <p>{t("The filter applies to every status.", "Der Filter gilt für alle Status.")}</p>
                                        <button type="button" className="mml-secondary" onClick={resetFilters}>{t("Reset filter", "Filter zurücksetzen")}</button>
                                    </div>}
                            </div>
                        </section>
                    </>}

        <PluginWebviewSlot slot="manga-screen-bottom" />

        <FilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} t={t} rawLists={rawLists} status={status}
            resultCount={entries.length} onReset={resetFilters} returnFocusRef={filterButtonRef} />
        <MangaSourceRefreshModal open={refreshOpen} onOpenChange={setRefreshOpen} job={refreshJob} returnFocusRef={refreshButtonRef} phone />
    </PageWrapper>
}

function LoadingState({ t }: { t: Translate }) {
    return <div className="mml-loading" aria-busy="true" role="status" aria-label={t("Loading manga", "Manga werden geladen")}>
        <span className="mml-bone mml-bone-head" />
        <span className="mml-bone mml-bone-continue" />
        <span className="mml-bone mml-bone-head" />
        <span className="mml-bone mml-bone-tabs" />
        <div className="mml-grid">
            {Array.from({ length: 6 }, (_, i) => <span key={i} className="mml-bone mml-bone-cover" />)}
        </div>
    </div>
}

function ContinueCard({ item, blurAdult, t, onContinue }: { item: MangaContinueItem, blurAdult: boolean, t: Translate, onContinue: (mediaId: number) => void }) {
    const { entry, progress, total, unread } = item
    const media = entry.media
    const title = media?.title?.userPreferred || ""
    const chapters = progress > 0 ? `${t("Chapter", "Kapitel")} ${progress}${total ? ` / ${total}` : ""}` : t("Reading started", "Lesen begonnen")
    const fresh = unread && unread > 0 ? `${unread} ${unread === 1 ? t("new chapter", "neues Kapitel") : t("new chapters", "neue Kapitel")}` : ""
    return <button type="button" className="mml-continue-card" onClick={() => onContinue(entry.mediaId)} data-manga-continue={entry.mediaId}
        aria-label={`${t("Continue reading", "Weiterlesen")}: ${title}, ${chapters}${fresh ? `, ${fresh}` : ""}`}>
        <span className="mml-continue-cover">
            <SeaImage src={getImageUrl(media?.coverImage?.large || media?.coverImage?.extraLarge || "")} alt="" fill sizes="6rem" className="mml-cover-image" />
            {blurAdult && media?.isAdult && <MediaEntryCardAdultVeil />}
        </span>
        <span className="mml-continue-text">
            <span className="mml-continue-title">{title}</span>
            <span className="mml-continue-meta">{chapters}</span>
            {!!total && <span className="mml-progress" aria-hidden><span style={{ transform: `scaleX(${Math.min(1, progress / total)})` }} /></span>}
            {fresh && <span className="mml-continue-new">{fresh}</span>}
            <span className="mml-continue-action"><LuBookOpen aria-hidden />{t("Continue", "Weiterlesen")}</span>
        </span>
    </button>
}

type CardProps = {
    entry: Manga_CollectionEntry
    blurAdult: boolean
    /** Newest chapter of the saved source, if known */
    latest: number | null
    /** New chapters to show on the cover (0 hides the badge) */
    fresh: number
}

/** Cover card for the grid; long-press keeps the desktop card's menu (preview and plugin actions). */
const MangaCard = React.memo(function MangaCard({ entry, blurAdult, latest, fresh }: CardProps) {
    const t = useTr()
    const media = entry.media
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    if (!media) return null
    const title = media.title?.userPreferred || ""
    const progress = entry.listData?.progress || 0
    const total = Math.max(media.chapters ?? 0, latest ?? 0)
    const meta = progress > 0 ? `${t("Ch.", "Kap.")} ${progress}${total ? ` / ${total}` : ""}`
        : media.chapters ? `${media.chapters} ${t("chapters", "Kapitel")}` : media.startDate?.year ? String(media.startDate.year) : ""
    const link = `/manga/entry?id=${entry.mediaId}`
    return <SeaContextMenu content={<ContextMenuGroup>
        <ContextMenuLabel className="text-[--muted] line-clamp-1 py-0 my-2">{title}</ContextMenuLabel>
        <ContextMenuItem onClick={() => setPreviewModalMediaId(media.id, "manga")}><LuEye /> {t("Preview", "Vorschau")}</ContextMenuItem>
        <PluginMediaCardContextMenuItems for="manga" media={media} />
    </ContextMenuGroup>}>
        <ContextMenuTrigger asChild>
            <SeaLink href={link} className="mml-card" data-manga-card={entry.mediaId} warmEntryOnViewport bypassEntryPreloadBudget>
                <span className="mml-card-cover">
                    <SeaImage src={getImageUrl(media.coverImage?.large || media.coverImage?.extraLarge || "")} alt="" fill sizes="40vw" className="mml-cover-image" />
                    {blurAdult && media.isAdult && <MediaEntryCardAdultVeil />}
                    {progress > 0 && total > 0 && entry.listData?.status !== "COMPLETED" &&
                        <span className="mml-card-progress" aria-hidden><span style={{ transform: `scaleX(${Math.min(1, progress / total)})` }} /></span>}
                    {fresh > 0 && <span className="mml-badge" data-manga-unread={fresh}>{fresh} {t("new", "neu")}</span>}
                </span>
                <span className="mml-card-title">{title}</span>
                {!!meta && <span className="mml-card-meta">{meta}</span>}
            </SeaLink>
        </ContextMenuTrigger>
    </SeaContextMenu>
})

function FilterSheet(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    t: Translate
    rawLists: Manga_CollectionList[] | undefined
    status: MangaPhoneStatus | null
    resultCount: number
    onReset: () => void
    returnFocusRef: React.RefObject<HTMLButtonElement | null>
}) {
    const { t, rawLists, status } = props
    const ts = useThemeSettings()
    const [params, setParams] = useAtom(__mangaLibrary_paramsAtom)
    const { mutate: updateTheme, isPending: savingTheme } = useUpdateTheme()
    const [pendingSort, setPendingSort] = React.useState<string>()
    const sorting = (savingTheme && pendingSort) || ts.mangaLibraryCollectionDefaultSorting || "TITLE"
    const genres = React.useMemo(() => props.open ? getMangaGenreCounts(rawLists, status) : [], [props.open, rawLists, status])
    const selectedGenres = params.genre ?? []

    const toggleGenre = (genre: string) => setParams(draft => {
        draft.genre = draft.genre?.includes(genre) ? draft.genre.filter(g => g !== genre) : [...(draft.genre ?? []), genre]
    })
    const setTheme = (patch: Record<string, unknown>) => updateTheme({ theme: { id: 0, ...ts, ...patch } as any })

    // The sheet itself takes focus on open: a focused select would show its ring and open the picker for nothing.
    // On close focus goes back to the filter button (the sheet has no Radix trigger to return to).
    return <Modal title={t("Filter & sort", "Filtern & sortieren")} open={props.open} onOpenChange={props.onOpenChange} contentClass="mml-sheet"
        onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.focus() }}
        onCloseAutoFocus={event => { event.preventDefault(); props.returnFocusRef.current?.focus() }}>
        <div className="mml-sheet-body" data-manga-filters>
            <div className="mml-sheet-group">
                <label htmlFor="mml-sort"><h3>{t("Sort by", "Sortieren nach")}</h3></label>
                <span className="mml-select-wrap">
                    <select id="mml-sort" className="mml-select" value={sorting} disabled={savingTheme} data-manga-sort
                        onChange={event => { setPendingSort(event.target.value); setTheme({ mangaLibraryCollectionDefaultSorting: event.target.value }) }}>
                        {MANGA_PHONE_SORTING_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.en, option.de)}</option>)}
                    </select>
                    <LuChevronDown aria-hidden />
                </span>
            </div>

            <div className="mml-rows">
                <button type="button" role="switch" aria-checked={!!params.unreadOnly} className="mml-check" data-manga-unread-only
                    aria-labelledby="mml-unread-only-label" aria-describedby="mml-unread-only-note"
                    onClick={() => setParams(draft => { draft.unreadOnly = !draft.unreadOnly })}>
                    <span className="mml-check-text">
                        <span id="mml-unread-only-label">{t("Only manga with new chapters", "Nur Manga mit neuen Kapiteln")}</span>
                        <small id="mml-unread-only-note">{t("A list without any keeps showing all its manga.", "Eine Liste ohne neue Kapitel zeigt weiter alle Manga.")}</small>
                    </span>
                    <span className="mml-toggle" aria-hidden />
                </button>
                <button type="button" role="switch" aria-checked={!!ts.showMangaUnreadCount} className="mml-check" disabled={savingTheme} data-manga-unread-count
                    onClick={() => setTheme({ showMangaUnreadCount: !ts.showMangaUnreadCount })}>
                    <span className="mml-check-text"><span>{t("Show new chapters on covers", "Neue Kapitel auf Covern zeigen")}</span></span>
                    <span className="mml-toggle" aria-hidden />
                </button>
            </div>

            {genres.length > 0 && <div className="mml-sheet-group">
                <div className="mml-sheet-head">
                    <h3>{t("Genres", "Genres")}</h3>
                    {selectedGenres.length > 0 && <button type="button" className="mml-text-action" onClick={() => setParams(draft => { draft.genre = [] })}>
                        {t("Clear", "Abwählen")}
                    </button>}
                </div>
                <p className="mml-sheet-note">{t("Manga must have every selected genre.", "Manga müssen alle gewählten Genres haben.")}</p>
                <div className="mml-genres" role="group" aria-label={t("Genres", "Genres")}>
                    {genres.map(({ genre, count }) => <button key={genre} type="button" aria-pressed={selectedGenres.includes(genre)}
                        onClick={() => toggleGenre(genre)} data-manga-genre={genre}>
                        {selectedGenres.includes(genre) && <LuCheck aria-hidden />}{genre}<span>{count}</span>
                    </button>)}
                </div>
            </div>}

            <div className="mml-sheet-actions">
                <button type="button" className="mml-secondary" onClick={props.onReset} disabled={!selectedGenres.length && !params.unreadOnly}>
                    {t("Reset", "Zurücksetzen")}
                </button>
                <button type="button" className="mml-primary" onClick={() => props.onOpenChange(false)} data-manga-filter-done>
                    {t(`Show ${props.resultCount} manga`, `${props.resultCount} Manga anzeigen`)}
                </button>
            </div>
        </div>
    </Modal>
}
