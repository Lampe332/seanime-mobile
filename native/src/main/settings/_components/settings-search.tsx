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
    const word = React.useDeferredValue(query)
    const searching = word.trim() !== ""
    const conditions = useSearchConditions(tablet)
    const hits = React.useMemo(() => searching ? searchSettings(searchDocs(language, sections), word, undefined, conditions) : NO_HITS,
        [conditions, language, searching, sections, word])
    return (
        <View className="gap-4">
            <SearchField value={query} onChangeText={onQuery} placeholder={t("Search settings", "Einstellungen durchsuchen")} />
            {query.trim() === "" || !searching ? children : <SearchHits t={t} hits={hits} sections={sections} onOpen={onOpen} compact={compact} />}
        </View>
    )
}

const NO_HITS: SettingsSearchDoc[] = []

const SearchHits = React.memo(function SearchHits({ t, hits, sections, onOpen, compact }: {
    t: Translate
    hits: SettingsSearchDoc[]
    sections: readonly SearchSection[]
    onOpen: (hit: SettingsSearchDoc) => void
    compact?: boolean
}) {
    const colors = useThemeColors()
    const icons = React.useMemo(() => Object.fromEntries(sections.map(section => [section.id, section.icon])) as Record<SettingsSectionId, LucideIcon>, [sections])
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
            {hits.map(hit => {
                const Icon = icons[hit.section]
                return <Pressable key={hit.id} accessibilityRole="button" onPress={() => onOpen(hit)}
                    accessibilityLabel={[hit.title, hit.path, hit.note].filter(Boolean).join(", ")}
                    className={cn("min-h-16 w-full flex-row items-center bg-sm-surface-raised py-3 active:bg-sm-surface-control", compact ? "px-3.5" : "gap-3.5 px-4")}>
                    {!compact && <Icon size={22} color={colors.smAccent} />}
                    <View className="min-w-0 flex-1 gap-0.5">
                        <Text className="text-base">{hit.title}</Text>
                        {!!hit.path && <Text numberOfLines={1} className="text-xs font-medium text-sm-accent">{hit.path}</Text>}
                        {!!hit.note && <Muted numberOfLines={3} className="text-[13px] leading-[19px]">{hit.note}</Muted>}
                    </View>
                </Pressable>
            })}
        </View>
    )
})
