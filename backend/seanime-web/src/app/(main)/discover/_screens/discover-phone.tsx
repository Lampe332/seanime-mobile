import { AnilistListAnime_Variables } from "@/api/generated/endpoint.types"
import { AL_BaseAnime, AL_BaseManga, AL_ListAnime, AL_ListManga, AL_ListRecentAnime } from "@/api/generated/types"
import { SeaContextMenu } from "@/app/(main)/_features/context-menu/sea-context-menu"
import { useMediaPreviewModal } from "@/app/(main)/_features/media/_containers/media-preview-modal"
import {
    FORMAT_LABELS,
    MEDIA_STATUS_LABELS,
    offlineAware,
    PhoneChips,
    PhoneCoverCard,
    PhoneEmpty,
    PhoneHeader,
    PhoneIconLink,
    PhoneLoading,
    PhoneNotice,
    PhoneScreen,
    PhoneSection,
    PhoneTab,
    PhoneTabs,
    SEASON_LABELS,
    seasonYearLabel,
    useLastData,
    useNearViewport,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import { PluginMediaCardContextMenuItems } from "@/app/(main)/_features/plugin/actions/plugin-actions"
import { PluginWebviewSlot } from "@/app/(main)/_features/plugin/webview/plugin-webviews"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { __discord_pageTypeAtom } from "@/app/(main)/discover/_lib/discover.atoms"
import {
    airedAgoLabel,
    Airing,
    byMeanScore,
    discoverSeasons,
    DiscoverTab,
    episodeTag,
    genreLabel,
    latestAiredPerShow,
    listStatusLabel,
    pickDiscoverTab,
    pickSpotlight,
    recentWindow,
    scoreLabel,
    SeasonYear,
    seeAllLinks,
    withoutFeatured,
} from "@/app/(main)/discover/_lib/discover-phone"
import {
    useDiscoverEntry,
    useDiscoverSchedule,
    useDiscoverScrollMemory,
    usePhoneListAnime,
    usePhoneListManga,
    usePhoneMissedSequels,
    usePhoneRecentAiring,
} from "@/app/(main)/discover/_lib/discover-phone-hooks"
import { DiscoverPhoneSchedule, scheduleFactsLine } from "@/app/(main)/discover/_screens/discover-phone-schedule"
import { ADVANCED_SEARCH_MEDIA_GENRES } from "@/app/(main)/search/_lib/advanced-search-constants"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuTrigger } from "@/components/ui/context-menu"
import { cn } from "@/components/ui/core/styling"
import { appLanguageAtom, useTr } from "@/lib/app-language"
import { anilist_getCurrentEpisodes } from "@/lib/helpers/media"
import { useSearchParams } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { atom } from "jotai"
import { useAtom, useAtomValue } from "jotai/react"
import React from "react"
import { LuCalendarDays, LuEye, LuSearch } from "react-icons/lu"
import "./discover-phone.css"

type Media = AL_BaseAnime | AL_BaseManga
type MediaType = "anime" | "manga"
type DataHook = `data-${string}`

/** Phone-owned genre filters, one for the anime rows and one for the manga rows; Home's Discover atoms stay untouched. */
const animeGenreAtom = atom<string | null>(null)
const mangaGenreAtom = atom<string | null>(null)

/**
 * Android phone Discover tab: "What should I watch or read next?" A swipeable spotlight of what is trending, then rows of
 * covers that each lead to Search; the airing schedule as a day list; trending manga by country. The desktop page's
 * data-discover-page-* hooks sit on their phone counterparts for custom CSS and DOM plugins.
 */
