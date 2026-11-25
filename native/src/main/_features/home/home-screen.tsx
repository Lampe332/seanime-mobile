import type { AL_AnimeCollection_MediaListCollection_Lists, AL_BaseAnime, AL_BaseManga, Anime_LibraryCollectionList, Manga_CollectionList, Models_HomeItem } from "@/api/generated/types"
import { useAnilistListAnime, useAnilistListMissedSequels, useAnilistListRecentAiringAnime, useGetRawAnimeCollection } from "@/api/hooks/anilist.hooks"
import { useGetLibraryCollection } from "@/api/hooks/anime_collection.hooks"
import { useAnilistListManga, useGetMangaSourceRefresh, useGetRawAnilistMangaCollection } from "@/api/hooks/manga.hooks"
import { MangaSourceRefreshSheet } from "@/main/manga/_components/manga-source-refresh-sheet"
import { useGetHomeItems, useUpdateHomeItems } from "@/api/hooks/status.hooks"
import { useUpdateTheme } from "@/api/hooks/theme.hooks"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { usePageBottomPad } from "@/components/shared/phone-screen"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover/popover"
import { SectionTitle, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { getLibraryCollectionTitle, getMangaCollectionTitle } from "@/lib/server/utils"
import { colors } from "@/lib/theme/tokens"
import { usePalette, useThemeColors } from "@/lib/theme/appearance"
import { accentGlow } from "@/lib/theme/palette"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { __anilist_userAnimeMediaAtom } from "@/main/_atoms/anilist.atoms"
import { ContinueWatching } from "@/main/_features/anime-library/_containers/continue-watching"
import { useContinueWatchingWidget } from "@/lib/widget/continue-widget-task"
import { LibraryView } from "@/main/_features/anime-library/_containers/library-collection"
import { useHandleDetailedLibraryCollection } from "@/main/_features/anime-library/_lib/handle-detailed-library-collection"
import { type HandleLibraryCollectionProps, useHandleLibraryCollection } from "@/main/_features/anime-library/_lib/handle-library-collection"
import {
    HiddenMediaPhoneSheet,
    IgnoredFilesPhoneSheet,
    LibraryPhoneAction,
    LibraryPhoneAttention,
    UnmatchedPhoneSheet,
} from "@/main/_features/anime-library/_screens/library-phone"
import { __scanner_modalIsOpen } from "@/main/_features/anime-library/library-phone.atoms"
import { MediaCardRow, MediaCardRowSkeleton } from "@/main/_features/media/_components/media-card-row"
import { MediaEntryCard } from "@/main/_features/media/_components/media-entry-card"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useHandleUserAnilistLists } from "@/main/lists/_lib/handle-user-anilist-lists"
import { __mangaLibrary_paramsAtom, useHandleMangaCollection } from "@/main/manga/_lib/handle-manga-collection"
import { addSeconds } from "date-fns/addSeconds"
import { formatDistanceToNow } from "date-fns/formatDistanceToNow"
import { subDays } from "date-fns/subDays"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { usePlaylistEditorManager } from "@/main/_features/playlists/lib/playlist-editor-manager"
import BookOpenCheck from "lucide-react-native/icons/book-open-check"
import Eye from "lucide-react-native/icons/eye"
import EyeOff from "lucide-react-native/icons/eye-off"
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical"
import Plus from "lucide-react-native/icons/plus"
import Puzzle from "lucide-react-native/icons/puzzle"
import RefreshCcw from "lucide-react-native/icons/refresh-ccw"
import Search from "lucide-react-native/icons/search"
import Settings2 from "lucide-react-native/icons/settings-2"
import { VideoLibraryIcon } from "@/components/shared/legacy-icons"
import React from "react"
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native"
import { usePluginActions, useRunPluginAction } from "@/main/_features/plugin/plugin-actions"
import { PluginTrayButton } from "@/main/_features/plugin/plugin-tray"
import { PluginWebviewSlot } from "@/main/_features/plugin/plugin-webview"
import { HomeDiscoverFeature, homeScrollHandlers, LibraryUpcomingEpisodes } from "./home-discover-sections"
import { HomeMobileHeader, HomeHeaderAction, SearchHeadAction } from "./home-mobile-header"
import { customizeInHomeHead } from "@/lib/nav/more-panel"
import { AnilistSyncBar } from "@/main/_features/anilist-sync/anilist-sync"
import { HomeScheduleCalendar } from "./home-schedule-calendar"
import { carouselEmptyCause, HOME_ITEMS_PENDING, hasSectionGapBefore, resetCarouselOptions, resolveHomeItems, withCurrentSchema } from "./home-layout"
import { carouselDefaultName, homeOptionLabel } from "./home-section-info"
import { __home_settingsModalOpen, HomeSettingsSheet } from "./home-settings-sheet"
import { isAnimeLibraryItemsOnly } from "./home-items.utils"
import { MyShowsRow } from "./my-shows-row"

