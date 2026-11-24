import type { AL_BaseAnime } from "@/api/generated/types"
import { useGetAnilistStudioDetails } from "@/api/hooks/anilist.hooks"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { HEAD_ACTIONS_STYLE } from "@/components/shared/page-head"
import { GridBones, PhoneEmpty, useGridColumns } from "@/components/shared/phone-cards"
import { Notice, TextAction } from "@/components/shared/phone-kit"
import { PHONE_PAGE_TINT, PhoneHeadTray, usePageBottomPad, usePageTop } from "@/components/shared/phone-screen"
import { cn } from "@/components/ui/core/styling"
import { Heading, Muted } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { ResultCell } from "@/main/search/_screens/search-phone"
import { FlashList, type FlashListRef } from "@shopify/flash-list"
import * as React from "react"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/**
 * A studio's anime ("/studio?id=…&name=…", from the studio on an anime page): AniList's main productions,
 * newest first, in the search's grid and cards. The name from the link shows before the data comes.
 */
export function StudioPhone({ id, name }: { id: number, name?: string }) {
    const t = useTr()
    const insets = useSafeAreaInsets()
    const top = usePageTop()
    const barHeight = useNavBarHeight()
    const { rail } = useTabletLayout()
    const pageBottom = usePageBottomPad((rail ? 32 : barHeight + 32) + insets.bottom)
    const valid = Number.isFinite(id) && id > 0
    const { data, isLoading, isError, refetch, isRefetching } = useGetAnilistStudioDetails(id)

    const gutter = 16
    const [contentWidth, setContentWidth] = React.useState(0)
    const grid = useGridColumns(contentWidth)
    const items = React.useMemo(() => (data?.Studio?.media?.nodes ?? []).filter((m): m is AL_BaseAnime => !!m?.id), [data])
    const title = data?.Studio?.name || name || t("Studio", "Studio")

    // the tabs keep this screen mounted: another studio starts at the top
    const list = React.useRef<FlashListRef<AL_BaseAnime>>(null)
    React.useEffect(() => {
        list.current?.scrollToOffset({ offset: 0, animated: false })
    }, [id])

    const renderItem = React.useCallback(({ item }: { item: AL_BaseAnime }) => (
        <View style={{ paddingHorizontal: grid.gap / 2, paddingBottom: grid.rowGap }}>
            <ResultCell media={item} type="anime" width={grid.width} />
        </View>
    ), [grid.gap, grid.rowGap, grid.width])

    const loading = valid && isLoading && !data
    const failed = !valid || (isError && !data)
    const subtitle = items.length ? t(`${items.length} anime · newest first`, `${items.length} Anime · neueste zuerst`) : undefined
    const header = <View className="gap-4 pb-4" style={{ paddingHorizontal: grid.gap / 2 }}>
        <View className="flex-row flex-wrap items-center justify-between gap-x-2 pt-1">
            <Heading className="min-w-0 flex-1" accessibilityRole="header">{title}</Heading>
            <View style={HEAD_ACTIONS_STYLE}><PhoneHeadTray /></View>
            {!!subtitle && <Muted className="mt-[3px] w-full">{subtitle}</Muted>}
        </View>
        {loading && <GridBones label={t("Loading the studio's anime", "Anime des Studios laden")} contentWidth={contentWidth} />}
        {failed && <Notice text={valid ? t("The studio's anime could not be loaded.", "Die Anime des Studios konnten nicht geladen werden.") : t("This studio link is not valid.", "Dieser Studio-Link ist ungültig.")}>
            {valid && <TextAction label={isRefetching ? t("Trying again…", "Erneuter Versuch…") : t("Try again", "Erneut versuchen")} onPress={() => void refetch()} />}
        </Notice>}
        {!loading && !failed && !items.length && <PhoneEmpty title={t("No anime from this studio", "Keine Anime von diesem Studio")}
            text={t("AniList lists no main productions for it yet.", "AniList führt noch keine Hauptproduktionen dafür.")} />}
    </View>

    return (
        <View className="flex-1">
            {!rail && <View pointerEvents="none" className="absolute inset-x-0 top-0 h-[568px]" style={{ backgroundImage: PHONE_PAGE_TINT }} />}
            <View className={cn("w-full flex-1", !rail && "max-w-[1152px] self-center")} style={{ paddingHorizontal: gutter }}
                onLayout={event => setContentWidth(event.nativeEvent.layout.width - gutter * 2)}>
                <FlashList
                    ref={list}
                    data={loading || failed ? [] : items}
                    keyExtractor={media => String(media.id)}
                    numColumns={Math.max(1, grid.columns)}
                    renderItem={renderItem}
                    ListHeaderComponent={header}
                    showsVerticalScrollIndicator={false}
                    style={{ marginHorizontal: -grid.gap / 2 }}
                    contentContainerStyle={{ paddingTop: top, paddingBottom: pageBottom }}
                />
            </View>
        </View>
    )
}
