import type { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { useCustomSourceListAnime, useCustomSourceListManga } from "@/api/hooks/custom_source.hooks"
import { useListCustomSourceExtensions } from "@/api/hooks/extensions.hooks"
import { GridBones, PhoneCoverCard, PhoneEmpty, useGridColumns } from "@/components/shared/phone-cards"
import { FORMAT_LABELS, LoadingRows, Notice, SearchField, TextAction } from "@/components/shared/phone-kit"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { Button } from "@/components/ui/button/button"
import { Select } from "@/components/ui/select/select"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useAtom } from "jotai"
import ChevronLeft from "lucide-react-native/icons/chevron-left"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import React from "react"
import { View } from "react-native"
import { customSourceType, pickCustomSource } from "../_lib/custom-sources"
import { __customSources_paramsAtom, __customSources_providerAtom, type CustomSourcesParams } from "../custom-sources.atoms"

/*
 * Custom sources (web custom-sources-phone.tsx + .css `.pcs-*`): a source's anime or manga as the phone tabs' cover grid,
 * a title search, the source and the type as the screen's only controls, and pages as Previous / Next under the grid.
 * `?provider=` (an extension's "Browse this source") picks the source.
 */
export function CustomSourcesPhone({ providerParam }: { providerParam?: string }) {
    const t = useTr()
    const router = useRouter()
    const serverStatus = useServerStatus()
    const { data: sources, isLoading: sourcesLoading } = useListCustomSourceExtensions()
    const [params, setParams] = useAtom(__customSources_paramsAtom)
    const [stored, setStored] = useAtom(__customSources_providerAtom)
    const [search, setSearch] = React.useState(params.search)
    const [searchFor, setSearchFor] = React.useState(params.search)
    if (searchFor !== params.search) {
        // a new query (page or source change resets it) shows in the field
        setSearchFor(params.search)
        setSearch(params.search)
    }
    const provider = sources?.length ? pickCustomSource(sources, providerParam, stored) : stored
    const source = sources?.find(s => s.id === provider)
    const anime = !!source?.settings?.supportsAnime
    const manga = !!source?.settings?.supportsManga
    const type = customSourceType(params.type, anime, manga)
    const query = { provider: provider || "", search: params.search, page: params.page, perPage: 30 }
    const animeQuery = useCustomSourceListAnime(query, { enabled: !!source && type === "anime" && anime })
    const mangaQuery = useCustomSourceListManga(query, { enabled: !!source && type === "manga" && manga })
    const { data, isLoading, isError, refetch } = type === "anime" ? animeQuery : mangaQuery

    // The source in use is remembered for the next visit
    React.useEffect(() => {
        if (provider && provider !== stored) setStored(provider)
    }, [provider, stored, setStored])

    const update = (change: Partial<CustomSourcesParams>) => setParams(draft => {
        Object.assign(draft, { page: 1, ...change })
    })
    const media = (data?.media ?? []) as (AL_BaseAnime | AL_BaseManga)[]
    const pages = Math.max(1, data?.totalPages ?? 1)
    const blurAdult = !!serverStatus?.settings?.anilist?.blurAdultContent
    const [contentWidth, setContentWidth] = React.useState(0)
    const grid = useGridColumns(contentWidth)
    const facts = source ? [source.name, data ? t(`${media.length} on this page`, `${media.length} auf dieser Seite`) : "",
        pages > 1 ? t(`page ${params.page} of ${pages}`, `Seite ${params.page} von ${pages}`) : ""].filter(Boolean).join(" · ") : undefined

    return (
        <PhoneScreen title={t("Custom sources", "Eigene Quellen")} subtitle={facts}>
            {sourcesLoading ? <LoadingRows label={t("Loading sources", "Quellen werden geladen")} count={3} />
                : !sources?.length ? (
                    <PhoneEmpty title={t("No custom sources", "Keine eigenen Quellen")}
                        text={t("Custom sources are extensions that bring anime or manga from outside AniList. Add one under Extensions.",
                            "Eigene Quellen sind Erweiterungen, die Anime oder Manga von außerhalb AniList bringen. Füge eine unter Erweiterungen hinzu.")}>
                        <Button onPress={() => router.push("/extensions?tab=marketplace&type=custom-source")}>{t("Open extensions", "Erweiterungen öffnen")}</Button>
                    </PhoneEmpty>
                ) : <>
                    <View className="gap-2">
                        {sources.length > 1 && <Select value={provider ?? ""} placeholder={t("Source", "Quelle")} accessibilityLabel={t("Source", "Quelle")}
                            options={sources.map(s => ({ value: s.id, label: s.name }))} onValueChange={value => {
                                setStored(value)
                                router.replace(`/custom-sources?provider=${encodeURIComponent(value)}`)
                                update({})
                            }} />}
                        {anime && manga && <Tabs value={type} onValueChange={value => update({ type: value as "anime" | "manga" })}
                            items={[{ value: "anime", label: t("Anime", "Anime") }, { value: "manga", label: t("Manga", "Manga") }]} />}
                        <SearchField value={search} onChangeText={setSearch} placeholder={t("Search titles", "Titel suchen")} onSubmit={() => update({ search })} />
                    </View>
                    <View onLayout={event => setContentWidth(event.nativeEvent.layout.width)}>
                        {isLoading ? (contentWidth ? <GridBones label={t("Loading titles", "Titel werden geladen")} contentWidth={contentWidth} /> : null)
                            : isError ? (
                                <Notice text={t(`${source?.name ?? "The source"} did not answer.`, `${source?.name ?? "Die Quelle"} hat nicht geantwortet.`)}>
                                    <TextAction label={t("Try again", "Nochmal versuchen")} onPress={() => void refetch()} />
                                </Notice>
                            ) : !media.length ? (
                                <PhoneEmpty title={params.search ? t("Nothing found", "Nichts gefunden") : t("Nothing here yet", "Hier ist noch nichts")}
                                    text={params.search ? t("Try another title.", "Versuch einen anderen Titel.") : undefined} />
                            ) : <View className="gap-6">
                                <View style={{ columnGap: grid.gap, rowGap: grid.rowGap }} className="flex-row flex-wrap">
                                    {!!contentWidth && media.map((item, index) => (
                                        <PhoneCoverCard key={`${item.id}-${index}`} media={item} type={type} width={grid.width} blurAdult={blurAdult}
                                            meta={[item.format ? t(...(FORMAT_LABELS[item.format] ?? [item.format, item.format])) : "", item.startDate?.year].filter(Boolean).join(" · ")} />
                                    ))}
                                </View>
                                {pages > 1 && (
                                    <View accessibilityLabel={t("Pages", "Seiten")} className="flex-row items-center justify-between gap-3">
                                        <Button intent="secondary" disabled={params.page <= 1} onPress={() => update({ page: params.page - 1 })}
                                            leftIcon={<ChevronLeft size={18} color={colors.smText} />}>{t("Previous", "Zurück")}</Button>
                                        <Text className="text-sm text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>{params.page} / {pages}</Text>
                                        <Button intent="secondary" disabled={params.page >= pages} onPress={() => update({ page: params.page + 1 })}
                                            rightIcon={<ChevronRight size={18} color={colors.smText} />}>{t("Next", "Weiter")}</Button>
                                    </View>
                                )}
                            </View>}
                    </View>
                </>}
        </PhoneScreen>
    )
}