/*
 * Android Home (home-screen.tsx + home-mobile.css): the head with its actions, then the saved sections in their order.
 * One faint, static theme-colour tint runs from the head into Home (no seam, image, blur or scroll work).
 *
 * Header actions: Search (4.2.0), Plugins with the pinned plugins (2.17, the top navbar's PluginSidebarTray), Playlists (while
 * the library has entries, 2.14), the local library and Customize (in More on a narrow phone, customizeInHomeHead). The plugin slots `after-home-screen-toolbar` (under the head) and
 * `home-screen-bottom` (after the sections) show plugin pages (2.17).
 */
export function HomeScreen() {
    usePalette()
    const t = useTr()
    const serverStatus = useServerStatus()
    const window = useWindowDimensions()
    const barHeight = useNavBarHeight()
    const { rail } = useTabletLayout()
    const pageBottom = usePageBottomPad(rail ? 32 : barHeight + 32)
    const { data: savedItems, isLoading: loadingItems, isError: itemsError, refetch: retryItems } = useGetHomeItems()
    const { isError: collectionError, refetch: retryCollection } = useGetLibraryCollection()
    const library = useHandleLibraryCollection()
    // the home screen widget shows the same "Continue watching" list
    useContinueWatchingWidget(library.continueWatchingList, !library.isLoading && !collectionError)
    // Keeps the manga collection (and its chapter-number atoms) loaded while Home is open
    useHandleMangaCollection()
    const homeItems = React.useMemo(() => resolveHomeItems(savedItems), [savedItems])
    const hasLibraryPath = !!serverStatus?.settings?.library?.libraryPath

    // Search floats out of the default bar (4.2.0): its magnifier leads the head. A phone too narrow for all five icons
    // lists Customize in More instead (customizeInHomeHead)
    const actions = (
        <>
            <SearchHeadAction href="/search" />
            <PluginTrayButton variant="home" />
            {library.hasEntries && <PlaylistsAction />}
            {!library.isNakamaLibrary && hasLibraryPath && <LibraryPhoneAction />}
            {customizeInHomeHead({ rail, windowWidth: window.width }) && <CustomizeAction />}
        </>
    )

    let body: React.ReactNode
    if (itemsError || (collectionError && !library.hasEntries)) {
        body = (
            <View accessibilityRole="alert" className="mx-4 my-3 rounded-surface bg-sm-surface p-5">
                <SectionTitle>{t("Home could not load", "Startseite konnte nicht geladen werden")}</SectionTitle>
                <Text className="mb-4 mt-2 leading-[22px] text-sm-text-muted">{t("Your saved layout is still available. Try loading it again.", "Deine gespeicherte Anordnung bleibt erhalten. Versuche es erneut.")}</Text>
                <Button wrapperClassName="self-start" onPress={() => { void retryItems(); void retryCollection() }}>{t("Try again", "Erneut versuchen")}</Button>
            </View>
        )
    } else if (library.isLoading || loadingItems) {
        body = (
            <View accessibilityLabel={t("Loading Home", "Startseite wird geladen")} accessibilityState={{ busy: true }} className="mx-4 my-3 rounded-surface bg-sm-surface p-5">
                <View className="mb-4 h-8 w-40 rounded-ui bg-sm-surface-raised" />
                <View className="h-48 rounded-xl bg-sm-surface-raised" />
            </View>
        )
    } else if (homeItems.length === 0) {
        body = <NoSections />
    } else if (!library.hasEntries && isAnimeLibraryItemsOnly(homeItems)) {
        body = <EmptyHome />
    } else {
        body = (
            <View className="pb-10">
                {/* The discover header shows only as the first section, above all others */}
                {homeItems[0]?.type === "discover-header" && <HomeDiscoverFeature />}
                <MyShowsRow className="pb-6 pt-3" />
                {homeItems.filter(item => item.type !== "discover-header" && item.type !== "anime-continue-watching-header").map((item, index) => (
                    <React.Fragment key={item.id}>
                        {hasSectionGapBefore(item.type, index) && <View className="h-6" />}
                        <HomeScreenItem item={item} index={homeItems.findIndex(i => i.id === item.id)} library={library} />
                    </React.Fragment>
                ))}
                <View className="h-6" />
            </View>
        )
    }

    // Header .16 → .11 and Home .11 → transparent over 40rem, as one gradient from the top of the screen
    const head = 110
    const tint = accentGlow([[0.16, 0], [0.11, head], [0.085, head + 115], [0.055, head + 256], [0.028, head + 397], [0.01, head + 525]], head + 640)

    return (
        <>
            <ScrollView
                {...homeScrollHandlers}
                className="flex-1"
                contentContainerStyle={{ minHeight: window.height, paddingBottom: pageBottom, ...(!rail && tint ? { backgroundImage: tint } : null) }}
            >
                <HomeMobileHeader actions={actions} />
                <View className={cn("w-full px-4", !rail && "max-w-[1152px] self-center")}>
                    <AnilistSyncBar className="pb-2" />
                    <PluginWebviewSlot slot="after-home-screen-toolbar" />
                    {!library.isNakamaLibrary && hasLibraryPath && <View className="pt-2"><LibraryPhoneAttention /></View>}
                    {body}
                    <PluginWebviewSlot slot="home-screen-bottom" />
                </View>
            </ScrollView>
            <HomeSettingsSheet />
            <UnmatchedPhoneSheet unmatchedGroups={library.unmatchedGroups} />
            <HiddenMediaPhoneSheet unknownGroups={library.unknownGroups} />
            <IgnoredFilesPhoneSheet files={library.ignoredLocalFiles} />
        </>
    )
}

