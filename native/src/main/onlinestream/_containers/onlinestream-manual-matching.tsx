import type { Anime_Entry } from "@/api/generated/types"
import {
    useGetOnlinestreamMapping,
    useOnlinestreamManualMapping,
    useOnlinestreamManualSearch,
    useRemoveOnlinestreamMapping,
} from "@/api/hooks/onlinestream.hooks"
import { RowGroup, SearchField } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Dialog, Sheet } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Muted, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { openInAppBrowser } from "@/lib/helpers/browser"
import { colors } from "@/lib/theme/tokens"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import ExternalLink from "lucide-react-native/icons/external-link"
import React from "react"
import { ActivityIndicator, Pressable, View } from "react-native"

/*
 * "Manual match" of the online stream page (web onlinestream-manual-matching.tsx, Android sheet): the current match with
 * Remove, one search row with the anime's title filled in, "Search dubs", large result rows; a tap asks before the title
 * is used, the ↗ opens the provider's page.
 */
export function OnlinestreamManualMappingSheet({ entry, provider, open, onOpenChange }: {
    entry: Anime_Entry
    provider: string
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTr()
    return <Sheet compact open={open} onOpenChange={onOpenChange} title={t("Manual match", "Manuell zuordnen")}
        description={t(`Pick the matching title on ${provider}.`, `Wähle den passenden Titel bei ${provider}.`)}>
        {open && <MatchContent entry={entry} provider={provider} />}
    </Sheet>
}

function MatchContent({ entry, provider }: { entry: Anime_Entry, provider: string }) {
    const t = useTr()
    const { data: existingMapping, isLoading: mappingLoading } = useGetOnlinestreamMapping({ provider, mediaId: entry.mediaId })
    const { mutate: search, data: results, isPending: searching, isSuccess, isError, reset } = useOnlinestreamManualSearch(entry.mediaId, provider)
    // Providers answer "no results" with an error, so both end in the same hint
    const searched = isSuccess || isError
    const { mutate: match, isPending: matching } = useOnlinestreamManualMapping()
    const { mutate: unmatch, isPending: unmatching } = useRemoveOnlinestreamMapping()
    // Provider searches match short titles best: start with the part before the subtitle
    const [query, setQuery] = React.useState((entry.media?.title?.romaji || entry.media?.title?.userPreferred || "").split(/[:：]/)[0].trim())
    const [dubbed, setDubbed] = React.useState(false)
    const [animeId, setAnimeId] = React.useState<string | null>(null)

    const runSearch = () => {
        if (query.trim() && !searching && !matching) search({ provider, query: query.trim(), dubbed })
    }

    return <View className="gap-4">
        <View accessibilityLiveRegion="polite" className="min-h-14 flex-row items-center gap-3 rounded-surface bg-sm-surface-raised px-4 py-2.5">
            {mappingLoading ? <ActivityIndicator color={colors.smAccent} /> : <>
                <View className="min-w-0 flex-1">
                    <Muted className="text-[13px]">{existingMapping?.animeId ? t("Matched to", "Zugeordnet zu") : t("Currently", "Aktuell")}</Muted>
                    <Text numberOfLines={1} className="text-[15px] font-semibold">{existingMapping?.animeId || t("Automatic match", "Automatische Zuordnung")}</Text>
                </View>
                {!!existingMapping?.animeId && <Button intent="text" disabled={unmatching} onPress={() => unmatch({ provider, mediaId: entry.mediaId })}>
                    {t("Remove", "Entfernen")}
                </Button>}
            </>}
        </View>

        <View className="flex-row items-center gap-2">
            <View className="min-w-0 flex-1">
                <SearchField value={query} onChangeText={setQuery} placeholder={t("Search title", "Titel suchen")} onSubmit={runSearch} />
            </View>
            <Button disabled={!query.trim() || searching || matching} onPress={runSearch}>{t("Search", "Suchen")}</Button>
        </View>

        <RowGroup>
            <SwitchRow label={t("Search dubs", "Nach Synchro suchen")} description={t("Only if the provider lists dubs separately", "Nur wenn der Anbieter Synchro getrennt führt")}
                checked={dubbed} onCheckedChange={setDubbed} />
        </RowGroup>

        {searching ? <ActivityIndicator color={colors.smAccent} />
            : searched && !results?.length ? <Muted className="text-center">{t("No titles found. Try a shorter or English title.", "Keine Titel gefunden. Versuche einen kürzeren oder englischen Titel.")}</Muted>
                : !!results?.length && <RowGroup>
                    {results.map(item => <View key={item.id} className="min-h-14 flex-row items-center bg-sm-surface-raised">
                        <Pressable accessibilityRole="button" onPress={() => setAnimeId(item.id)}
                            className="min-h-14 min-w-0 flex-1 flex-row items-center gap-3 px-4 py-2.5 active:bg-sm-surface-control">
                            <Text numberOfLines={2} className="min-w-0 flex-1 text-[15px]">{item.title}</Text>
                            <ChevronRight size={18} color={colors.smTextSubtle} />
                        </Pressable>
                        {!!item.url && <Pressable accessibilityRole="link" accessibilityLabel={t(`Open ${item.title} in browser`, `${item.title} im Browser öffnen`)}
                            onPress={() => openInAppBrowser(item.url)} className="h-14 w-14 items-center justify-center active:bg-sm-surface-control">
                            <ExternalLink size={18} color={colors.smTextMuted} />
                        </Pressable>}
                    </View>)}
                </RowGroup>}

        <Dialog open={!!animeId} onOpenChange={next => !next && setAnimeId(null)} title={t("Use this title?", "Diesen Titel verwenden?")}
            description={t("Episodes of this anime will be loaded from the selected title.", "Die Folgen dieses Anime werden vom gewählten Titel geladen.")}
            footer={<>
                <Button intent="secondary" onPress={() => setAnimeId(null)}>{t("Cancel", "Abbrechen")}</Button>
                <Button onPress={() => {
                    if (!animeId) return
                    match({ provider, mediaId: entry.mediaId, animeId })
                    reset()
                    setAnimeId(null)
                }}>{t("Use title", "Titel verwenden")}</Button>
            </>} />
    </View>
}
