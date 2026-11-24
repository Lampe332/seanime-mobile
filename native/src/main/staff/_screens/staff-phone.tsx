import { useGetAnilistStaffDetails } from "@/api/hooks/anilist.hooks"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { HEAD_ACTIONS_STYLE } from "@/components/shared/page-head"
import { GridBones, PhoneEmpty, useGridColumns } from "@/components/shared/phone-cards"
import { Notice, TextAction } from "@/components/shared/phone-kit"
import { PHONE_PAGE_TINT, PhoneHeadTray, usePageBottomPad, usePageTop } from "@/components/shared/phone-screen"
import { cn } from "@/components/ui/core/styling"
import { Heading, Muted, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { getImageUrl } from "@/lib/server/assets"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { ResultCell } from "@/main/search/_screens/search-phone"
import { type StaffWork, staffWorks } from "@/main/staff/_lib/staff-works"
import { FlashList, type FlashListRef } from "@shopify/flash-list"
import { Image } from "expo-image"
import UserRound from "lucide-react-native/icons/user-round"
import * as React from "react"
import { Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

type Kind = "anime" | "manga"

/**
 * A person's works ("/staff?id=…&name=…&kind=…", from a name on an anime or manga page): AniList's titles with the
 * person's roles under each, most popular first, anime and manga apart. Starts on the kind of the page it came from.
 */
export function StaffPhone({ id, name, kind }: { id: number, name?: string, kind?: Kind }) {
    const t = useTr()
    const insets = useSafeAreaInsets()
    const top = usePageTop()
    const barHeight = useNavBarHeight()
    const { rail } = useTabletLayout()
    const pageBottom = usePageBottomPad((rail ? 32 : barHeight + 32) + insets.bottom)
    const valid = Number.isFinite(id) && id > 0
    const { data, isLoading, isError, refetch, isRefetching } = useGetAnilistStaffDetails(id)
    const adultAllowed = !!useServerStatus()?.settings?.anilist?.enableAdultContent

    const gutter = 16
    const [contentWidth, setContentWidth] = React.useState(0)
    const grid = useGridColumns(contentWidth)
    const person = data?.Staff
    const works = React.useMemo(() => staffWorks(person?.staffMedia?.edges, adultAllowed), [person, adultAllowed])
    // the choice belongs to one person: another person starts on the link's kind again
    const [choice, setChoice] = React.useState<{ id: number, kind: Kind } | undefined>(undefined)
    const setPicked = (option: Kind) => setChoice({ id, kind: option })
    const preferred = (choice?.id === id ? choice.kind : undefined) ?? kind ?? "anime"
    const shown: Kind = works[preferred].length || !works[preferred === "anime" ? "manga" : "anime"].length ? preferred : preferred === "anime" ? "manga" : "anime"
    const items = works[shown]
    const both = works.anime.length > 0 && works.manga.length > 0
    const title = person?.name?.full || name || t("Person", "Person")
    const native = person?.name?.native
    const occupations = (person?.primaryOccupations ?? []).filter(Boolean).join(", ")
    const image = person?.image?.large

    // the tabs keep this screen mounted: another person starts at the top
    const list = React.useRef<FlashListRef<StaffWork>>(null)
    React.useEffect(() => {
        list.current?.scrollToOffset({ offset: 0, animated: false })
    }, [id, shown])

    const renderItem = React.useCallback(({ item }: { item: StaffWork }) => (
        <View style={{ paddingHorizontal: grid.gap / 2, paddingBottom: grid.rowGap }}>
            <ResultCell media={item.media} type={shown} width={grid.width} />
            {item.roles.length > 0 && <Muted className="mt-1 text-[12px] leading-4" numberOfLines={2}>{item.roles.join(", ")}</Muted>}
        </View>
    ), [grid.gap, grid.rowGap, grid.width, shown])

    const loading = valid && isLoading && !data
    const failed = !valid || (isError && !data)
    const subtitle = items.length
        ? shown === "anime" ? t(`${items.length} anime · most popular first`, `${items.length} Anime · beliebteste zuerst`) : t(`${items.length} manga · most popular first`, `${items.length} Manga · beliebteste zuerst`)
        : undefined
    const header = <View className="gap-4 pb-4" style={{ paddingHorizontal: grid.gap / 2 }}>
        <View className="flex-row items-start gap-3 pt-1">
            <View className="h-24 w-[72px] items-center justify-center overflow-hidden rounded-xl bg-sm-surface-raised">
                {image
                    ? <Image source={{ uri: getImageUrl(image) }} style={{ width: 72, height: 96 }} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
                    : <UserRound size={28} color={colors.smTextSubtle} />}
            </View>
            <View className="min-w-0 flex-1 gap-1">
                <View className="flex-row items-start justify-between gap-x-2">
                    <Heading className="min-w-0 flex-1" accessibilityRole="header">{title}</Heading>
                    <View style={HEAD_ACTIONS_STYLE}><PhoneHeadTray /></View>
                </View>
                {!!native && native !== title && <Muted>{native}</Muted>}
                {!!occupations && <Muted numberOfLines={2}>{occupations}</Muted>}
            </View>
        </View>
        {both && <View className="flex-row gap-2" accessibilityRole="tablist">
            {(["anime", "manga"] as const).map(option => <Pressable key={option} accessibilityRole="tab" accessibilityState={{ selected: shown === option }}
                onPress={() => setPicked(option)}
                className={cn("min-h-9 justify-center rounded-full px-4 active:opacity-70", shown === option ? "bg-sm-accent-softer" : "bg-sm-surface-raised")}>
                <Text className={cn("text-[13px] font-semibold", shown === option ? "text-sm-text" : "text-sm-text-muted")}>
                    {option === "anime" ? t(`Anime (${works.anime.length})`, `Anime (${works.anime.length})`) : t(`Manga (${works.manga.length})`, `Manga (${works.manga.length})`)}
                </Text>
            </Pressable>)}
        </View>}
        {!!subtitle && <Muted>{subtitle}</Muted>}
        {loading && <GridBones label={t("Loading this person's works", "Werke dieser Person laden")} contentWidth={contentWidth} />}
        {failed && <Notice text={valid ? t("This person's works could not be loaded.", "Die Werke dieser Person konnten nicht geladen werden.") : t("This person link is not valid.", "Dieser Personen-Link ist ungültig.")}>
            {valid && <TextAction label={isRefetching ? t("Trying again…", "Erneuter Versuch…") : t("Try again", "Erneut versuchen")} onPress={() => void refetch()} />}
        </Notice>}
        {!loading && !failed && !items.length && <PhoneEmpty title={t("No works listed", "Keine Werke eingetragen")}
            text={t("AniList lists no anime or manga for this person yet.", "AniList führt noch keine Anime oder Manga für diese Person.")} />}
    </View>

    return (
        <View className="flex-1">
            {!rail && <View pointerEvents="none" className="absolute inset-x-0 top-0 h-[568px]" style={{ backgroundImage: PHONE_PAGE_TINT }} />}
            <View className={cn("w-full flex-1", !rail && "max-w-[1152px] self-center")} style={{ paddingHorizontal: gutter }}
                onLayout={event => setContentWidth(event.nativeEvent.layout.width - gutter * 2)}>
                <FlashList
                    ref={list}
                    data={loading || failed ? [] : items}
                    keyExtractor={work => String(work.media.id)}
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