export function DiscoverPhone() {
    const t = useTr()
    const language = useAtomValue(appLanguageAtom)
    const navigate = useNavigate()
    const serverStatus = useServerStatus()
    const mangaEnabled = !!serverStatus?.settings?.library?.enableManga
    const [pageType, setPageType] = useAtom(__discord_pageTypeAtom)
    const urlType = useSearchParams().get("type")
    // The page copies ?type= into the atom after its first render; that render reads the URL so it shows (and loads) the right tab.
    const firstRender = React.useRef(true)
    React.useEffect(() => { firstRender.current = false }, [])
    const tab = pickDiscoverTab(firstRender.current ? urlType ?? pageType : pageType, mangaEnabled)
    const schedule = useDiscoverSchedule(tab === "schedule")
    const { current } = React.useMemo(() => discoverSeasons(new Date()), [])
    useDiscoverScrollMemory(useLocation({ select: location => location.pathname === "/discover" ? location.state?.__TSR_key ?? location.state?.key ?? null : undefined }))

    const [seasonEn, seasonDe] = SEASON_LABELS[current.season]
    const facts = tab === "anime" ? t(`${seasonEn} ${current.year} season`, `${seasonDe}-Saison ${current.year}`)
        : tab === "manga" ? t("Trending manga, manhwa and manhua", "Angesagte Manga, Manhwa und Manhua")
            : scheduleFactsLine(t, schedule)

    const tabs: PhoneTab[] = [
        { value: "anime", label: "Anime", name: "Anime" },
        { value: "schedule", label: t("Schedule", "Sendeplan"), name: "Schedule" },
        ...(mangaEnabled ? [{ value: "manga", label: "Manga", name: "Manga" }] : []),
    ]
    // The tab also goes into the URL, replaced and without scrolling to the top: Back still leaves the page, and returning
    // from an entry restores the tab instead of the ?type= the page was opened with.
    const selectTab = (value: string) => {
        setPageType(value as DiscoverTab)
        void navigate({ to: "/discover", search: { type: value as DiscoverTab }, replace: true, resetScroll: false })
    }
    const panelHook = { [`data-discover-page-${tab}-container`]: true } as Record<DataHook, boolean>

    return <PhoneScreen screen="discover" data-discover-phone="true" data-discover-page-container>
        <PhoneHeader title={t("Discover", "Entdecken")} facts={facts}>
            <PhoneIconLink href={tab === "manga" ? "/search?type=manga" : "/search"} data-discover-search
                label={tab === "manga" ? t("Search manga", "Manga suchen") : t("Search anime", "Anime suchen")}>
                <LuSearch aria-hidden />
            </PhoneIconLink>
            {tab !== "manga" && <PhoneIconLink href="/schedule" label={t("Open calendar", "Kalender öffnen")} data-discover-calendar>
                <LuCalendarDays aria-hidden />
            </PhoneIconLink>}
        </PhoneHeader>
        <PhoneTabs variant="segment" label={t("What do you want to discover?", "Was möchtest du entdecken?")} tabs={tabs} value={tab} onChange={selectTab}
            controls="pd-panel" data-discover-tabs data-tab-count={tabs.length} data-language={language} data-discover-page-header-tabs-container />
        <PluginWebviewSlot slot="after-discover-screen-header" />
        <div id="pd-panel" className="pd-panel" role="tabpanel" aria-label={tabs.find(item => item.value === tab)?.label} {...panelHook}>
            {tab === "anime" ? <AnimeTab /> : tab === "schedule" ? <DiscoverPhoneSchedule schedule={schedule} /> : <MangaTab />}
        </div>
    </PhoneScreen>
}

/**
 * The anime rows. The genre-aware ones come first, right under the chips (spotlight, trending, both season rows); the
 * rest (aired, missed, coming soon, movies) shows every genre.
 */