/** Playlists (home-toolbar.tsx): opens the playlist sheet (2.14) */
function PlaylistsAction() {
    const t = useTr()
    const { setModalOpen } = usePlaylistEditorManager()
    return <HomeHeaderAction icon={VideoLibraryIcon} label={t("Playlists", "Wiedergabelisten")} accessibilityLabel={t("Playlists", "Playlists")} onPress={() => setModalOpen(true)} />
}

function CustomizeAction() {
    const t = useTr()
    const setOpen = useSetAtom(__home_settingsModalOpen)
    return <HomeHeaderAction icon={Settings2} label={t("Customize", "Anpassen")} onPress={() => setOpen(true)} />
}

/** Every section removed: Home stays empty (it does not bring the default sections back) and says where to add some. */
function NoSections() {
    const t = useTr()
    const setCustomize = useSetAtom(__home_settingsModalOpen)
    return (
        <View className="items-center gap-4 py-10">
            <SectionTitle className="text-center">{t("Home has no sections", "Die Startseite hat keine Bereiche")}</SectionTitle>
            <Text className="text-center leading-[22px] text-sm-text-muted">{t("You removed all sections. Add the ones you want in Customize Home.", "Du hast alle Bereiche entfernt. Füge unter „Home anpassen“ die gewünschten hinzu.")}</Text>
            <Button intent="secondary" leftIcon={<Settings2 size={18} color={colors.smText} />} onPress={() => setCustomize(true)}>{t("Customize Home", "Home anpassen")}</Button>
        </View>
    )
}

/** No library entries and only library sections: say why Home is empty, offer the one next step, show what is trending. */
function EmptyHome() {
    useThemeColors()
    const t = useTr()
    const serverStatus = useServerStatus()
    const allUserMedia = useAtomValue(__anilist_userAnimeMediaAtom)
    const setScanner = useSetAtom(__scanner_modalIsOpen)
    const setCustomize = useSetAtom(__home_settingsModalOpen)
    const router = useRouter()
    const hasLibraryPath = !!serverStatus?.settings?.library?.libraryPath
    const streaming = !!(serverStatus?.torrentstreamSettings?.includeInLibrary || serverStatus?.debridSettings?.includeDebridStreamInLibrary
        || serverStatus?.settings?.library?.includeOnlineStreamingInLibrary)
    const { data, isLoading } = useAnilistListAnime({ page: 1, perPage: 20, sort: ["TRENDING_DESC"] }, true)
    const trending = data?.Page?.media?.filter(Boolean) ?? []

    return (
        <View>
            <View className="items-center gap-6 py-10">
                <SectionTitle className="text-center">{t("Your home screen is empty", "Deine Startseite ist leer")}</SectionTitle>
                {hasLibraryPath && (
                    <Button size="lg" intent="secondary" className="bg-sm-accent-soft" labelClassName="text-sm-accent" leftIcon={<Search size={18} color={colors.smAccent} />}
                        onPress={() => setScanner(true)}>{t("Scan your anime library", "Anime-Bibliothek scannen")}</Button>
                )}
                {!hasLibraryPath && !allUserMedia?.length && (
                    <Button intent="secondary" leftIcon={<Plus size={18} color={colors.smText} />} onPress={() => router.push("/discover")}>
                        {t("Add series to your collection", "Serien zu deiner Sammlung hinzufügen")}
                    </Button>
                )}
                {!hasLibraryPath && !!allUserMedia?.length && !streaming && (
                    <Button intent="secondary" onPress={() => setCustomize(true)}>{t("Add currently watched series to the library", "Aktuell geschaute Serien zur Bibliothek hinzufügen")}</Button>
                )}
                {!hasLibraryPath && !!allUserMedia?.length && streaming && (
                    <View className="items-center gap-1 rounded-xl border border-dashed border-sm-line-strong p-4">
                        <Text className="text-center">{t("No series are currently being watched", "Du schaust gerade keine Serien")}</Text>
                        <Text className="text-center text-sm-text-muted">{t("Add series to your \"Currently watching\" list to get started", "Setze Serien auf deine Liste „Schaue ich gerade“, um loszulegen")}</Text>
                    </View>
                )}
            </View>
            <SectionTitle className="mb-3">{t("Trending right now", "Gerade beliebt")}</SectionTitle>
            {isLoading ? <MediaCardRowSkeleton /> : (
                <MediaCardRow data={trending} keyOf={media => String(media.id)}
                    renderCard={(media, width) => <MediaEntryCard media={media} type="anime" width={width} showLibraryBadge />} />
            )}
            <View className="h-6" />
        </View>
    )
}

