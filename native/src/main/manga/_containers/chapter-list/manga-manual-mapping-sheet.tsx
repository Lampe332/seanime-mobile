import type { HibikeManga_SearchResult, Manga_Entry } from "@/api/generated/types"
import { useGetMangaMapping, useMangaManualMapping, useMangaManualSearch, usePreviewMangaMapping, useRemoveMangaMapping } from "@/api/hooks/manga.hooks"
import { SearchField } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Dialog, Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { useSelectedMangaProvider } from "@/main/manga/_lib/handle-manga-selected-provider"
import { useMangaReaderUtils } from "@/main/manga/_lib/handle-manga-utils"
import { Image } from "expo-image"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import React from "react"
import { ActivityIndicator, Pressable, View } from "react-native"

/*
 * "Manual match" (manga-manual-mapping-modal.tsx, the phone sheet): the current match with Remove, a search row filled
 * with the English title up to a colon, the source's hits with their cover; a hit is checked first (chapter count,
 * newest chapter, languages) and only used after the question.
 */
export function MangaManualMappingSheet({ entry, open, onOpenChange }: { entry: Manga_Entry, open: boolean, onOpenChange: (open: boolean) => void }) {
    const t = useTr()
    return <Sheet compact title={t("Manual match", "Manuell zuordnen")} description={t("Pick the matching title from the selected source.", "Wähle den passenden Titel der gewählten Quelle.")}
        open={open} onOpenChange={onOpenChange}>
        {open && <MappingContent entry={entry} />}
    </Sheet>
}