function AnimeTab() {
    const t = useTr()
    const [genre, setGenre] = useAtom(animeGenreAtom)
    const seasons = React.useMemo(() => discoverSeasons(new Date()), [])
    const blurAdult = !!useServerStatus()?.settings?.anilist?.blurAdultContent
    const trending = useRowItems(usePhoneListAnime({ page: 1, perPage: 20, sort: ["TRENDING_DESC"], genres: genre ? [genre] : undefined }, true), mediaOf)
    const [recentRange] = React.useState(() => recentWindow(Date.now()))
    const recent = useRowItems(usePhoneRecentAiring({ page: 1, perPage: 50, ...recentRange }, true), recentOf)
    const spotlight = React.useMemo(() => pickSpotlight(trending.items, { hideAdult: blurAdult, skipUnreleased: true }), [trending.items, blurAdult])
    const rest = React.useMemo(() => withoutFeatured(trending.items, spotlight), [trending.items, spotlight])
    const qualifier = genre ? genreLabel(t, genre) : undefined
    const clearGenre = () => setGenre(null)

    // AniList, the server or the connection is down when both rows of the first screen fail: one notice, not a wall of them.
    // With a genre chosen the chips stay, so "All" (often still cached) is one tap away.
    if (unavailable(trending) && unavailable(recent)) return <>
        {!!genre && <GenreChips genre={genre} onChange={setGenre} />}
        <TabNotice offline={trending.offline || recent.offline} retry={() => {
            trending.retry()
            recent.retry()
        }} />
    </>

    const [seasonEn, seasonDe] = SEASON_LABELS[seasons.current.season]
    const [lastEn, lastDe] = SEASON_LABELS[seasons.previous.season]
    return <>
        <GenreChips genre={genre} onChange={setGenre} />
        <Spotlight key={genre ?? ALL} items={spotlight} type="anime" loading={spotlightLoading(trending, spotlight)} stale={trending.stale} />
        <DiscoverRow block="trending" hook="data-discover-page-anime-trending-container" title={t("Trending now", "Gerade angesagt")} qualifier={qualifier}
            seeAll={seeAllLinks.trending(genre)} row={{ ...trending, items: rest }} genre={genre} onClearGenre={clearGenre}
            empty={t("Nothing is trending right now.", "Gerade ist nichts angesagt.")}>
            {rest?.map(media => <DiscoverCover key={media.id} media={media} type="anime" />)}
        </DiscoverRow>
        <SeasonBlock block="season" season={seasons.current} genre={genre} onClearGenre={clearGenre}
            title={t(`Top of ${seasonEn} ${seasons.current.year}`, `Bestbewertet im ${seasonDe} ${seasons.current.year}`)} />
        <SeasonBlock block="last-season" season={seasons.previous} genre={genre} onClearGenre={clearGenre}
            title={t(`Best of ${lastEn} ${seasons.previous.year}`, `Bestbewertet im ${lastDe} ${seasons.previous.year}`)} />
        <RecentBlock row={recent} />
        <MissedBlock />
        <LazyAnimeBlock block="upcoming" hook="data-discover-page-anime-upcoming-container" title={t("Coming soon", "Demnächst")} seeAll={seeAllLinks.upcoming()}
            variables={UPCOMING} empty={t("No announced anime right now.", "Gerade sind keine Anime angekündigt.")} />
        <LazyAnimeBlock block="movies" hook="data-discover-page-anime-trending-movies-container" title={t("Trending movies", "Angesagte Filme")}
            seeAll={seeAllLinks.movies()} variables={MOVIES} empty={t("No movies are trending right now.", "Gerade sind keine Filme angesagt.")} />
    </>
}

const UPCOMING: AnilistListAnime_Variables = { page: 1, perPage: 20, sort: ["TRENDING_DESC"], status: ["NOT_YET_RELEASED"] }
const MOVIES: AnilistListAnime_Variables = { page: 1, perPage: 20, format: "MOVIE", sort: ["TRENDING_DESC"], status: ["RELEASING", "FINISHED"] }

// A plugin can turn the server's answer into null: no titles, not a crash.
const mediaOf = (data: AL_ListAnime | AL_ListManga | null) => (data?.Page?.media?.filter(Boolean) ?? []) as Media[]
const recentOf = (data: AL_ListRecentAnime | null) => latestAiredPerShow(data?.Page?.airingSchedules)
const missedOf = (data: AL_BaseAnime[] | null) => (data ?? []).filter(Boolean) as Media[]
const sortedByScore = (data: AL_ListAnime | null) => byMeanScore(mediaOf(data))

