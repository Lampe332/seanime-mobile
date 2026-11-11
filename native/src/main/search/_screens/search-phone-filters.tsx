import { Choices, SearchField, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Select } from "@/components/ui/select/select"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Muted } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
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
    type SearchOption,
    type SearchPhoneState,
    searchStatuses,
    searchTagChoices,
    searchYears,
    toggleValue,
} from "@/main/search/_lib/search-phone"
import React from "react"
import { View } from "react-native"

type Draft = (change: (draft: SearchPhoneState) => SearchPhoneState) => void

/**
 * The phone search's filter sheet (search-phone-filters.tsx): every filter but the type, the title and the sort, which
 * sit on the page. It edits a draft that the screen applies when the sheet closes (Show results, Back, ✕).
 */
export function SearchPhoneFilters({ open, onOpenChange, draft, onDraft, adultAllowed }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    draft: SearchPhoneState
    onDraft: Draft
    adultAllowed: boolean
}) {
    const t = useTr()
    const active = searchFilterChips(t, draft, adultAllowed).length
    return (
        <Sheet title={t("Filters", "Filter")} open={open} onOpenChange={onOpenChange}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" disabled={!active} onPress={() => onDraft(clearSearchFilters)}>{t("Reset", "Zurücksetzen")}</Button>
                <Button wrapperClassName="flex-[2]" onPress={() => onOpenChange(false)}>{t("Show results", "Ergebnisse zeigen")}</Button>
            </>}>
            {/* Mounted only while the sheet is open, so the tag search starts empty each time */}
            {open && <FilterGroups t={t} draft={draft} onDraft={onDraft} adultAllowed={adultAllowed} />}
        </Sheet>
    )
}

/** The groups, short ones first; the tag list with its own search comes last so it does not push them off screen. */
function FilterGroups({ t, draft, onDraft, adultAllowed }: { t: Translate, draft: SearchPhoneState, onDraft: Draft, adultAllowed: boolean }) {
    const [tagQuery, setTagQuery] = React.useState("")
    const [allTags, setAllTags] = React.useState(false)
    const change = (patch: Partial<SearchPhoneState>) => onDraft(current => ({ ...current, ...patch }))
    // One choice: tapping the chosen one again clears it ("any")
    const pick = (key: "format" | "season" | "status" | "country") => (value: string) => onDraft(current => ({ ...current, [key]: current[key] === value ? null : value }))
    const chips = (options: SearchOption[]) => options.map(option => ({ value: option.value, label: t(option.en, option.de) }))
    const clear = (patch: Partial<SearchPhoneState>, name: string) => <TextAction label={t("Clear", "Abwählen")} onPress={() => change(patch)} accessibilityLabel={t(`Clear ${name}`, `${name} abwählen`)} />

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
    const statusTitle = draft.type === "anime" ? t("Airing status", "Ausstrahlung") : t("Publishing status", "Veröffentlichung")

    // AniList narrows by every chosen genre and tag (genre_in / tag_in), which several chosen chips would not tell.
    return <>
        <SheetGroup title={t("Genres", "Genres")} intro={t("Titles must have every selected genre.", "Titel müssen alle gewählten Genres haben.")}
            action={draft.genres.length > 0 && clear({ genres: [] }, t("genres", "Genres"))}>
            <Choices label={t("Genres", "Genres")} chips={genres} selected={draft.genres} showCheck onToggle={genre => change({ genres: toggleValue(draft.genres, genre) })} />
        </SheetGroup>

        <SheetGroup title={t("Format", "Format")}>
            <Choices label={t("Format", "Format")} chips={chips(draft.type === "anime" ? SEARCH_ANIME_FORMATS : SEARCH_MANGA_FORMATS)} selected={one(draft.format)} onToggle={pick("format")} />
        </SheetGroup>

        {draft.type === "anime"
            ? <SheetGroup title={t("Season", "Saison")}>
                <Choices label={t("Season", "Saison")} chips={chips(SEARCH_SEASONS)} selected={one(draft.season)} onToggle={pick("season")} />
            </SheetGroup>
            : <SheetGroup title={t("Country", "Land")}>
                <Choices label={t("Country", "Land")} chips={chips(SEARCH_COUNTRIES)} selected={one(draft.country)} onToggle={pick("country")} />
            </SheetGroup>}

        <SheetGroup title={t("Year", "Jahr")}>
            <Select accessibilityLabel={t("Year", "Jahr")} placeholder={t("Any year", "Alle Jahre")} value={draft.year ? String(draft.year) : ""}
                onValueChange={value => change({ year: value ? Number(value) : null })}
                options={[{ value: "", label: t("Any year", "Alle Jahre") }, ...years.map(year => ({ value: String(year), label: String(year) }))]} />
        </SheetGroup>

        <SheetGroup title={statusTitle}>
            <Choices label={statusTitle} chips={chips(searchStatuses(draft.type))} selected={one(draft.status)} onToggle={pick("status")} />
        </SheetGroup>

        <SheetGroup title={t("Minimum score", "Mindestwertung")}>
            <Select accessibilityLabel={t("Minimum score", "Mindestwertung")} placeholder={t("Any score", "Alle Wertungen")} value={draft.minScore ? String(draft.minScore) : ""}
                onValueChange={value => change({ minScore: value ? Number(value) : null })}
                options={[{ value: "", label: t("Any score", "Alle Wertungen") }, ...SEARCH_MIN_SCORES.map(score => ({ value: String(score), label: `${score}+` }))]} />
        </SheetGroup>

        {adultAllowed && (
            <SwitchRow label={t("Adult titles only", "Nur Titel ab 18")} checked={draft.adult}
                description={t("Shows only titles for adults and adds the adult tags.", "Zeigt nur Titel für Erwachsene und ergänzt die passenden Tags.")}
                onCheckedChange={checked => change({ adult: checked, tags: checked ? draft.tags : draft.tags.filter(tag => !isAdultTag(tag)) })} />
        )}

        <SheetGroup title={t("Tags", "Tags")} intro={t("Titles must have every selected tag.", "Titel müssen alle gewählten Tags haben.")}
            action={draft.tags.length > 0 && clear({ tags: [] }, t("tags", "Tags"))}>
            <SearchField value={tagQuery} placeholder={t("Find a tag", "Tag suchen")} onChangeText={value => {
                setTagQuery(value)
                setAllTags(false)
            }} />
            {tags.tags.length > 0
                ? <Choices label={t("Tags", "Tags")} chips={tags.tags.map(tag => ({ value: tag, label: tag }))} selected={draft.tags} showCheck
                    onToggle={tag => change({ tags: toggleValue(draft.tags, tag) })} />
                : <Muted>{t(`No tag matches “${tagQuery.trim()}”.`, `Kein Tag passt zu „${tagQuery.trim()}“.`)}</Muted>}
            {tags.more && <View className="-ml-2 self-start"><TextAction label={t(`Show all ${tags.total}`, `Alle ${tags.total} zeigen`)} onPress={() => setAllTags(true)} /></View>}
        </SheetGroup>
    </>
}
