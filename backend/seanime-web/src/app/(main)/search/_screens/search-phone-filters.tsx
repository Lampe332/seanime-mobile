import { PhoneChip, PhoneSearchField, PhoneSelect, PhoneSheet, PhoneSheetGroup, PhoneSwitch } from "@/app/(main)/_features/phone-screen/phone-screen"
import {
    clearSearchFilters,
    isAdultTag,
    SEARCH_ANIME_FORMATS,
    SEARCH_COUNTRIES,
    SEARCH_GENRES,
    SEARCH_MANGA_FORMATS,
    SEARCH_MIN_SCORES,
    SEARCH_SEASONS,
    searchFilterChips,
    SearchOption,
    SearchPhoneState,
    searchStatuses,
    searchTagChoices,
    searchYears,
    toggleValue,
} from "@/app/(main)/search/_lib/search-phone"
import { cn } from "@/components/ui/core/styling"
import { Translate, useTr } from "@/lib/app-language"
import React from "react"
import { LuCheck } from "react-icons/lu"

type Draft = (change: (draft: SearchPhoneState) => SearchPhoneState) => void

/**
 * Chips that stay put under the finger. One choice (sort, format, season …) is a radio group without check marks;
 * several (genres, tags) are toggles with a check mark in the padding. A chosen chip keeps its width either way, so a
 * wrapping group does not reflow. Kit candidate: PhoneChips with single-choice semantics and a fixed width.
 */
export function SearchChips({ label, chips, selected, onSelect, multiple, variant = "wrap", ...data }: {
    label: string
    chips: PhoneChip[]
    selected: string[]
    onSelect: (value: string) => void
    multiple?: boolean
    variant?: "row" | "wrap"
} & { [key: `data-${string}`]: string | boolean | undefined }) {
    return <div className={cn(variant === "wrap" ? "ps-choices" : "ps-chips", "pq-chips")} role={multiple ? "group" : "radiogroup"} aria-label={label} {...data}>
        {chips.map(chip => {
            const chosen = selected.includes(chip.value)
            return <button key={chip.value} type="button" data-chip={chip.value} onClick={() => onSelect(chip.value)}
                {...multiple ? { "aria-pressed": chosen } : { role: "radio", "aria-checked": chosen }}>
                {multiple && <LuCheck aria-hidden />}
                <span data-text={chip.label}>{chip.label}</span>
            </button>
        })}
    </div>
}

/**
 * The phone search's filter sheet: every filter but the type, the title and the sort, which sit on the page. It edits a
 * draft that the screen applies when the sheet closes.
 */
export function SearchPhoneFilters({ open, onOpenChange, draft, onDraft, adultAllowed, returnFocusRef }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    draft: SearchPhoneState
    onDraft: Draft
    adultAllowed: boolean
    returnFocusRef: React.RefObject<HTMLElement | null>
}) {
    const t = useTr()
    const active = searchFilterChips(t, draft, adultAllowed).length
    return <PhoneSheet title={t("Filters", "Filter")} open={open} onOpenChange={onOpenChange} returnFocusRef={returnFocusRef} data-search-filters
        footer={<>
            <button type="button" className="ps-secondary" onClick={() => onDraft(clearSearchFilters)} disabled={!active} data-search-reset>
                {t("Reset", "Zurücksetzen")}
            </button>
            <button type="button" className="ps-primary" onClick={() => onOpenChange(false)} data-search-show>{t("Show results", "Ergebnisse zeigen")}</button>
        </>}>
        <FilterGroups t={t} draft={draft} onDraft={onDraft} adultAllowed={adultAllowed} />
    </PhoneSheet>
}

/**
 * The groups, short ones first; the tag list with its own search comes last so it does not push them off screen.
 * Mounted only while the sheet is open, so the tag search starts empty each time.
 */