/** Top of this season / best of last season: score-sorted with the score under each cover, by the shared genre, loaded when near the screen. */
function SeasonBlock({ block, season, genre, onClearGenre, title }: {
    block: string
    season: SeasonYear
    genre: string | null
    onClearGenre: () => void
    title: string
}) {
    const t = useTr()
    const [ref, near] = useNearViewport<HTMLDivElement>()
    const row = useRowItems(usePhoneListAnime({
        page: 1, perPage: 20, sort: ["SCORE_DESC"], season: season.season, seasonYear: season.year, genres: genre ? [genre] : undefined,
    }, near), sortedByScore)
    return <div ref={ref} className="pd-block">
        <DiscoverRow block={block} hook="data-discover-page-anime-highest-rated-container" title={title} qualifier={genre ? genreLabel(t, genre) : undefined}
            seeAll={seeAllLinks.season(season, genre)} row={row} genre={genre} onClearGenre={onClearGenre}
            empty={t("No rated anime for this season yet.", "Für diese Saison gibt es noch keine bewerteten Anime.")}>
            {row.items?.map(media => <DiscoverCover key={media.id} media={media} type="anime" line="score" />)}
        </DiscoverRow>
    </div>
}

/** Coming soon and trending movies: no genre, loaded when near the screen. */
function LazyAnimeBlock({ block, hook, title, seeAll, variables, empty }: {
    block: string
    hook: DataHook
    title: string
    seeAll: string
    variables: AnilistListAnime_Variables
    empty: string
}) {
    const [ref, near] = useNearViewport<HTMLDivElement>()
    const row = useRowItems(usePhoneListAnime(variables, near), mediaOf)
    return <div ref={ref} className="pd-block">
        <DiscoverRow block={block} hook={hook} title={title} seeAll={seeAll} row={row} empty={empty}>
            {row.items?.map(media => <DiscoverCover key={media.id} media={media} type="anime" releaseMark={block !== "upcoming"} />)}
        </DiscoverRow>
    </div>
}

/**
 * Episodes of the last 14 days, one card per show; hidden when nothing aired. No "See all": the calendar (in the header)
 * shows the user's list by default, not this row.
 */
function RecentBlock({ row }: { row: RowItems<Airing> }) {
    const t = useTr()
    if (row.items && !row.items.length) return null
    const now = Date.now()
    return <DiscoverRow block="recent" title={t("Aired recently", "Kürzlich ausgestrahlt")} row={row} empty="">
        {row.items?.map(item => <DiscoverCover key={item.media!.id} media={item.media!} type="anime" tag={episodeTag(t, item)}
            after={airedAgoLabel(t, item.airingAt, now)} />)}
    </DiscoverRow>
}

/**
 * Sequels to finished or paused anime that are not on the list yet. Asked for at once (the server keeps the answer for
 * hours) and shown only with titles, as on the desktop: no heading that disappears again while the user scrolls to it.
 */
function MissedBlock() {
    const t = useTr()
    const row = useRowItems(usePhoneMissedSequels(true), missedOf)
    if (!row.failed && !row.offline && !row.items?.length) return null
    return <DiscoverRow block="missed" hook="data-discover-missed-sequels-container" title={t("You might have missed", "Vielleicht verpasst")} row={row} empty=""
        note={t("Sequels to anime on your list that you have not added yet.", "Fortsetzungen von Anime auf deiner Liste, die dort noch fehlen.")}>
        {row.items?.map(media => <DiscoverCover key={media.id} media={media} type="anime" />)}
    </DiscoverRow>
}

