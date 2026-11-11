import { Choices, FORMAT_LABELS, MoreAction, SearchField, TextAction } from "@/components/shared/phone-kit"
import { SEASON_LABELS, useLastData } from "@/components/shared/phone-cards"
import { Button } from "@/components/ui/button/button"
import { Select } from "@/components/ui/select/select"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Muted } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import {
    ANIME_FORMATS,
    countValues,
    type FacetCount,
    genreFacet,
    getListYears,
    getTagChips,
    LISTS_SORTING_OPTIONS,
    type ListsFilters,
    type ListType,
    orderedFacet,
    type PhoneList,
    RELEASE_LABELS,
    RELEASE_STATUSES,
    SEASONS,
    TAG_CHIP_LIMIT,
} from "@/main/lists/_lib/lists-phone"
import React from "react"
import { View } from "react-native"

type Chip = { value: string, label: string, count: number }

type FilterSheetProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    type: ListType
    /** The type's lists before any filter: the chips offer only what is on them */
    lists: PhoneList[]
    /** The shown list; chip counts are its entries */
    status: string | null
    /** Its name, for the note on what the counts mean */
    statusName: string | null
    filters: ListsFilters
    setFilters: (update: (filters: ListsFilters) => ListsFilters) => void
    sort: string
    onSort: (sort: string) => void
    tagMap: Record<number, string[]> | undefined
    showAdult: boolean
    /** Entries of the shown list after the filters */
    resultCount: number
    canReset: boolean
    onReset: () => void
}