function HomeScreenItem({ item: saved, index, library }: { item: Models_HomeItem, index: number, library: HandleLibraryCollectionProps }) {
    const item = React.useMemo(() => withCurrentSchema(saved), [saved])
    if (!item) return null
    if (HOME_ITEMS_PENDING[item.type]) return null
    switch (item.type) {
        case "centered-title":
            if (!item.options?.text) return null
            return <Text accessibilityRole="header" className="px-4 py-2 text-center text-2xl font-bold leading-[31px]">{String(item.options.text)}</Text>
        case "anime-continue-watching":
            return <ContinueWatching episodes={library.continueWatchingList} />
        case "anime-library":
            return <LibraryView collectionList={library.libraryCollectionList} filteredCollectionList={library.filteredLibraryCollectionList}
                isLoading={library.isLoading} streamingMediaIds={library.streamingMediaIds} showStatuses={item.options?.statuses} />
        case "my-lists":
            return <MyLists item={item} />
        case "anime-carousel":
            return <MediaCarousel item={item} type="anime" />
        case "manga-carousel":
            return <MediaCarousel item={item} type="manga" />
        case "aired-recently":
            return <AiredRecently />
        case "missed-sequels":
            return <MissedSequels />
        case "library-upcoming-episodes":
            return <LibraryUpcomingEpisodes hasEntries={library.hasEntries} />
        case "anime-schedule-calendar":
            return <HomeScheduleCalendar global={item.options?.type === "global"} />
        case "manga-library":
            return <MangaLibrary item={item} />
        case "local-anime-library":
            return <LocalAnimeLibrary library={library} />
        case "local-anime-library-stats":
            return <LocalLibraryStats isNakamaLibrary={library.isNakamaLibrary} />
        default:
            return null
    }
}

function HomeState({ children }: { children: React.ReactNode }) {
    return <View className="rounded-surface bg-sm-surface p-5">{children}</View>
}

/** A section whose data could not load: says so and offers to try again (never an empty row or "no results"). */
function SectionError({ onRetry }: { onRetry: () => void }) {
    const t = useTr()
    return (
        <HomeState>
            <Text accessibilityRole="alert" className="mb-4 text-sm-text-muted">{t("This section could not load. AniList may be busy or unreachable.", "Dieser Bereich konnte nicht geladen werden. AniList ist vielleicht ausgelastet oder nicht erreichbar.")}</Text>
            <Button intent="secondary" wrapperClassName="self-start" onPress={onRetry}>{t("Try again", "Erneut versuchen")}</Button>
        </HomeState>
    )
}

/** A section with nothing to show: one muted sentence on the section's card. */
function SectionNote({ children }: { children: string }) {
    return <HomeState><Text className="text-sm-text-muted">{children}</Text></HomeState>
}

/** A carousel's heading on the shared gutter, cards right under it like the other rows */
function CarouselHeading({ children }: { children: React.ReactNode }) {
    return <View className="mb-2 min-h-11 justify-center"><SectionTitle>{children}</SectionTitle></View>
}

/** Anime / manga carousel: a row chosen by the section's options; without a name it is named after its sorting. */
function MediaCarousel({ item, type }: { item: Models_HomeItem, type: "anime" | "manga" }) {
    const t = useTr()
    const options = item.options as Record<string, never> | undefined
    const name = options?.name || carouselDefaultName(t, type, options?.sorting)
    const variables = {
        page: 1,
        perPage: 20,
        sort: options?.sorting ? [options.sorting] : ["SCORE_DESC"],
        genres: (options?.genres as string[] | undefined)?.length ? options?.genres : undefined,
        format: options?.format || undefined,
        status: (Array.isArray(options?.status) && (options.status as string[]).length) ? options!.status : ["RELEASING", "FINISHED"],
        isAdult: options?.isAdult || undefined,
        countryOfOrigin: options?.countryOfOrigin || undefined,
    }
    const anime = useAnilistListAnime({ ...variables, season: options?.season || undefined, seasonYear: options?.year || undefined } as never, type === "anime")
    const manga = useAnilistListManga({ ...variables, year: options?.year || undefined } as never, type === "manga")
    const { data, isLoading, isError, refetch } = type === "anime" ? anime : manga
    // in AniList's order: it is the order the section's sorting asks for
    const media = ((data?.Page?.media ?? []) as (AL_BaseAnime | AL_BaseManga)[]).filter(Boolean)

    return (
        <View>
            <CarouselHeading>{name}</CarouselHeading>
            {isLoading ? <MediaCardRowSkeleton />
                : !data ? (isError ? <SectionError onRetry={() => void refetch()} /> : <MediaCardRowSkeleton />)
                : media.length ? (
                    <MediaCardRow data={media} keyOf={m => String(m.id)}
                        renderCard={(m, width) => <MediaEntryCard media={m} type={type} width={width} showLibraryBadge={type === "anime"} />} />
                ) : <CarouselEmpty item={item} type={type} />}
        </View>
    )
}