function MangaTab() {
    const [genre, setGenre] = useAtom(mangaGenreAtom)
    const blurAdult = !!useServerStatus()?.settings?.anilist?.blurAdultContent
    const jp = useMangaRow("JP", genre, true)
    const spotlight = React.useMemo(() => pickSpotlight(jp.items, { hideAdult: blurAdult }), [jp.items, blurAdult])
    const rest = React.useMemo(() => withoutFeatured(jp.items, spotlight), [jp.items, spotlight])
    const clearGenre = () => setGenre(null)
    return <>
        <GenreChips genre={genre} onChange={setGenre} />
        <Spotlight key={genre ?? ALL} items={spotlight} type="manga" loading={spotlightLoading(jp, spotlight)} stale={jp.stale} />
        <MangaRow country="JP" genre={genre} row={{ ...jp, items: rest }} onClearGenre={clearGenre} />
        <LazyMangaRow country="KR" genre={genre} onClearGenre={clearGenre} />
        <LazyMangaRow country="CN" genre={genre} onClearGenre={clearGenre} />
    </>
}

function useMangaRow(country: string, genre: string | null, enabled: boolean) {
    return useRowItems(usePhoneListManga({ page: 1, perPage: 20, sort: ["TRENDING_DESC"], countryOfOrigin: country, genres: genre ? [genre] : undefined },
        enabled), mediaOf)
}

const MANGA_ROWS: Record<string, { block: string, hook: DataHook, title: [string, string] }> = {
    JP: { block: "manga-jp", hook: "data-discover-page-manga-trending-container", title: ["Trending manga", "Angesagte Manga"] },
    KR: { block: "manga-kr", hook: "data-discover-page-manga-trending-manhwa-container", title: ["Trending manhwa", "Angesagte Manhwa"] },
    CN: { block: "manga-cn", hook: "data-discover-page-manga-trending-manhua-container", title: ["Trending manhua", "Angesagte Manhua"] },
}

function MangaRow({ country, genre, row, onClearGenre }: { country: string, genre: string | null, row: RowItems, onClearGenre: () => void }) {
    const t = useTr()
    const { block, hook, title } = MANGA_ROWS[country]
    return <DiscoverRow block={block} hook={hook} title={t(...title)} qualifier={genre ? genreLabel(t, genre) : undefined} seeAll={seeAllLinks.manga(country, genre)}
        row={row} genre={genre} onClearGenre={onClearGenre} empty={t("Nothing is trending here right now.", "Hier ist gerade nichts angesagt.")}>
        {row.items?.map(media => <DiscoverCover key={media.id} media={media} type="manga" />)}
    </DiscoverRow>
}

function LazyMangaRow({ country, genre, onClearGenre }: { country: string, genre: string | null, onClearGenre: () => void }) {
    const [ref, near] = useNearViewport<HTMLDivElement>()
    const row = useMangaRow(country, genre, near)
    return <div ref={ref} className="pd-block"><MangaRow country={country} genre={genre} row={row} onClearGenre={onClearGenre} /></div>
}

type RowItems<T = Media> = {
    /** The items to show; undefined while there is nothing yet, or the row failed */
    items: T[] | undefined
    /** The items are the last genre's, dimmed until the new genre arrives */
    stale: boolean
    failed: boolean
    /** React Query holds the request until the connection is back */
    offline: boolean
    retry: () => void
}

type RowQuery<D> = { data: D | undefined, isError: boolean, isFetching: boolean, isPaused: boolean, refetch: () => unknown }

/**
 * A row's state: bones until the first answer, the last genre's items (dimmed) while the next genre loads, the notice
 * when the request failed (bones again while it is retried) or waits for the connection.
 */
function useRowItems<D, T>(query: RowQuery<D>, select: (data: D | null) => T[]): RowItems<T> {
    const last = useLastData(query.data)
    // `select` is a module-level function per row; the items only change with the data.
    const items = React.useMemo(() => last === undefined ? undefined : select(last ?? null), [last])
    const waiting = query.data === undefined
    const failed = waiting && query.isError && !query.isFetching
    const offline = waiting && query.isPaused
    return {
        items: failed || offline ? undefined : items,
        stale: waiting && !failed && !offline && items !== undefined,
        failed,
        offline,
        retry: () => void query.refetch(),
    }
}

