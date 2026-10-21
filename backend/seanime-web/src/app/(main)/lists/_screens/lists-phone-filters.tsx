import {
    FORMAT_LABELS,
    PhoneChip,
    PhoneChips,
    PhoneSearchField,
    PhoneSelect,
    PhoneSheet,
    PhoneSheetGroup,
    PhoneSwitch,
    SEASON_LABELS,
    useLastData,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import {
    ANIME_FORMATS,
    countValues,
    FacetCount,
    genreFacet,
    getListYears,
    getTagChips,
    LISTS_SORTING_OPTIONS,
    ListsFilters,
    ListType,
    orderedFacet,
    PhoneList,
    RELEASE_LABELS,
    RELEASE_STATUSES,
    SEASONS,
    TAG_CHIP_LIMIT,
} from "@/app/(main)/lists/_lib/lists-phone"
import { Translate } from "@/lib/app-language"
import React from "react"
import { LuChevronDown } from "react-icons/lu"

type FilterSheetProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    returnFocusRef: React.RefObject<HTMLButtonElement | null>
    t: Translate
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

/** "Filter & sort": every desktop filter and sort, as chips and native selects; changes apply at once. */
export function ListsFilterSheet(props: FilterSheetProps) {
    const { open, t, type, lists, status, statusName, filters, setFilters, tagMap, showAdult } = props
    const [tagQuery, setTagQuery] = React.useState("")
    const [allTags, setAllTags] = React.useState(false)
    const introRef = React.useRef<HTMLDivElement>(null)

    // The tag search and "Show all" belong to one visit of the sheet (a query left from before could hide every tag).
    React.useLayoutEffect(() => {
        if (!open) return
        setTagQuery("")
        setAllTags(false)
    }, [open])

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
    const clear = (onClick: () => void) => <button type="button" className="ps-text-action" onClick={onClick}>{t("Clear", "Abwählen")}</button>
    const named = (labels: Record<string, [string, string]>) => ({ value, count }: FacetCount): PhoneChip => ({ value, label: t(...(labels[value] ?? [value, value])), count })
    const plain = ({ value, count }: FacetCount): PhoneChip => ({ value, label: value, count })
    // Reset leaves with what it reset: the focus goes to the sheet, not to the page behind it.
    const reset = () => {
        props.onReset()
        requestAnimationFrame(() => introRef.current?.closest<HTMLElement>("[role=\"dialog\"]")?.focus())
    }

    const genres = facets ? genreFacet(facets.genres, filters.genres) : []
    const formats = facets && type === "anime" ? orderedFacet(facets.formats, ANIME_FORMATS, filters.format) : []
    const releases = facets ? orderedFacet(facets.releases, RELEASE_STATUSES, filters.status) : []
    const seasons = facets && type === "anime" ? orderedFacet(facets.seasons, SEASONS, filters.season) : []
    const years = facets?.years ?? []
    const yearOptions = filters.year && !years.includes(filters.year) ? [filters.year, ...years] : years
    const count = props.resultCount
    const releaseTitle = type === "anime" ? t("Airing", "Ausstrahlung") : t("Publishing", "Veröffentlichung")

    return <PhoneSheet title={t("Filter & sort", "Filtern & sortieren")} open={open} onOpenChange={props.onOpenChange} returnFocusRef={props.returnFocusRef}
        data-lists-filters footer={<button type="button" className="ps-primary" onClick={() => props.onOpenChange(false)} data-lists-filter-done>
        {/* "zeigen", not "anzeigen": the shorter label keeps one line at 320 px with 200 % text. */}
        {type === "anime" ? t(`Show ${count} anime`, `${count} Anime zeigen`) : t(`Show ${count} manga`, `${count} Manga zeigen`)}
    </button>}>
        {/* What the numbers count, and the reset up here: a two-button footer took a third of the screen with large text. */}
        <div ref={introRef} className="pl-sheet-intro">
            <p className="ps-sheet-note" data-lists-filter-note>{statusName
                ? t(`Numbers count the titles in ${statusName}. Filters apply to every list.`, `Die Zahlen zählen die Titel in „${statusName}“. Die Filter gelten für alle Listen.`)
                : t("Filters apply to every list.", "Die Filter gelten für alle Listen.")}</p>
            {props.canReset && <button type="button" className="ps-text-action" onClick={reset} data-lists-filter-reset>{t("Reset", "Zurücksetzen")}</button>}
        </div>

        <PhoneSheetGroup title={t("Sort by", "Sortieren nach")}>
            <WrapSelect id="pl-sort" label={t("Sort by", "Sortieren nach")} value={props.sort} onChange={props.onSort} data-lists-sort
                options={LISTS_SORTING_OPTIONS.map(option => ({ value: option.value, label: t(option.en, option.de) }))} />
        </PhoneSheetGroup>

        {genres.length > 0 && <PhoneSheetGroup title="Genres" note={t("Titles must have every selected genre.", "Titel müssen alle gewählten Genres haben.")}
            action={filters.genres.length > 0 ? clear(() => set({ genres: [] })) : undefined}>
            <SplitChips t={t} label="Genres" chips={genres.map(plain)} selected={filters.genres} showCheck data-lists-genres
                onToggle={value => setFilters(current => ({ ...current, genres: toggle(current.genres, value) }))} />
        </PhoneSheetGroup>}

        {formats.length > 0 && <PhoneSheetGroup title="Format">
            <SplitChips t={t} label="Format" chips={formats.map(named(FORMAT_LABELS))} selected={filters.format ? [filters.format] : []} data-lists-formats
                onToggle={value => setFilters(current => ({ ...current, format: single(current.format, value) }))} />
        </PhoneSheetGroup>}

        {releases.length > 0 && <PhoneSheetGroup title={releaseTitle}>
            <SplitChips t={t} label={releaseTitle} chips={releases.map(named(RELEASE_LABELS))} selected={filters.status ? [filters.status] : []} data-lists-releases
                onToggle={value => setFilters(current => ({ ...current, status: single(current.status, value) }))} />
        </PhoneSheetGroup>}

        {seasons.length > 0 && <PhoneSheetGroup title={t("Season", "Saison")}>
            <SplitChips t={t} label={t("Season", "Saison")} chips={seasons.map(named(SEASON_LABELS))} selected={filters.season ? [filters.season] : []}
                data-lists-seasons onToggle={value => setFilters(current => ({ ...current, season: single(current.season, value) }))} />
        </PhoneSheetGroup>}

        {yearOptions.length > 0 && <PhoneSheetGroup title={t("Year", "Jahr")}>
            <PhoneSelect id="pl-year" label={t("Year", "Jahr")} value={filters.year ?? ""} onChange={value => set({ year: value || null })} data-lists-year
                options={[{ value: "", label: t("Any year", "Alle Jahre") }, ...yearOptions.map(year => ({ value: year, label: year }))]} />
        </PhoneSheetGroup>}

        {showAdult && <div className="ps-rows">
            <PhoneSwitch label={t("Only adult titles", "Nur Titel für Erwachsene")} note={t("Shows adult tags too.", "Zeigt auch Tags für Erwachsene.")}
                checked={filters.adult} onChange={adult => set({ adult })} data-lists-adult />
        </div>}

        {!!tagChips && (tagChips.available > 0 || filters.tags.length > 0) && <PhoneSheetGroup title="Tags"
            note={t("Titles must have every selected tag.", "Titel müssen alle gewählten Tags haben.")}
            action={filters.tags.length > 0 ? clear(() => set({ tags: [] })) : undefined}>
            {/* A typed query keeps its field, even when fewer tags remain than the field needs. */}
            {(tagChips.available > TAG_CHIP_LIMIT || !!tagQuery) && <PhoneSearchField t={t} value={tagQuery} onChange={setTagQuery}
                placeholder={t("Search tags", "Tags suchen")} data-lists-tag-search />}
            {tagChips.chips.length > 0
                ? <SplitChips t={t} label="Tags" chips={tagChips.chips.map(plain)} selected={filters.tags} showCheck data-lists-tags
                    onToggle={value => setFilters(current => ({ ...current, tags: toggle(current.tags, value) }))} />
                : <p className="ps-sheet-note">{t("No tag matches the search.", "Kein Tag passt zur Suche.")}</p>}
            {tagChips.chips.length < tagChips.total && <button type="button" className="ps-more" onClick={() => setAllTags(true)} data-lists-tags-more>
                {t(`Show all ${tagChips.total} tags`, `Alle ${tagChips.total} Tags zeigen`)}
            </button>}
        </PhoneSheetGroup>}
    </PhoneSheet>
}

type SplitChipsProps = {
    t: Translate
    label: string
    chips: PhoneChip[]
    selected: string[]
    onToggle: (value: string) => void
    showCheck?: boolean
} & { [key: `data-${string}`]: boolean }

/**
 * Chips with hits in the shown list, then on their own row and quieter the ones without: they still filter the other lists,
 * but "Comedy 0" next to "Action 3" read as "no Comedy on my list".
 */
function SplitChips({ t, label, chips, selected, onToggle, showCheck, ...data }: SplitChipsProps) {
    const hits = chips.filter(chip => !!chip.count)
    const rest = chips.filter(chip => !chip.count)
    return <div className="pl-chip-groups" {...data}>
        {hits.length > 0 && <PhoneChips label={label} variant="wrap" showCheck={showCheck} chips={hits} selected={selected} onToggle={onToggle} />}
        {rest.length > 0 && <PhoneChips label={t(`${label}, none in this list`, `${label}, keine in dieser Liste`)} variant="wrap" className="pl-chips-quiet"
            showCheck={showCheck} chips={rest} selected={selected} onToggle={onToggle} />}
    </div>
}

/**
 * The native picker (Android's own, which Back closes) under a label that wraps: a plain select cuts the chosen sort off with
 * large text ("Höchste eige…"). Kit candidate.
 */
function WrapSelect({ id, label, value, onChange, options, ...data }: {
    id: string
    label: string
    value: string
    onChange: (value: string) => void
    options: { value: string, label: string }[]
} & { [key: `data-${string}`]: boolean }) {
    return <span className="ps-select-wrap pl-select">
        <span className="pl-select-text" aria-hidden>{options.find(option => option.value === value)?.label}</span>
        <select id={id} className="ps-select" value={value} aria-label={label} onChange={event => onChange(event.target.value)} {...data}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <LuChevronDown aria-hidden />
    </span>
}