/** An empty carousel says which option empties it and can go back to its defaults. */
function CarouselEmpty({ item, type }: { item: Models_HomeItem, type: "anime" | "manga" }) {
    const t = useTr()
    const { data: savedItems } = useGetHomeItems()
    const { mutate: updateHomeItems, isPending } = useUpdateHomeItems()
    const cause = carouselEmptyCause(item.options, type)
    const named = "options" in cause ? cause.options.map(label => homeOptionLabel(t, label)).join(", ") : ""
    const note = "genres" in cause
        ? t(`AniList only lists titles that have all ${cause.genres} picked genres, and none has them all. Pick one or two genres.`,
            `AniList zeigt nur Titel, die alle ${cause.genres} gewählten Genres haben, und keiner hat alle. Wähle ein oder zwei Genres.`)
        : cause.options.length
            ? t(`Nothing matches this section's options (${named}).`, `Nichts passt zu den Optionen dieses Bereichs (${named}).`)
            : t("Nothing matches this section's options.", "Nichts passt zu den Optionen dieses Bereichs.")
    return (
        <HomeState>
            <Text className="text-sm-text-muted">{note}</Text>
            {!!savedItems?.length && (
                <Button intent="secondary" className="mt-3 self-start" loading={isPending}
                    onPress={() => updateHomeItems({ items: resetCarouselOptions(savedItems, item.id) })}>
                    {t("Reset options", "Optionen zurücksetzen")}
                </Button>
            )}
        </HomeState>
    )
}

/** Aired recently (global): episodes of the last 14 days, the newest first, Japanese TV and films, no adult titles. */
function AiredRecently() {
    const t = useTr()
    const [now] = React.useState(() => new Date())
    const { data, isLoading, isError, refetch } = useAnilistListRecentAiringAnime({
        page: 1,
        perPage: 50,
        airingAt_lesser: Math.floor(now.getTime() / 1000),
        airingAt_greater: Math.floor(subDays(now, 14).getTime() / 1000),
        // without a sort AniList starts with the oldest of the 14 days
        sort: ["TIME_DESC"],
    })
    const aired = (data?.Page?.airingSchedules ?? []).filter(item => item?.media?.isAdult === false && item.media.type === "ANIME"
        && item.media.countryOfOrigin === "JP" && item.media.format !== "TV_SHORT")
    return (
        <View className="pb-6">
            <CarouselHeading>{t("Aired recently", "Kürzlich ausgestrahlt")}</CarouselHeading>
            {isLoading ? <MediaCardRowSkeleton />
                : !data && isError ? <SectionError onRetry={() => void refetch()} />
                : !aired.length ? <SectionNote>{t("No Japanese TV episodes or films aired in the last 14 days.", "In den letzten 14 Tagen wurden keine japanischen TV-Folgen oder Filme ausgestrahlt.")}</SectionNote>
                : (
                <MediaCardRow data={aired} keyOf={item => String(item.id)}
                    renderCard={(item, width) => (
                        <MediaEntryCard media={item.media as AL_BaseAnime} type="anime" width={width} showLibraryBadge hideReleasingBadge
                            overlay={<AiredOverlay episode={item.episode} total={item.media?.episodes} movie={item.media?.format === "MOVIE"} timeUntilAiring={item.timeUntilAiring} />} />
                    )} />
            )}
        </View>
    )
}