const unavailable = (row: RowItems<unknown>) => row.failed || row.offline

/** Bones while the trending titles load, also while a new genre loads after one without titles. */
const spotlightLoading = (row: RowItems, spotlight: Media[]) => !unavailable(row) && (!row.items || (row.stale && !spotlight.length))

/** One section of covers with its "See all" link, row bones, failure notice or empty state. */
function DiscoverRow<T>({ block, hook, title, qualifier, note, seeAll, row, empty, genre, onClearGenre, children }: {
    block: string
    /** The desktop page's data-* hook of this row */
    hook?: DataHook
    title: string
    /** The active genre, quiet next to the title */
    qualifier?: string
    note?: string
    seeAll?: string
    row: RowItems<T>
    empty: string
    /** With a genre, an empty row offers to show all genres */
    genre?: string | null
    onClearGenre?: () => void
    children?: React.ReactNode
}) {
    const t = useTr()
    const hooks = hook ? { [hook]: true } as Record<DataHook, boolean> : undefined
    return <PhoneSection id={`pd-${block}`} title={title} count={qualifier} note={note} data-discover-block={block} {...hooks}
        action={seeAll && <SeaLink href={seeAll} className="ps-text-action" aria-label={`${t("See all", "Alle anzeigen")}: ${title}`} data-discover-see-all={block}>
            {t("See all", "Alle anzeigen")}
        </SeaLink>}>
        {row.failed ? <PhoneNotice text={offlineAware(t, ["Couldn't load this row.", "Diese Reihe konnte nicht geladen werden."],
                ["No internet connection, so this row couldn't load.", "Keine Internetverbindung, deshalb konnte diese Reihe nicht geladen werden."])} data-discover-row-error>
                <button type="button" className="ps-text-action" onClick={row.retry}>{t("Try again", "Erneut versuchen")}</button>
            </PhoneNotice>
            : row.offline ? <PhoneNotice data-discover-row-offline text={t("No internet connection. This row loads when you're back online.",
                "Keine Internetverbindung. Die Reihe lädt, sobald du wieder online bist.")} />
                : !row.items || (row.stale && !row.items.length) ? <PhoneLoading label={`${title}: ${t("loading", "wird geladen")}`} layout={["cover-row"]} />
                    : !row.items.length ? genre && onClearGenre ? <GenreEmpty onClear={onClearGenre} />
                            : <p className="pd-quiet" data-discover-row-empty>{empty}</p>
                        // A new genre starts the row at its first cover again.
                        : <div key={qualifier} className={cn("ps-row", row.stale && "pd-stale")} aria-busy={row.stale || undefined}>{children}</div>}
    </PhoneSection>
}

/** A genre hides every title of a row: say so and offer all genres again, right where the user looks. */
function GenreEmpty({ onClear }: { onClear: () => void }) {
    const t = useTr()
    return <PhoneEmpty data-discover-row-empty title={t("Nothing in this genre here", "In diesem Genre gibt es hier nichts")}
        text={t("Pick another genre above, or show all genres.", "Wähle oben ein anderes Genre oder zeige alle Genres.")}>
        <button type="button" className="ps-secondary" onClick={onClear} data-discover-all-genres>{t("All genres", "Alle Genres")}</button>
    </PhoneEmpty>
}

/** Discover as a whole did not load: one notice with one Try again, and the way to the downloads. */
function TabNotice({ offline, retry }: { offline: boolean, retry: () => void }) {
    const t = useTr()
    return <PhoneNotice data-discover-tab-error text={offline
        ? t("No internet connection. Discover loads when you're back online.", "Keine Internetverbindung. Entdecken lädt, sobald du wieder online bist.")
        : offlineAware(t, ["Discover couldn't be loaded.", "Entdecken konnte nicht geladen werden."],
            ["No internet connection, so Discover couldn't be loaded.", "Keine Internetverbindung, deshalb konnte Entdecken nicht geladen werden."])}>
        {!offline && <button type="button" className="ps-text-action" onClick={retry}>{t("Try again", "Erneut versuchen")}</button>}
        <SeaLink href="/android-downloads?kind=anime" className="ps-text-action" data-discover-downloads>{t("Watch downloads", "Downloads ansehen")}</SeaLink>
    </PhoneNotice>
}

