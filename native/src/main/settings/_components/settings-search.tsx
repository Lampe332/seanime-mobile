import { SearchField } from "@/components/shared/phone-kit"
import { cn } from "@/components/ui/core/styling"
import { Muted, Text } from "@/components/ui/text/text"
import { type AppLanguage, getAppLanguage, translate, type Translate } from "@/lib/app-language"
import { useThemeColors } from "@/lib/theme/appearance"
import { BANNER_PRESET_ASSETS } from "@/lib/theme/banner-presets"
import { resolveBanner } from "@/lib/theme/home-banner"
import { useSettingValue, useThemeValue } from "@/main/settings/_components/settings-kit"
import type { SettingsSectionId } from "@/main/settings/_lib/settings-phone"
import { buildSearchDocs, type SearchConditions, searchSettings, type SettingsSearchDoc, type SettingsSearchSection } from "@/main/settings/_lib/settings-search"
import { SETTINGS_SEARCH_INDEX } from "@/main/settings/_lib/settings-search-index"
import { useStaggeredCount } from "@/main/settings/_components/use-staggered-count"
import { useRowValue } from "@/main/settings/_screens/settings-torrents"
import type { LucideIcon } from "lucide-react-native"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * The search over all settings: the field at the top of the list of areas and, while a word stands in it, the hits in the
 * list's place. A hit shows the row's name, where it is ("Appearance › Sorting") and its sentence; tapping it opens the
 * area on that row (settings-page.tsx `focus`).
 * Typing stays light: the documents are built once per language and only when the first letter is typed, a keystroke
 * compares some 250 short strings, and the hits render from the deferred word, so the field never waits for the list.
 */

export type SearchSection = SettingsSearchSection & { icon: LucideIcon }

let built: { language: AppLanguage, sections: readonly SearchSection[], docs: SettingsSearchDoc[] } | null = null

function searchDocs(language: AppLanguage, sections: readonly SearchSection[]) {
    if (built?.language !== language || built.sections !== sections) {
        built = { language, sections, docs: buildSearchDocs(SETTINGS_SEARCH_INDEX, sections, (en, de) => translate(language, en, de)) }
    }
    return built.docs
}

/** The states the pages show rows under (SEARCH_CONDITIONS), read as the pages read them */
function useSearchConditions(tablet: boolean): SearchConditions {
    const banner = !!resolveBanner(useThemeValue("libraryScreenCustomBannerImage"), BANNER_PRESET_ASSETS)
    const hideSpoilers = useThemeValue("hideAnimeSpoilers")
    const adult = useSettingValue("anilist.enableAdultContent", false)
    const cacheDisabled = useSettingValue("anilist.disableCacheLayer", false)
    const stream = useRowValue("torrentstream", "enabled", false)
    const streamAutoSelect = useRowValue("torrentstream", "autoSelect", false)
    const debrid = useRowValue("debrid", "enabled", false)
    const debridAutoSelect = useRowValue("debrid", "streamAutoSelect", false)
    return React.useMemo(() => ({
        "SettingsUISection:!tablet": !tablet,
        "BannerGroup:!!shown": banner,
        "SettingsAppSection:hideSpoilers": !!hideSpoilers,
        "SettingsAppSection:adult": !!adult,
        "SettingsAppSection:!cacheDisabled": !cacheDisabled,
        "StreamingGroup:enabled": !!stream,
        "StreamingGroup:autoSelect": !!streamAutoSelect,
        "DebridGroup:enabled": !!debrid,
        "DebridGroup:autoSelect": !!debridAutoSelect,
    }), [tablet, banner, hideSpoilers, adult, cacheDisabled, stream, streamAutoSelect, debrid, debridAutoSelect])
}

