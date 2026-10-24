import { AL_MediaListStatus, Anime_LibraryCollectionEntry, Anime_LibraryCollectionList } from "@/api/generated/types"
import { __mainLibrary_paramsAtom } from "@/app/(main)/_features/anime-library/_lib/handle-library-collection"
import { MediaCardLazyGrid } from "@/app/(main)/_features/media/_components/media-card-grid"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { IconButton } from "@/components/ui/button"
import { Carousel, CarouselContent, CarouselDotButtons } from "@/components/ui/carousel"
import { cn } from "@/components/ui/core/styling"
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { getLibraryCollectionTitle } from "@/lib/server/utils"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { LuCheck, LuListFilter } from "react-icons/lu"
import { useTr } from "@/lib/app-language"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import "@/components/shared/mobile-surface.css"
import "./home-current-filter.css"

/** Android home: genres the "Currently watching" row is narrowed to (all must match). Kept for the session only. */
const homeCurrentGenresAtom = atom<string[]>([])

/** Android Home's library rows (Home is the only place that renders them). */
export function LibraryCollectionLists({ collectionList, isLoading, streamingMediaIds, showStatuses, type }: {
    collectionList: Anime_LibraryCollectionList[],
    isLoading: boolean,
    streamingMediaIds: number[],
    showStatuses?: AL_MediaListStatus[],
    type: "carousel" | "grid"
}) {

    return (
        <PageWrapper
            key="library-collection-lists"
            className={type === "grid" ? "space-y-8" : "space-y-4"}
            data-library-collection-lists
            {...{
                initial: { opacity: 0, y: 60 },
                animate: { opacity: 1, y: 0 },
                exit: { opacity: 0, scale: 0.99 },
                transition: {
                    duration: 0.25,
                },
            }}>
            {collectionList.map(collection => {
                if (!collection.entries?.length) return null
                return <LibraryCollectionListItem
                    homeMobile
                    key={collection.type}
                    list={collection}
                    streamingMediaIds={streamingMediaIds}
                    showStatuses={showStatuses}
                    type={type}
                />
            })}
        </PageWrapper>
    )

}

export function LibraryCollectionFilteredLists({ collectionList, isLoading, streamingMediaIds, showStatuses, type }: {
    collectionList: Anime_LibraryCollectionList[],
    isLoading: boolean,
    streamingMediaIds: number[],
    showStatuses?: AL_MediaListStatus[],
    type: "carousel" | "grid"
}) {


    const filteredCollectionList = React.useMemo(() => {
        return collectionList.filter(collection => {
            return !showStatuses || (!!showStatuses && !!collection.type && showStatuses.includes(collection.type))
        })
    }, [collectionList, showStatuses])

    return (
        <PageWrapper
            key="library-filtered-lists"
            className={type === "grid" ? "space-y-8" : "space-y-4"}
            data-library-filtered-lists
            {...{
                initial: { opacity: 0, y: 60 },
                animate: { opacity: 1, y: 0 },
                exit: { opacity: 0, scale: 0.99 },
                transition: {
                    duration: 0.25,
                },
            }}>
            {type === "grid" && <MediaCardLazyGrid itemCount={filteredCollectionList?.flatMap(n => n.entries)?.length ?? 0}>
                {filteredCollectionList?.flatMap(n => n.entries)?.filter(Boolean)?.map(entry => {
                    return <LibraryCollectionEntryItem key={entry.mediaId} entry={entry} streamingMediaIds={streamingMediaIds} type={type} />
                })}
            </MediaCardLazyGrid>}
            {type === "carousel" && <Carousel
                className={cn("w-full max-w-full !mt-0")}
                gap="xl"
                opts={{
                    align: "start",
                    dragFree: true,
                }}
                autoScroll={false}
            >
                <CarouselDotButtons className="-top-2" />
                <CarouselContent className="px-6">
                    {filteredCollectionList?.flatMap(n => n.entries)?.filter(Boolean)?.map(entry => {
                        return <LibraryCollectionEntryItem key={entry.mediaId} entry={entry} streamingMediaIds={streamingMediaIds} type={type} />
                    })}
                </CarouselContent>
            </Carousel>}
        </PageWrapper>
    )

}