const ALL = "all"

/** One genre for every genre-aware row; tapping the chosen genre again goes back to All. */
function GenreChips({ genre, onChange }: { genre: string | null, onChange: (genre: string | null) => void }) {
    const t = useTr()
    const ref = React.useRef<HTMLDivElement>(null)
    // A genre kept from an earlier visit may sit far right in the row: scroll it into view, without moving the page.
    React.useLayoutEffect(() => {
        const chip = ref.current?.querySelector<HTMLElement>("[aria-pressed=\"true\"]")
        const row = chip?.parentElement
        if (chip && row && genre) row.scrollLeft = chip.offsetLeft - row.offsetLeft - 16
    }, [])
    const chips = [{ value: ALL, label: t("All", "Alle") }, ...ADVANCED_SEARCH_MEDIA_GENRES.map(value => ({ value, label: genreLabel(t, value) }))]
    return <div ref={ref} className="pd-block">
        <PhoneChips label={t("Genre", "Genre")} chips={chips} selected={[genre ?? ALL]} data-discover-genres
            onToggle={value => onChange(value === ALL || value === genre ? null : value)} />
    </div>
}

/** The first trending titles as wide picture cards; swipe for the next. */
function Spotlight({ items, type, loading, stale }: { items: Media[], type: MediaType, loading: boolean, stale: boolean }) {
    const t = useTr()
    if (loading) return <PhoneLoading label={t("Loading the spotlight", "„Im Fokus“ wird geladen")} layout={["feature"]} />
    if (!items.length) return null
    // The desktop hero's hooks name the medium it shows: here the first card, the one in view.
    return <section className={cn(stale && "pd-stale")} aria-label={t("Spotlight", "Im Fokus")} aria-busy={stale || undefined} data-discover-spotlight
        data-discover-page-header data-media-id={items[0].id} data-media-mal-id={items[0].idMal ?? undefined}>
        <div className="ps-features">
            {items.map(media => <FeatureCard key={media.id} media={media} type={type} />)}
        </div>
    </section>
}

/**
 * A spotlight card: banner (or the cover's upper part), title, "Fall 2026 · TV · 82%" (manga: the format only when it is
 * not plain manga); long press opens the card menu like a cover's.
 */
const FeatureCard = React.memo(function FeatureCard({ media, type }: { media: Media, type: MediaType }) {
    const t = useTr()
    const serverStatus = useServerStatus()
    const offline = !!serverStatus?.isOffline
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    const title = media.title?.userPreferred || media.title?.romaji || media.title?.english || ""
    const format = media.format && !(type === "manga" && media.format === "MANGA") ? FORMAT_LABELS[media.format] : undefined
    const meta = [seasonYearLabel(t, media), format ? t(...format) : "", scoreLabel(t, media.meanScore)].filter(Boolean).join(" · ")
    const href = offline ? `/offline/entry/${type}?id=${media.id}` : type === "manga" ? `/manga/entry?id=${media.id}` : `/entry?id=${media.id}`
    return <SeaContextMenu content={<ContextMenuGroup>
        <ContextMenuLabel className="text-[--muted] line-clamp-1 py-0 my-2">{title}</ContextMenuLabel>
        {!offline && <ContextMenuItem onClick={() => setPreviewModalMediaId(media.id, type)}><LuEye /> {t("Preview", "Vorschau")}</ContextMenuItem>}
        <PluginMediaCardContextMenuItems for={type} media={media} />
    </ContextMenuGroup>}>
        <ContextMenuTrigger asChild>
            {/* data-media-entry-card-body: DOM plugins (the dub badge) mark cards through it, as on MediaEntryCard */}
            <SeaLink href={href} className="ps-feature" data-discover-feature={media.id} data-media-id={media.id} data-media-mal-id={media.idMal ?? undefined}
                data-media-type={type} data-media-entry-card-body="true" data-cover-fallback={!media.bannerImage || undefined}>
                <SeaImage src={getImageUrl(media.bannerImage || media.coverImage?.extraLarge || media.coverImage?.large || "")} alt="" fill sizes="22rem"
                    className="ps-feature-image" />
                <span className="ps-feature-title">{title}</span>
                {!!meta && <span className="ps-feature-meta">{meta}</span>}
            </SeaLink>
        </ContextMenuTrigger>
    </SeaContextMenu>
})

