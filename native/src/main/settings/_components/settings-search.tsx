import { SearchField } from "@/components/shared/phone-kit"
import { cn } from "@/components/ui/core/styling"
import { Muted, Text } from "@/components/ui/text/text"
import { type AppLanguage, getAppLanguage, translate, type Translate } from "@/lib/app-language"
import { useThemeColors } from "@/lib/theme/appearance"
import type { SettingsSectionId } from "@/main/settings/_lib/settings-phone"
import { buildSearchDocs, searchSettings, type SettingsSearchDoc, type SettingsSearchSection } from "@/main/settings/_lib/settings-search"
import { SETTINGS_SEARCH_INDEX } from "@/main/settings/_lib/settings-search-index"
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

export function SettingsSearch({ t, sections, query, onQuery, onOpen, compact, children }: {
    t: Translate
    sections: readonly SearchSection[]
    query: string
    onQuery: (query: string) => void
    onOpen: (hit: SettingsSearchDoc) => void
    /** the narrow list pane of a tablet: no icons, so the texts keep their room */
    compact?: boolean
    /** the list of areas, shown while the field is empty */
    children: React.ReactNode
}) {
    const language = getAppLanguage()
    const word = React.useDeferredValue(query)
    const searching = word.trim() !== ""
    const hits = React.useMemo(() => searching ? searchSettings(searchDocs(language, sections), word) : NO_HITS, [language, searching, sections, word])
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