const LibraryCollectionListItem = React.memo(({ list, streamingMediaIds, showStatuses, type, homeMobile }: {
    /** Home's rows (LibraryCollectionLists); the detailed library view leaves it off */
    homeMobile?: boolean
    list: Anime_LibraryCollectionList,
    streamingMediaIds: number[],
    showStatuses?: AL_MediaListStatus[],
    type: "carousel" | "grid"
}) => {

    const isCurrentlyWatching = list.type === "CURRENT"
    const tr = useTr()

    const [params, setParams] = useAtom(__mainLibrary_paramsAtom)
    const [genres, setGenres] = useAtom(homeCurrentGenresAtom)
    const genreFiltered = homeMobile && isCurrentlyWatching && genres.length > 0
    const entries = React.useMemo(() => genreFiltered
        ? list.entries?.filter(entry => genres.every(genre => entry.media?.genres?.includes(genre)))
        : list.entries, [list.entries, genres, genreFiltered])

    if (!!showStatuses && !!list.type && !showStatuses.includes(list.type)) return null

    return (
        <React.Fragment key={list.type}>
            <div className="flex gap-3 items-center" data-library-collection-list-item-header data-list-type={list.type}>
                <h2
                    className={cn(
                        "p-0 m-0",
                    )}
                >{homeMobile && isCurrentlyWatching ? tr("Currently watching", "Gerade dabei") : getLibraryCollectionTitle(list.type)}</h2>
                {type === "grid" && <div className="flex flex-1"></div>}
                {isCurrentlyWatching && homeMobile && <HomeCurrentFilter list={list} />}
                {isCurrentlyWatching && !homeMobile && <DropdownMenu
                    trigger={<IconButton
                        intent="white-basic"
                        size="xs"
                        className="mt-1"
                        icon={<LuListFilter />}
                    />}
                >
                    <DropdownMenuItem
                        onClick={() => {
                            setParams(draft => {
                                draft.continueWatchingOnly = !draft.continueWatchingOnly
                                return
                            })
                        }}
                    >
                        {params.continueWatchingOnly ? "Show all" : "Show unwatched only"}
                    </DropdownMenuItem>
                </DropdownMenu>}
            </div>
            {genreFiltered && !entries?.length && <p className="home-filter-empty">
                {tr("No series match these genres.", "Keine Serie passt zu diesen Genres.")}{" "}
                <button type="button" onClick={() => setGenres([])}>{tr("Reset", "Zurücksetzen")}</button>
            </p>}
            {type === "grid" && <MediaCardLazyGrid
                itemCount={entries?.length || 0}
                data-library-collection-list-item-media-card-lazy-grid
                data-list-type={list.type}
            >
                {entries?.map(entry => {
                    return <LibraryCollectionEntryItem key={entry.mediaId} entry={entry} streamingMediaIds={streamingMediaIds} type={type} />
                })}
            </MediaCardLazyGrid>}
            {type === "carousel" && <Carousel
                className={cn("w-full max-w-full !mt-0")}
                gap="xl"
                opts={{
                    align: "start",
                    dragFree: true,
                }}
                autoScroll={false}
            >
                <CarouselDotButtons className="-top-2" />
                <CarouselContent className="px-6">
                    {entries?.map(entry => {
                        return <LibraryCollectionEntryItem key={entry.mediaId} entry={entry} streamingMediaIds={streamingMediaIds} type={type} />
                    })}
                </CarouselContent>
            </Carousel>}
        </React.Fragment>
    )
})

/** Android home: filter sheet for "Currently watching" with the unwatched toggle and the genres of the listed series. */
function HomeCurrentFilter({ list }: { list: Anime_LibraryCollectionList }) {
    const tr = useTr()
    const [open, setOpen] = React.useState(false)
    const [params, setParams] = useAtom(__mainLibrary_paramsAtom)
    const [genres, setGenres] = useAtom(homeCurrentGenresAtom)
    const available = React.useMemo(() => {
        const counts = new Map<string, number>()
        list.entries?.forEach(entry => entry.media?.genres?.forEach(genre => counts.set(genre, (counts.get(genre) || 0) + 1)))
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    }, [list.entries])
    const matching = list.entries?.filter(entry => genres.every(genre => entry.media?.genres?.includes(genre))).length ?? 0
    const active = genres.length + (params.continueWatchingOnly ? 1 : 0)
    const toggle = (genre: string) => setGenres(current => current.includes(genre) ? current.filter(g => g !== genre) : [...current, genre])
    return <Modal
        open={open}
        onOpenChange={setOpen}
        title={tr("Filter currently watching", "Aktuelle Serien filtern")}
        contentClass="mobile-anime-dialog mobile-download-sheet home-filter-sheet"
        trigger={<Button intent="gray-basic" leftIcon={<LuListFilter aria-hidden />} aria-label={tr("Filter currently watching", "Aktuelle Serien filtern")}
            aria-pressed={active > 0}>{tr("Filter", "Filter")}{active ? ` · ${active}` : ""}</Button>}
    >
        <div className="home-filter" data-home-current-filter>
            <button type="button" role="switch" aria-checked={!!params.continueWatchingOnly} className="home-filter-switch"
                onClick={() => setParams(draft => {
                    draft.continueWatchingOnly = !draft.continueWatchingOnly
                    return
                })}>
                <span>{tr("Unwatched episodes only", "Nur mit ungesehenen Folgen")}</span>
                <span className="home-filter-toggle" aria-hidden />
            </button>
            {!!available.length && <div className="home-filter-genres" role="group" aria-label={tr("Genres", "Genres")}>
                <p>{tr("Genres", "Genres")}</p>
                <div>
                    {available.map(([genre, count]) => <button key={genre} type="button" aria-pressed={genres.includes(genre)} onClick={() => toggle(genre)}>
                        {genres.includes(genre) && <LuCheck aria-hidden />}{genre}<span>{count}</span>
                    </button>)}
                </div>
            </div>}
            <div className="home-filter-footer">
                <button type="button" className="home-filter-reset" disabled={!active} onClick={() => {
                    setGenres([])
                    setParams(draft => {
                        draft.continueWatchingOnly = false
                        return
                    })
                }}>{tr("Reset", "Zurücksetzen")}</button>
                <button type="button" className="home-filter-apply" onClick={() => setOpen(false)}>
                    {tr(`Show ${matching} series`, `${matching} Serien anzeigen`)}
                </button>
            </div>
        </div>
    </Modal>
}

const LibraryCollectionEntryItem = React.memo(({ entry, streamingMediaIds, type }: {
    entry: Anime_LibraryCollectionEntry,
    streamingMediaIds: number[],
    type: "carousel" | "grid"
}) => {
    return (
        <MediaEntryCard
            media={entry.media!}
            listData={entry.listData}
            libraryData={entry.libraryData}
            nakamaLibraryData={entry.nakamaLibraryData}
            showListDataButton
            withAudienceScore={false}
            type="anime"
            containerClassName={type === "carousel" ? "basis-[200px] md:basis-[250px] mx-2 mt-8 mb-0" : undefined}
            showLibraryBadge={!!streamingMediaIds?.length && !streamingMediaIds.includes(entry.mediaId) && entry.listData?.status === "CURRENT"}
        />
    )
})