/** The aired episode ("3/12") and how long ago ("2d ago") in the cover's top right corner */
function AiredOverlay({ episode, total, movie, timeUntilAiring }: { episode: number, total?: number, movie: boolean, timeUntilAiring: number }) {
    const ago = formatDistanceToNow(addSeconds(new Date(), timeUntilAiring), { addSuffix: true })
        .replace("less than a", "1").replace("about ", "").replace(" minutes", "m").replace(" minute", "m")
        .replace(" hours", "h").replace(" hour", "h").replace(" days", "d")
    return (
        <View className="absolute right-0 top-0 items-end">
            <View className="rounded-bl-[8px] bg-[rgba(3,7,18,0.8)] py-1.5 pl-3 pr-1">
                {movie ? <Text className="font-semibold tracking-wider text-white">Movie</Text> : (
                    <Text className="font-semibold tracking-wider text-white"><Text className="text-lg font-semibold text-white">{episode}</Text>
                        <Text className="text-[15px] text-sm-text-muted">/{total ?? "-"}</Text></Text>
                )}
            </View>
            <View className="ml-2 rounded-bl-[8px] bg-[rgba(55,65,81,0.7)] py-1 pl-2 pr-[5px]">
                <Text className="text-xs font-semibold text-white">{ago}</Text>
            </View>
        </View>
    )
}

/** Missed sequels: stays visible while loading, empty or failed instead of silently rendering nothing. */
function MissedSequels() {
    const t = useTr()
    const { data, isLoading, isError, refetch } = useAnilistListMissedSequels(true)
    return (
        <View className="gap-2">
            <SectionTitle>{t("Missed sequels", "Verpasste Fortsetzungen")}</SectionTitle>
            {isLoading ? <MediaCardRowSkeleton /> : !data?.length ? (
                isError ? <SectionError onRetry={() => void refetch()} />
                    : <SectionNote>{t("No missed sequels. Only sequels of anime you completed count, and only while they are on none of your lists (Planning too).",
                        "Keine verpassten Fortsetzungen. Es zählen nur Fortsetzungen von Anime, die du abgeschlossen hast, und nur solange sie auf keiner deiner Listen stehen (auch nicht „Geplant“).")}</SectionNote>
            ) : (
                <MediaCardRow data={data.filter(Boolean)} keyOf={media => String(media.id)}
                    renderCard={(media, width) => <MediaEntryCard media={media} type="anime" width={width} showLibraryBadge />} />
            )}
        </View>
    )
}

/** My lists: anime or manga of the picked statuses, or one custom list, each as a row under its name and count. */
function MyLists({ item }: { item: Models_HomeItem }) {
    const t = useTr()
    const type: "anime" | "manga" = item.options?.type === "manga" ? "manga" : "anime"
    const lists = useHandleUserAnilistLists("", type)
    const { data: animeLists } = useGetRawAnimeCollection()
    const { data: mangaLists } = useGetRawAnilistMangaCollection()
    const loaded = !!(type === "anime" ? animeLists : mangaLists)
    const statuses: string[] | undefined = item.options?.statuses?.length ? item.options.statuses : undefined
    const customName = String(item.options?.customListName ?? "").trim()
    const byStatus: [string, string, AL_AnimeCollection_MediaListCollection_Lists | undefined][] = [
        ["CURRENT", type === "manga" ? t("Currently reading", "Lese ich gerade") : t("Currently watching", "Schaue ich gerade"), lists.currentList],
        ["REPEATING", type === "manga" ? t("Rereading", "Lese erneut") : t("Rewatching", "Schaue erneut"), lists.repeatingList],
        ["PLANNING", t("Planning", "Geplant"), lists.planningList],
        ["PAUSED", t("Paused", "Pausiert"), lists.pausedList],
        ["COMPLETED", t("Completed", "Fertig"), lists.completedList],
        ["DROPPED", t("Dropped", "Abgebrochen"), lists.droppedList],
    ]
    const shown = customName
        ? (lists.customLists ?? []).filter(list => list.name === customName && !!list.entries?.length).map(list => ({ key: list.name!, title: list.name!, count: undefined, list }))
        : byStatus.filter(([status, , list]) => !!list?.entries?.length && (!statuses || statuses.includes(status)))
            .map(([status, title, list]) => ({ key: status, title, count: list!.entries!.length, list: list! }))

    if (loaded && customName && !shown.length) {
        return <SectionNote>{type === "manga"
            ? t(`You have no manga list named "${customName}" with entries on AniList. Check the name in Customize Home.`,
                `Du hast auf AniList keine Manga-Liste „${customName}“ mit Einträgen. Prüfe den Namen unter „Home anpassen“.`)
            : t(`You have no anime list named "${customName}" with entries on AniList. Check the name in Customize Home.`,
                `Du hast auf AniList keine Anime-Liste „${customName}“ mit Einträgen. Prüfe den Namen unter „Home anpassen“.`)}</SectionNote>
    }
    if (loaded && !shown.length) return <SectionNote>{t("Your lists have no entries with the picked statuses.", "Deine Listen haben keine Einträge mit den gewählten Status.")}</SectionNote>
    return (
        <View className="gap-6">
            {shown.map(({ key, title, count, list }) => (
                <View key={key} className="gap-6">
                    <SectionTitle>{title}{count !== undefined && <Text className="text-sm font-medium text-sm-text-muted">{"   "}{count}</Text>}</SectionTitle>
                    <MediaCardRow data={list.entries!.filter(entry => !!entry.media)} keyOf={entry => String(entry.media!.id)}
                        renderCard={(entry, width) => (
                            <MediaEntryCard media={entry.media!} type={type} width={width} showLibraryBadge
                                listData={{ progress: entry.progress!, score: entry.score!, status: entry.status! }} />
                        )} />
                </View>
            ))}
        </View>
    )
}