export function SettingsSearch({ t, sections, query, onQuery, onOpen, compact, tablet = false, children }: {
    t: Translate
    sections: readonly SearchSection[]
    query: string
    onQuery: (query: string) => void
    onOpen: (hit: SettingsSearchDoc) => void
    /** the narrow list pane of a tablet: no icons, so the texts keep their room */
    compact?: boolean
    /** the areas show beside the list (SectionContent `tablet`) */
    tablet?: boolean
    /** the list of areas, shown while the field is empty */
    children: React.ReactNode
}) {
    const language = getAppLanguage()
    // The typed word lives here, so a keystroke re-renders the field and the hits, not the settings screen around them;
    // the screen hears of it when the field empties or fills and before a hit opens (it keeps the word for Back).
    const [text, setText] = React.useState(query)
    const [shownQuery, setShownQuery] = React.useState(query)
    if (query !== shownQuery) {
        setShownQuery(query)
        setText(query)
    }
    const onText = (value: string) => {
        setText(value)
        if ((value.trim() === "") !== (query.trim() === "")) onQuery(value)
    }
    const textRef = React.useRef(text)
    React.useEffect(() => {
        textRef.current = text
    }, [text])
    const openHit = React.useCallback((hit: SettingsSearchDoc) => {
        if (textRef.current !== query) onQuery(textRef.current)
        onOpen(hit)
    }, [onOpen, onQuery, query])
    const word = React.useDeferredValue(text)
    const searching = word.trim() !== ""
    const conditions = useSearchConditions(tablet)
    const hits = React.useMemo(() => searching ? searchSettings(searchDocs(language, sections), word, undefined, conditions) : NO_HITS,
        [conditions, language, searching, sections, word])
    const showHits = searching && text.trim() !== ""
    return (
        <View className="gap-4">
            <SearchField value={text} onChangeText={onText} placeholder={t("Search settings", "Einstellungen durchsuchen")} />
            {/* the areas stay mounted under the hits (hidden), so emptying the field shows them without building them again */}
            <View style={showHits ? HIDDEN : undefined}>{children}</View>
            {showHits && <SearchHits t={t} hits={hits} sections={sections} onOpen={openHit} compact={compact} />}
        </View>
    )
}

const NO_HITS: SettingsSearchDoc[] = []
const HIDDEN = { display: "none" } as const
/** the hits above the open keyboard (S22: about four); the rest follow a few per frame */
const FIRST_HITS = 5
/** hits mounted per further frame: eight with their three-line notes in one frame were too much (S22 26.11., typing "player" 27 % janky) */
const HITS_PER_FRAME = 4

const SearchHits = React.memo(function SearchHits({ t, hits, sections, onOpen, compact }: {
    t: Translate
    hits: SettingsSearchDoc[]
    sections: readonly SearchSection[]
    onOpen: (hit: SettingsSearchDoc) => void
    compact?: boolean
}) {
    const colors = useThemeColors()
    const icons = React.useMemo(() => Object.fromEntries(sections.map(section => [section.id, section.icon])) as Record<SettingsSectionId, LucideIcon>, [sections])
    // the first hits fill the screen in the first frame, the rest follow a few per frame (all of them at once was 75 ms)
    const shown = useStaggeredCount(hits.length, FIRST_HITS, HITS_PER_FRAME)
    if (hits.length === 0) {
        return (
            <View accessible accessibilityLiveRegion="polite" className="items-center gap-1 px-4 py-10">
                <Text className="text-center text-base font-semibold">{t("No setting found", "Keine Einstellung gefunden")}</Text>
                <Muted className="text-center text-[13px] leading-[19px]">{t("Try another word or a shorter one.", "Versuch ein anderes oder ein kürzeres Wort.")}</Muted>
            </View>
        )
    }
    return (
        <View accessibilityLabel={t("Search results", "Suchergebnisse")} className="gap-0.5 overflow-hidden rounded-surface">
            {hits.slice(0, shown).map(hit => <HitRow key={hit.id} hit={hit} Icon={compact ? undefined : icons[hit.section]} accent={colors.smAccent} onOpen={onOpen} />)}
        </View>
    )
})

/** One hit; the documents are built once per language, so a row re-renders only when its hit or the callbacks change */
const HitRow = React.memo(function HitRow({ hit, Icon, accent, onOpen }: {
    hit: SettingsSearchDoc
    Icon?: LucideIcon
    accent: string
    onOpen: (hit: SettingsSearchDoc) => void
}) {
    return (
        <Pressable accessibilityRole="button" onPress={() => onOpen(hit)}
            accessibilityLabel={[hit.title, hit.path, hit.note].filter(Boolean).join(", ")}
            className={cn("min-h-16 w-full flex-row items-center bg-sm-surface-raised py-3 active:bg-sm-surface-control", Icon ? "gap-3.5 px-4" : "px-3.5")}>
            {Icon && <Icon size={22} color={accent} />}
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base">{hit.title}</Text>
                {!!hit.path && <Text numberOfLines={1} className="text-xs font-medium text-sm-accent">{hit.path}</Text>}
                {!!hit.note && <Muted numberOfLines={3} className="text-[13px] leading-[19px]">{hit.note}</Muted>}
            </View>
        </Pressable>
    )
})