/** "Filter & sort" (lists-phone-filters.tsx): every desktop filter and sort, as chips and selects; changes apply at once. */
export function ListsFilterSheet(props: FilterSheetProps) {
    const t = useTr()
    const { open, type, lists, status, statusName, filters, setFilters, tagMap, showAdult } = props
    const [tagQuery, setTagQuery] = React.useState("")
    const [allTags, setAllTags] = React.useState(false)

    // The tag search and "Show all" belong to one visit of the sheet (a query left from before could hide every tag).
    const [wasOpen, setWasOpen] = React.useState(open)
    if (wasOpen !== open) {
        setWasOpen(open)
        if (open) {
            setTagQuery("")
            setAllTags(false)
        }
    }

    // Counted only while open; the last counts stay while the sheet animates out.
    const facets = useLastData(React.useMemo(() => !open ? undefined : {
        genres: countValues(lists, status, media => media.genres ?? []),
        formats: countValues(lists, status, media => [media.format]),
        releases: countValues(lists, status, media => [media.status]),
        seasons: countValues(lists, status, media => [media.season]),
        tags: countValues(lists, status, media => tagMap?.[media.id] ?? []),
        years: getListYears(type, lists),
    }, [open, lists, status, type, tagMap]))

    const adultTags = filters.adult && showAdult
    const tagChips = React.useMemo(() => facets ? getTagChips(facets.tags, filters.tags, { adult: adultTags, query: tagQuery, expanded: allTags }) : null,
        [facets, filters.tags, adultTags, tagQuery, allTags])

    const set = (patch: Partial<ListsFilters>) => setFilters(current => ({ ...current, ...patch }))
    const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value]
    const single = (current: string | null, value: string) => current === value ? null : value
    const clear = (onPress: () => void, name: string) => <TextAction label={t("Clear", "Abwählen")} onPress={onPress} accessibilityLabel={t(`Clear ${name}`, `${name} abwählen`)} />
    const named = (labels: Record<string, [string, string]>) => ({ value, count }: FacetCount): Chip => ({ value, label: t(...(labels[value] ?? [value, value])), count })
    const plain = ({ value, count }: FacetCount): Chip => ({ value, label: value, count })

    const genres = facets ? genreFacet(facets.genres, filters.genres) : []
    const formats = facets && type === "anime" ? orderedFacet(facets.formats, ANIME_FORMATS, filters.format) : []
    const releases = facets ? orderedFacet(facets.releases, RELEASE_STATUSES, filters.status) : []
    const seasons = facets && type === "anime" ? orderedFacet(facets.seasons, SEASONS, filters.season) : []
    const years = facets?.years ?? []
    const yearOptions = filters.year && !years.includes(filters.year) ? [filters.year, ...years] : years
    const count = props.resultCount
    const releaseTitle = type === "anime" ? t("Airing", "Ausstrahlung") : t("Publishing", "Veröffentlichung")

    return (
        <Sheet title={t("Filter & sort", "Filtern & sortieren")} open={open} onOpenChange={props.onOpenChange}
            // "zeigen", not "anzeigen": the shorter label keeps one line on a narrow phone with large text.
            footer={<Button wrapperClassName="flex-1" onPress={() => props.onOpenChange(false)}>
                {type === "anime" ? t(`Show ${count} anime`, `${count} Anime zeigen`) : t(`Show ${count} manga`, `${count} Manga zeigen`)}
            </Button>}>
            {/* What the numbers count, and the reset up here: a two-button footer took a third of the screen with large text. */}
            {/* no -.5rem pull-up as in .pl-sheet-intro: here the title sits outside the scroll view, which clipped the line */}
            <View className="flex-row flex-wrap items-center justify-between gap-x-3">
                <Muted style={{ flexGrow: 1, flexBasis: 192 }} className="leading-[19.5px]">{statusName
                    ? t(`Numbers count the titles in ${statusName}. Filters apply to every list.`, `Die Zahlen zählen die Titel in „${statusName}“. Die Filter gelten für alle Listen.`)
                    : t("Filters apply to every list.", "Die Filter gelten für alle Listen.")}</Muted>
                {props.canReset && <View className="-mr-2"><TextAction label={t("Reset", "Zurücksetzen")} onPress={props.onReset} /></View>}
            </View>

            <SheetGroup title={t("Sort by", "Sortieren nach")}>
                <Select accessibilityLabel={t("Sort by", "Sortieren nach")} placeholder={t("Sort by", "Sortieren nach")} value={props.sort} onValueChange={props.onSort}
                    options={LISTS_SORTING_OPTIONS.map(option => ({ value: option.value, label: t(option.en, option.de) }))} />
            </SheetGroup>

            {genres.length > 0 && (
                <SheetGroup title="Genres" intro={t("Titles must have every selected genre.", "Titel müssen alle gewählten Genres haben.")}
                    action={filters.genres.length > 0 ? clear(() => set({ genres: [] }), t("genres", "Genres")) : undefined}>
                    <SplitChips label="Genres" chips={genres.map(plain)} selected={filters.genres} showCheck
                        onToggle={value => setFilters(current => ({ ...current, genres: toggle(current.genres, value) }))} />
                </SheetGroup>
            )}

            {formats.length > 0 && (
                <SheetGroup title="Format">
                    <SplitChips label="Format" chips={formats.map(named(FORMAT_LABELS))} selected={filters.format ? [filters.format] : []}
                        onToggle={value => setFilters(current => ({ ...current, format: single(current.format, value) }))} />
                </SheetGroup>
            )}

            {releases.length > 0 && (
                <SheetGroup title={releaseTitle}>
                    <SplitChips label={releaseTitle} chips={releases.map(named(RELEASE_LABELS))} selected={filters.status ? [filters.status] : []}
                        onToggle={value => setFilters(current => ({ ...current, status: single(current.status, value) }))} />
                </SheetGroup>
            )}

            {seasons.length > 0 && (
                <SheetGroup title={t("Season", "Saison")}>
                    <SplitChips label={t("Season", "Saison")} chips={seasons.map(named(SEASON_LABELS))} selected={filters.season ? [filters.season] : []}
                        onToggle={value => setFilters(current => ({ ...current, season: single(current.season, value) }))} />
                </SheetGroup>
            )}

            {yearOptions.length > 0 && (
                <SheetGroup title={t("Year", "Jahr")}>
                    <Select accessibilityLabel={t("Year", "Jahr")} placeholder={t("Any year", "Alle Jahre")} value={filters.year ?? ""} onValueChange={value => set({ year: value || null })}
                        options={[{ value: "", label: t("Any year", "Alle Jahre") }, ...yearOptions.map(year => ({ value: year, label: year }))]} />
                </SheetGroup>
            )}

            {showAdult && (
                <View className="overflow-hidden rounded-surface">
                    <SwitchRow label={t("Only adult titles", "Nur Titel für Erwachsene")} description={t("Shows adult tags too.", "Zeigt auch Tags für Erwachsene.")}
                        checked={filters.adult} onCheckedChange={adult => set({ adult })} />
                </View>
            )}

            {!!tagChips && (tagChips.available > 0 || filters.tags.length > 0) && (
                <SheetGroup title="Tags" intro={t("Titles must have every selected tag.", "Titel müssen alle gewählten Tags haben.")}
                    action={filters.tags.length > 0 ? clear(() => set({ tags: [] }), t("tags", "Tags")) : undefined}>
                    {/* A typed query keeps its field, even when fewer tags remain than the field needs. */}
                    {(tagChips.available > TAG_CHIP_LIMIT || !!tagQuery) && <SearchField value={tagQuery} onChangeText={setTagQuery} placeholder={t("Search tags", "Tags suchen")} />}
                    {tagChips.chips.length > 0
                        ? <SplitChips label="Tags" chips={tagChips.chips.map(plain)} selected={filters.tags} showCheck
                            onToggle={value => setFilters(current => ({ ...current, tags: toggle(current.tags, value) }))} />
                        : <Muted>{t("No tag matches the search.", "Kein Tag passt zur Suche.")}</Muted>}
                    {tagChips.chips.length < tagChips.total && (
                        // lists-phone-filters.tsx: a `.ps-more` line here, not the search sheet's text action
                        <MoreAction label={t(`Show all ${tagChips.total} tags`, `Alle ${tagChips.total} Tags zeigen`)} onPress={() => setAllTags(true)} />
                    )}
                </SheetGroup>
            )}
        </Sheet>
    )
}

/**
 * Chips with hits in the shown list, then on their own row and quieter the ones without: they still filter the other lists,
 * but "Comedy 0" next to "Action 3" read as "no Comedy on my list".
 */
function SplitChips({ label, chips, selected, onToggle, showCheck }: {
    label: string
    chips: Chip[]
    selected: string[]
    onToggle: (value: string) => void
    showCheck?: boolean
}) {
    const t = useTr()
    const hits = chips.filter(chip => !!chip.count)
    const rest = chips.filter(chip => !chip.count).map(chip => ({ value: chip.value, label: chip.label }))
    return (
        <View className="gap-2">
            {hits.length > 0 && <Choices label={label} chips={hits} selected={selected} onToggle={onToggle} showCheck={showCheck} />}
            {rest.length > 0 && <Choices label={t(`${label}, none in this list`, `${label}, keine in dieser Liste`)} chips={rest} selected={selected}
                onToggle={onToggle} showCheck={showCheck} quiet />}
        </View>
    )
}