function FilterGroups({ t, draft, onDraft, adultAllowed }: { t: Translate, draft: SearchPhoneState, onDraft: Draft, adultAllowed: boolean }) {
    const [tagQuery, setTagQuery] = React.useState("")
    const [allTags, setAllTags] = React.useState(false)
    const tagFieldRef = React.useRef<HTMLInputElement>(null)
    const change = (patch: Partial<SearchPhoneState>) => onDraft(current => ({ ...current, ...patch }))
    // One choice: tapping the chosen one again clears it ("any")
    const pick = (key: "format" | "season" | "status" | "country") => (value: string) => onDraft(current => ({ ...current, [key]: current[key] === value ? null : value }))
    const chips = (options: SearchOption[]) => options.map(option => ({ value: option.value, label: t(option.en, option.de) }))
    const clear = (patch: Partial<SearchPhoneState>, name: string) =>
        <button type="button" className="ps-text-action" onClick={() => change(patch)} aria-label={t(`Clear ${name}`, `${name} abwählen`)}>{t("Clear", "Abwählen")}</button>

    // A genre from a link that the list lacks ("Hentai") stays visible, so it can be undone.
    const genres = [...chips(SEARCH_GENRES), ...draft.genres.filter(genre => !SEARCH_GENRES.some(option => option.value === genre)).map(genre => ({ value: genre, label: genre }))]
    // A year from a link outside the list (1950) is added, so the picker can show it.
    const years = searchYears()
    if (draft.year && !years.includes(draft.year)) {
        years.push(draft.year)
        years.sort((a, b) => b - a)
    }
    const adult = adultAllowed && draft.adult
    const tags = searchTagChoices({ query: tagQuery, adult, selected: draft.tags.filter(tag => adult || !isAdultTag(tag)), all: allTags })
    const one = (value: string | null) => value ? [value] : []

    // AniList narrows by every chosen genre and tag (genre_in / tag_in), which several chosen chips would not tell.
    return <>
        <PhoneSheetGroup title={t("Genres", "Genres")} action={draft.genres.length > 0 && clear({ genres: [] }, t("genres", "Genres"))}
            note={t("Titles must have every selected genre.", "Titel müssen alle gewählten Genres haben.")}>
            <SearchChips label={t("Genres", "Genres")} chips={genres} selected={draft.genres} multiple data-search-genres
                onSelect={genre => change({ genres: toggleValue(draft.genres, genre) })} />
        </PhoneSheetGroup>

        <PhoneSheetGroup title={t("Format", "Format")}>
            <SearchChips label={t("Format", "Format")} chips={chips(draft.type === "anime" ? SEARCH_ANIME_FORMATS : SEARCH_MANGA_FORMATS)}
                selected={one(draft.format)} onSelect={pick("format")} data-search-format />
        </PhoneSheetGroup>

        {draft.type === "anime"
            ? <PhoneSheetGroup title={t("Season", "Saison")}>
                <SearchChips label={t("Season", "Saison")} chips={chips(SEARCH_SEASONS)} selected={one(draft.season)} onSelect={pick("season")} data-search-season />
            </PhoneSheetGroup>
            : <PhoneSheetGroup title={t("Country", "Land")}>
                <SearchChips label={t("Country", "Land")} chips={chips(SEARCH_COUNTRIES)} selected={one(draft.country)} onSelect={pick("country")} data-search-country />
            </PhoneSheetGroup>}

        <PhoneSheetGroup title={t("Year", "Jahr")}>
            <PhoneSelect id="pq-year" label={t("Year", "Jahr")} value={draft.year ? String(draft.year) : ""} data-search-year
                onChange={value => change({ year: value ? Number(value) : null })}
                options={[{ value: "", label: t("Any year", "Alle Jahre") }, ...years.map(year => ({ value: String(year), label: String(year) }))]} />
        </PhoneSheetGroup>

        <PhoneSheetGroup title={draft.type === "anime" ? t("Airing status", "Ausstrahlung") : t("Publishing status", "Veröffentlichung")}>
            <SearchChips label={draft.type === "anime" ? t("Airing status", "Ausstrahlung") : t("Publishing status", "Veröffentlichung")}
                chips={chips(searchStatuses(draft.type))} selected={one(draft.status)} onSelect={pick("status")} data-search-status />
        </PhoneSheetGroup>

        <PhoneSheetGroup title={t("Minimum score", "Mindestwertung")}>
            <PhoneSelect id="pq-score" label={t("Minimum score", "Mindestwertung")} value={draft.minScore ? String(draft.minScore) : ""} data-search-score
                onChange={value => change({ minScore: value ? Number(value) : null })}
                options={[{ value: "", label: t("Any score", "Alle Wertungen") }, ...SEARCH_MIN_SCORES.map(score => ({ value: String(score), label: `${score}+` }))]} />
        </PhoneSheetGroup>

        {adultAllowed && <div className="ps-rows">
            <PhoneSwitch label={t("Adult titles only", "Nur Titel ab 18")} checked={draft.adult} data-search-adult
                note={t("Shows only titles for adults and adds the adult tags.", "Zeigt nur Titel für Erwachsene und ergänzt die passenden Tags.")}
                onChange={checked => change({ adult: checked, tags: checked ? draft.tags : draft.tags.filter(tag => !isAdultTag(tag)) })} />
        </div>}

        <PhoneSheetGroup title={t("Tags", "Tags")} action={draft.tags.length > 0 && clear({ tags: [] }, t("tags", "Tags"))}
            note={t("Titles must have every selected tag.", "Titel müssen alle gewählten Tags haben.")}>
            <PhoneSearchField t={t} value={tagQuery} placeholder={t("Find a tag", "Tag suchen")} inputRef={tagFieldRef} data-search-tag-field
                onChange={value => {
                    setTagQuery(value)
                    setAllTags(false)
                    // The ✕ goes away with the words; the field keeps the focus for new ones.
                    if (!value) tagFieldRef.current?.focus()
                }} />
            {tags.tags.length > 0
                ? <SearchChips label={t("Tags", "Tags")} chips={tags.tags.map(tag => ({ value: tag, label: tag }))} selected={draft.tags} multiple
                    onSelect={tag => change({ tags: toggleValue(draft.tags, tag) })} data-search-tags />
                : <p className="ps-sheet-note" data-search-tags-empty>{t(`No tag matches “${tagQuery.trim()}”.`, `Kein Tag passt zu „${tagQuery.trim()}“.`)}</p>}
            {tags.more && <button type="button" className="ps-text-action pq-show-all" onClick={() => setAllTags(true)} data-search-all-tags>
                {t(`Show all ${tags.total}`, `Alle ${tags.total} zeigen`)}
            </button>}
        </PhoneSheetGroup>
    </>
}