/** The manga library: one row per reading status, "Continue reading" with its ⋮ menu. */
function MangaLibrary({ item }: { item: Models_HomeItem }) {
    const { mangaCollection, mangaCollectionLoading } = useHandleMangaCollection()
    const statuses: string[] | undefined = item.options?.statuses?.length ? item.options.statuses : undefined
    const t = useTr()
    if (!mangaCollection || mangaCollectionLoading) return <View className="gap-3 pt-5"><View className="h-7 w-40 rounded-ui bg-sm-surface-raised" /><MediaCardRowSkeleton /></View>
    const shown = mangaCollection.lists?.filter(list => !!list.entries?.length && (!statuses || (!!list.type && statuses.includes(list.type)))) ?? []
    if (!shown.length) return <View className="pt-5"><SectionNote>{t("Your lists have no entries with the picked statuses.", "Deine Listen haben keine Einträge mit den gewählten Status.")}</SectionNote></View>
    return <View>{shown.map(list => <MangaListRow key={list.type} list={list} />)}</View>
}

function MangaListRow({ list }: { list: Manga_CollectionList }) {
    const t = useTr()
    const [params, setParams] = useAtom(__mangaLibrary_paramsAtom)
    const current = list.type === "CURRENT"
    return (
        <View>
            <View className="mb-3 mt-5 min-h-11 flex-row items-center justify-between gap-3">
                <SectionTitle className="min-w-0 flex-1">{current ? t("Continue reading", "Weiterlesen") : getMangaCollectionTitle(list.type, t)}</SectionTitle>
                {current && params.unreadOnly && (
                    <Pressable accessibilityRole="button" onPress={() => setParams(draft => { draft.unreadOnly = false })} className="min-h-11 justify-center px-2">
                        <Text className="text-sm font-medium">{t("Show all", "Alle zeigen")}</Text>
                    </Pressable>
                )}
                {current && <MangaListMenu />}
            </View>
            <MediaCardRow data={list.entries ?? []} keyOf={entry => String(entry.mediaId)}
                renderCard={(entry, width) => <MediaEntryCard media={entry.media!} type="manga" width={width} listData={entry.listData} />} />
        </View>
    )
}

/**
 * "Continue reading" ⋮: unread chapters only, show / hide unread counts (a theme setting), refresh sources (the manga
 * library's sheet), then the plugins' manga library items (web manga-library-view PluginMangaLibraryDropdownItems).
 */
function MangaListMenu() {
    const t = useTr()
    const ts = useThemeSettings()
    const [params, setParams] = useAtom(__mangaLibrary_paramsAtom)
    const { mutate: updateTheme, isPending } = useUpdateTheme()
    const [refreshOpen, setRefreshOpen] = React.useState(false)
    const { data: refreshJob } = useGetMangaSourceRefresh()
    const pluginItems = usePluginActions("mangaLibraryItems")
    const runPlugin = useRunPluginAction()
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Pressable accessibilityRole="button" accessibilityLabel={t("Manga list actions", "Aktionen der Manga-Liste")}
                    className="h-11 w-11 items-center justify-center rounded-full active:bg-sm-surface-control">
                    <EllipsisVertical size={22} color={colors.smTextMuted} />
                </Pressable>
            </PopoverTrigger>
            <PopoverContent align="end">
                <PopoverClose asChild>
                    <MenuRow icon={BookOpenCheck} label={params.unreadOnly ? t("Show all", "Alle zeigen") : t("Unread chapters only", "Nur ungelesene Kapitel")}
                        onPress={() => setParams(draft => { draft.unreadOnly = !draft.unreadOnly })} />
                </PopoverClose>
                <PopoverClose asChild>
                    <MenuRow icon={ts.showMangaUnreadCount ? EyeOff : Eye} disabled={isPending}
                        label={ts.showMangaUnreadCount ? t("Hide unread counts", "Ungelesen-Zahlen ausblenden") : t("Show unread counts", "Ungelesen-Zahlen zeigen")}
                        onPress={() => updateTheme({ theme: { id: 0, ...ts, showMangaUnreadCount: !ts.showMangaUnreadCount } as never })} />
                </PopoverClose>
                <PopoverClose asChild>
                    <MenuRow icon={RefreshCcw} label={t("Refresh sources", "Quellen aktualisieren")} onPress={() => setRefreshOpen(true)} />
                </PopoverClose>
                {pluginItems.map(item => <PopoverClose key={`${item.extensionId}:${item.id}`} asChild>
                    <MenuRow icon={Puzzle} label={item.label || "???"} disabled={item.disabled} onPress={() => runPlugin(item, {})} />
                </PopoverClose>)}
            </PopoverContent>
            <MangaSourceRefreshSheet open={refreshOpen} onOpenChange={setRefreshOpen} job={refreshJob} />
        </Popover>
    )
}