/**
 * A cover of the rows, with what MediaEntryCard shows on the phone in the kit's two marks: top right new episodes (with
 * the theme's unwatched count) or that the title is in the library, bottom left the episode (aired rows) or whether it
 * is airing or upcoming. Under the title the list status in the accent, else season and year (manga: start year; season
 * rows: the score they are sorted by).
 */
const DiscoverCover = React.memo(function DiscoverCover({ media, type, tag, after, line = "season", releaseMark = true }: {
    media: Media
    type: MediaType
    /** Bottom-left mark instead of the release status (aired rows: the episode) */
    tag?: string
    /** After the list status (aired rows: how long ago); the card's name then lists every part */
    after?: string
    line?: "season" | "score"
    /** Off where the row says it already (Coming soon) */
    releaseMark?: boolean
}) {
    const t = useTr()
    const serverStatus = useServerStatus()
    const { showAnimeUnwatchedCount } = useThemeSettings()
    const { listData, libraryData } = useDiscoverEntry(type, media.id)
    const status = listStatusLabel(t, type, listData?.status)
    const title = media.title?.userPreferred || media.title?.romaji || media.title?.english || ""
    const fallback = line === "score" ? scoreLabel(t, media.meanScore) : type === "manga" ? String(media.startDate?.year ?? "") : seasonYearLabel(t, media)
    const total = type === "anime" ? (media as AL_BaseAnime).episodes : (media as AL_BaseManga).chapters
    const watching = listData?.status === "CURRENT" || listData?.status === "REPEATING"
    // As MediaEntryCard's unwatched badge: the library's count when the files are there, else the aired episodes not seen.
    const fresh = type === "anime" && watching && showAnimeUnwatchedCount ? (libraryData?.mainFileCount ? libraryData.unwatchedCount
        : Math.max(0, anilist_getCurrentEpisodes(media as AL_BaseAnime) - (listData?.progress ?? 0))) : 0
    const badge = fresh > 0 ? t(`${fresh} new`, `${fresh} neu`) : libraryData?.mainFileCount ? t("In library", "In Bibliothek") : undefined
    const release = releaseMark && media.status && (media.status === "RELEASING" || media.status === "NOT_YET_RELEASED") ? t(...MEDIA_STATUS_LABELS[media.status]) : undefined
    const meta = after ? <>{!!status && <><span className="pd-status">{status}</span> · </>}{after}</> : status || fallback
    return <PhoneCoverCard media={media} type={type} offline={!!serverStatus?.isOffline} blurAdult={!!serverStatus?.settings?.anilist?.blurAdultContent}
        badge={badge} tag={tag ?? release} meta={meta} metaTone={!after && status ? "accent" : undefined} listData={listData} warm={!!listData}
        label={after ? [title, tag, status, after].filter(Boolean).join(", ") : undefined}
        progress={listData?.progress && listData.status !== "COMPLETED" ? { value: listData.progress, total: total ?? 0 } : undefined}
        // As on MediaEntryCard, for DOM plugins: the dub badge marks [data-media-entry-card-body], MAL sync reads the MAL id.
        data-media-mal-id={media.idMal ?? undefined} data-media-entry-card-body-link="true" data-media-entry-card-body="true" />
})