function MappingContent({ entry }: { entry: Manga_Entry }) {
    const t = useTr()
    const { selectedProvider } = useSelectedMangaProvider(entry.mediaId)
    const { getChapterPageUrl, isReady: imageProxyReady } = useMangaReaderUtils()
    const { data: existingMapping, isLoading: mappingLoading } = useGetMangaMapping({ provider: selectedProvider || undefined, mediaId: entry.mediaId })
    const { mutate: search, data: searchResults, isPending: searchLoading, isSuccess, isError, reset } = useMangaManualSearch(entry.mediaId, selectedProvider)
    // sources answer "no results" with an error, so both end in the same hint
    const searched = isSuccess || isError
    const { mutate: match, isPending: isMatching } = useMangaManualMapping()
    const { mutate: previewMapping, data: mappingPreview, isPending: previewLoading, reset: resetPreview } = usePreviewMangaMapping()
    const { mutate: unmatch, isPending: isUnmatching } = useRemoveMangaMapping()
    const [query, setQuery] = React.useState((entry.media?.title?.english || entry.media?.title?.romaji || entry.media?.title?.userPreferred || "").split(/[:：]/)[0].trim())
    const [selected, setSelected] = React.useState<HibikeManga_SearchResult | null>(null)
    const [confirming, setConfirming] = React.useState(false)
    const image = (item: HibikeManga_SearchResult) => item.image && imageProxyReady ? getChapterPageUrl(item.image, false, item.imageHeaders) : undefined

    const runSearch = () => {
        if (selectedProvider && query.trim()) search({ provider: selectedProvider, query: query.trim() })
    }
    const pick = (item: HibikeManga_SearchResult) => {
        if (!selectedProvider || previewLoading) return
        setSelected(item)
        previewMapping({ provider: selectedProvider, mangaId: item.id }, {
            onSuccess: preview => {
                if (!preview?.chapterCount) {
                    toast.error(t("No chapters were found for this result", "Für diesen Treffer wurden keine Kapitel gefunden"))
                    setSelected(null)
                    resetPreview()
                    return
                }
                setConfirming(true)
            },
            onError: () => setSelected(null),
        })
    }
    const cancel = () => {
        setConfirming(false)
        resetPreview()
        setSelected(null)
    }
    const confirm = () => {
        if (!selected || !selectedProvider) return
        match({ provider: selectedProvider, mediaId: entry.mediaId, mangaId: selected.id })
        reset()
        cancel()
    }

    return <View className="gap-4">
        <View accessibilityLiveRegion="polite" className="min-h-14 flex-row items-center gap-3 rounded-surface bg-sm-surface-raised px-4 py-2.5">
            {mappingLoading ? <ActivityIndicator color={colors.smTextMuted} /> : <>
                <View className="min-w-0 flex-1 gap-0.5">
                    <Muted>{existingMapping?.mangaId ? t("Matched to", "Zugeordnet zu") : t("Currently", "Aktuell")}</Muted>
                    <Text numberOfLines={1} className="text-[15px] font-semibold">{existingMapping?.mangaId || t("Automatic match", "Automatische Zuordnung")}</Text>
                </View>
                {!!existingMapping?.mangaId && <Button intent="text" disabled={isUnmatching || !selectedProvider}
                    onPress={() => selectedProvider && unmatch({ provider: selectedProvider, mediaId: entry.mediaId })}>{t("Remove", "Entfernen")}</Button>}
            </>}
        </View>

        <View className="flex-row items-center gap-2">
            <View className="min-w-0 flex-1"><SearchField value={query} onChangeText={setQuery} placeholder={t("Search title", "Titel suchen")} onSubmit={runSearch} /></View>
            <Button intent="secondary" disabled={!query.trim() || !selectedProvider || searchLoading || isMatching} onPress={runSearch}>{t("Search", "Suchen")}</Button>
        </View>

        {searchLoading ? <View className="py-6"><ActivityIndicator color={colors.smTextMuted} /></View>
            : searched && !searchResults?.length ? <Muted className="text-center">{t("No titles found. Try a shorter or English title.", "Keine Titel gefunden. Versuche einen kürzeren oder englischen Titel.")}</Muted>
                : !!searchResults?.length && <View accessibilityLabel={t("Search results", "Suchergebnisse")} className="gap-0.5 overflow-hidden rounded-surface">
                    {searchResults.map(item => {
                        const cover = image(item)
                        return <Pressable key={item.id} accessibilityRole="button" disabled={previewLoading} onPress={() => pick(item)}
                            className="min-h-[72px] flex-row items-center gap-3 bg-sm-surface-raised px-3 py-2 active:bg-sm-surface-control">
                            <View className="h-14 w-10 overflow-hidden rounded-[6px] bg-sm-surface-control">
                                {!!cover && <Image source={cover} contentFit="cover" style={{ position: "absolute", inset: 0 }} accessibilityIgnoresInvertColors />}
                            </View>
                            <View className="min-w-0 flex-1">
                                <Text numberOfLines={2} className="text-[15px]">{item.title}</Text>
                                {!!item.year && <Muted>{item.year}</Muted>}
                            </View>
                            {previewLoading && selected?.id === item.id ? <ActivityIndicator size="small" color={colors.smTextMuted} />
                                : <ChevronRight size={18} color={colors.smTextSubtle} />}
                        </Pressable>
                    })}
                </View>}

        <Dialog title={t("Use this title?", "Diesen Titel verwenden?")} open={confirming} onOpenChange={open => { if (!open) cancel() }}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={cancel}>{t("Cancel", "Abbrechen")}</Button>
                <Button wrapperClassName="flex-1" onPress={confirm}>{t("Use title", "Titel verwenden")}</Button>
            </>}>
            {selected && mappingPreview ? <View className="gap-1.5">
                <Text className="text-[15px]">{selected.title}</Text>
                <Muted>{t(`${mappingPreview.chapterCount} chapters · latest ${mappingPreview.latest || "unknown"}`, `${mappingPreview.chapterCount} Kapitel · neuestes ${mappingPreview.latest || "unbekannt"}`)}</Muted>
                {!!mappingPreview.languages?.length && <Muted>{mappingPreview.languages.join(", ")}</Muted>}
            </View> : <Muted>{t("Chapters of this manga will be loaded from the selected title.", "Die Kapitel dieses Manga werden vom gewählten Titel geladen.")}</Muted>}
        </Dialog>
    </View>
}