function MenuRow({ icon: Icon, label, disabled, onPress, ...rest }: { icon: React.ComponentType<{ size?: number, color?: string }>, label: string, disabled?: boolean, onPress: () => void }) {
    return (
        <Pressable {...rest} accessibilityRole="menuitem" disabled={disabled} onPress={onPress}
            className={cn("min-h-12 flex-row items-center gap-3 rounded-[10px] px-3 active:bg-sm-surface-control", disabled && "opacity-50")}>
            <Icon size={18} color={colors.smTextMuted} />
            <Text className="text-[15px]">{label}</Text>
        </Pressable>
    )
}

/** Local anime library: the anime on this device as rows under their list names, without the library page's filters. */
function LocalAnimeLibrary({ library }: { library: HandleLibraryCollectionProps }) {
    const t = useTr()
    const { libraryCollectionList } = useHandleDetailedLibraryCollection()
    if (library.isLoading || !library.hasEntries) return null
    const filled = libraryCollectionList.filter((list: Anime_LibraryCollectionList) => !!list.entries?.length)
    if (!filled.length) return (
        <HomeState>
            <SectionTitle>{t("Anime on this device", "Anime auf diesem Gerät")}</SectionTitle>
            <Text className="mb-4 mt-2 leading-[22px] text-sm-text-muted">{t("Nothing here yet. Episodes you download or keep in a library folder show up here.", "Noch nichts da. Folgen, die du lädst oder in einem Bibliotheksordner hast, erscheinen hier.")}</Text>
        </HomeState>
    )
    return (
        <View className="gap-3">
            {filled.map((list, i) => (
                <View key={list.type} className={cn("gap-3", i > 0 && "mt-2")}>
                    <SectionTitle>{getLibraryCollectionTitle(list.type, t)}<Text className="text-sm font-medium text-sm-text-muted">{"  "}{t("on this device", "auf diesem Gerät")}</Text></SectionTitle>
                    <MediaCardRow data={list.entries ?? []} keyOf={entry => String(entry.mediaId)}
                        renderCard={(entry, width) => (
                            <MediaEntryCard media={entry.media!} type="anime" width={width} listData={entry.listData} libraryData={entry.libraryData}
                                nakamaLibraryData={entry.nakamaLibraryData} withScore={false}
                                showLibraryBadge={!!library.streamingMediaIds.length && !library.streamingMediaIds.includes(entry.mediaId) && entry.listData?.status === "CURRENT"} />
                        )} />
                </View>
            ))}
        </View>
    )
}

/** The local library's numbers as one group under a heading: 3 columns on phones, 6 on tablets. */
function LocalLibraryStats({ isNakamaLibrary }: { isNakamaLibrary: boolean }) {
    const t = useTr()
    const { rail } = useTabletLayout()
    const { data } = useGetLibraryCollection()
    const stats = data?.stats
    const facts: [string, React.ReactNode][] = [
        ...(isNakamaLibrary ? [] : [[t("Size", "Größe"), stats?.totalSize] as [string, React.ReactNode]]),
        [t("Files", "Dateien"), stats?.totalFiles],
        [t("Entries", "Einträge"), stats?.totalEntries],
        [t("TV shows", "Serien"), stats?.totalShows],
        [t("Movies", "Filme"), stats?.totalMovies],
        [t("Specials", "Specials"), stats?.totalSpecials],
    ]
    const columns = rail ? 6 : 3
    return (
        <View className="gap-3">
            <SectionTitle>{t("Local library", "Lokale Bibliothek")}</SectionTitle>
            <View className="flex-row flex-wrap gap-0.5 overflow-hidden rounded-surface">
                {facts.map(([label, value], i) => {
                    // a lone last cell in a row of three spans two (the web grid's span 2)
                    const span = !rail && i === facts.length - 1 && facts.length % columns === 2 ? 2 : 1
                    return (
                        <View key={label} style={{ flexBasis: `${(100 * span) / columns - 1}%`, flexGrow: 1 }} className="min-w-0 gap-0.5 bg-sm-surface-raised px-4 py-3">
                            <Text className="text-[13px] text-sm-text-muted">{label}</Text>
                            <Text className="text-xl font-bold leading-[26px]" style={{ fontVariant: ["tabular-nums"] }}>{value ?? "–"}</Text>
                        </View>
                    )
                })}
            </View>
        </View>
    )
}
