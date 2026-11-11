import type { AL_MediaListStatus, Anime_LibraryCollectionEntry, Anime_LibraryCollectionList } from "@/api/generated/types"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Sheet } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { SectionTitle, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { getLibraryCollectionTitle } from "@/lib/server/utils"
import { colors } from "@/lib/theme/tokens"
import { __mainLibrary_paramsAtom } from "@/main/_features/anime-library/_lib/handle-library-collection"
import { homeCurrentGenresAtom } from "@/main/_features/anime-library/library-phone.atoms"
import { filterByGenres, genreCounts } from "@/main/_features/home/home-layout"
import { MediaCardRow, MediaCardRowSkeleton } from "@/main/_features/media/_components/media-card-row"
import { MediaEntryCard } from "@/main/_features/media/_components/media-entry-card"
import { useAtom } from "jotai"
import Check from "lucide-react-native/icons/check"
import ListFilter from "lucide-react-native/icons/list-filter"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * Android Home's anime library section (library-view.tsx + library-collection.tsx, home-mobile.css): one row per list
 * status, "Currently watching" with its filter sheet (home-current-filter.css). Grid and carousel look the same on
 * phones: every list is one swipeable row.
 */
export function LibraryView({ collectionList, filteredCollectionList, isLoading, streamingMediaIds, showStatuses }: {
    collectionList: Anime_LibraryCollectionList[]
    filteredCollectionList: Anime_LibraryCollectionList[]
    isLoading: boolean
    streamingMediaIds: number[]
    showStatuses?: AL_MediaListStatus[]
}) {
    const [params] = useAtom(__mainLibrary_paramsAtom)

    if (isLoading) return <View className="gap-4 pt-5"><View className="h-7 w-40 rounded-ui bg-sm-surface-raised" /><MediaCardRowSkeleton /></View>

    // A genre picked elsewhere (the library's genre row) shows the matching series as one row
    if (params.genre?.length) {
        const entries = filteredCollectionList
            .filter(list => !showStatuses || (!!list.type && showStatuses.includes(list.type)))
            .flatMap(list => list.entries ?? [])
        return <View className="pt-5"><EntryRow entries={entries} streamingMediaIds={streamingMediaIds} /></View>
    }

    return (
        <View>
            {collectionList.map(list => {
                if (!list.entries?.length) return null
                if (showStatuses && list.type && !showStatuses.includes(list.type)) return null
                return <LibraryListItem key={list.type} list={list} streamingMediaIds={streamingMediaIds} />
            })}
        </View>
    )
}

const LibraryListItem = React.memo(function LibraryListItem({ list, streamingMediaIds }: { list: Anime_LibraryCollectionList, streamingMediaIds: number[] }) {
    const t = useTr()
    const [genres, setGenres] = useAtom(homeCurrentGenresAtom)
    const current = list.type === "CURRENT"
    const genreFiltered = current && genres.length > 0
    const entries = React.useMemo(() => genreFiltered ? filterByGenres(list.entries, genres) : list.entries ?? [], [list.entries, genres, genreFiltered])

    return (
        <View>
            <View className="mb-3 mt-5 flex-row items-center gap-2">
                <SectionTitle className="min-w-0 flex-1">{current ? t("Currently watching", "Gerade dabei") : getLibraryCollectionTitle(list.type)}</SectionTitle>
                {current && <HomeCurrentFilter list={list} />}
            </View>
            {genreFiltered && !entries.length && (
                <View className="flex-row flex-wrap items-center gap-x-1 py-3">
                    <Text className="text-sm text-sm-text-muted">{t("No series match these genres.", "Keine Serie passt zu diesen Genres.")}</Text>
                    <Pressable accessibilityRole="button" onPress={() => setGenres([])} className="min-h-11 justify-center">
                        <Text className="text-sm font-semibold text-sm-accent">{t("Reset", "Zurücksetzen")}</Text>
                    </Pressable>
                </View>
            )}
            {!!entries.length && <EntryRow entries={entries} streamingMediaIds={streamingMediaIds} />}
        </View>
    )
})

function EntryRow({ entries, streamingMediaIds }: { entries: Anime_LibraryCollectionEntry[], streamingMediaIds: number[] }) {
    return (
        <MediaCardRow
            data={entries}
            keyOf={entry => String(entry.mediaId)}
            renderCard={(entry, width) => (
                <MediaEntryCard
                    media={entry.media!}
                    type="anime"
                    width={width}
                    listData={entry.listData}
                    libraryData={entry.libraryData}
                    nakamaLibraryData={entry.nakamaLibraryData}
                    showLibraryBadge={!!streamingMediaIds?.length && !streamingMediaIds.includes(entry.mediaId) && entry.listData?.status === "CURRENT"}
                />
            )}
        />
    )
}

/** Android home: filter sheet for "Currently watching" with the unwatched toggle and the genres of the listed series. */
function HomeCurrentFilter({ list }: { list: Anime_LibraryCollectionList }) {
    const t = useTr()
    const [open, setOpen] = React.useState(false)
    const [params, setParams] = useAtom(__mainLibrary_paramsAtom)
    const [genres, setGenres] = useAtom(homeCurrentGenresAtom)
    const available = React.useMemo(() => genreCounts(list.entries), [list.entries])
    const matching = filterByGenres(list.entries, genres).length
    const active = genres.length + (params.continueWatchingOnly ? 1 : 0)
    const toggle = (genre: string) => setGenres(picked => picked.includes(genre) ? picked.filter(g => g !== genre) : [...picked, genre])
    const label = t("Filter currently watching", "Aktuelle Serien filtern")

    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: active > 0 }}
                onPress={() => setOpen(true)}
                // the UI Button (`gray-basic`) of 2.0.32: 12dp to the sides, flush with the head's -8dp edge (S22 10.11.)
                className="min-h-11 min-w-11 flex-row items-center justify-center gap-1.5 rounded-full px-3 active:bg-sm-surface-control"
            >
                <ListFilter size={16} color={colors.smTextMuted} />
                <Text className="text-[13px] text-sm-text-muted">{t("Filter", "Filter")}{active ? ` · ${active}` : ""}</Text>
            </Pressable>
            <Sheet
                compact
                open={open}
                onOpenChange={setOpen}
                title={label}
                footer={(
                    <>
                        <Button intent="secondary" disabled={!active} onPress={() => {
                            setGenres([])
                            setParams(draft => {
                                draft.continueWatchingOnly = false
                            })
                        }}>{t("Reset", "Zurücksetzen")}</Button>
                        <Button wrapperClassName="flex-1" onPress={() => setOpen(false)}>{t(`Show ${matching} series`, `${matching} Serien anzeigen`)}</Button>
                    </>
                )}
            >
                <View className="overflow-hidden rounded-surface">
                    <SwitchRow
                        label={t("Unwatched episodes only", "Nur mit ungesehenen Folgen")}
                        checked={!!params.continueWatchingOnly}
                        onCheckedChange={() => setParams(draft => {
                            draft.continueWatchingOnly = !draft.continueWatchingOnly
                        })}
                    />
                </View>
                {!!available.length && (
                    <View accessibilityLabel={t("Genres", "Genres")}>
                        <Text className="mx-1 mb-2 text-[13px] font-medium text-sm-text-subtle">{t("Genres", "Genres")}</Text>
                        <View className="flex-row flex-wrap gap-2">
                            {available.map(([genre, count]) => {
                                const on = genres.includes(genre)
                                return (
                                    <Pressable
                                        key={genre}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: on }}
                                        accessibilityLabel={`${genre}, ${count}`}
                                        onPress={() => toggle(genre)}
                                        className={cn("min-h-11 flex-row items-center gap-1.5 rounded-full px-3.5", on ? "bg-sm-accent-soft" : "bg-sm-surface-raised active:bg-sm-surface-control")}
                                    >
                                        {on && <Check size={14} color={colors.smAccent} strokeWidth={2.5} />}
                                        <Text className={cn("text-sm", on ? "font-semibold text-sm-accent" : "text-sm-text")}>{genre}</Text>
                                        <Text className={cn("text-xs", on ? "text-sm-accent" : "text-sm-text-subtle")} style={{ fontVariant: ["tabular-nums"] }}>{count}</Text>
                                    </Pressable>
                                )
                            })}
                        </View>
                    </View>
                )}
            </Sheet>
        </>
    )
}
