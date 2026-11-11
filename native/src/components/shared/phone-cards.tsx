import type { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { CardMenu, type CardMenuAnchor, type CardMenuItem } from "@/components/shared/card-menu"
import { cn } from "@/components/ui/core/styling"
import { SectionTitle, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { getImageUrl } from "@/lib/server/assets"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useMediaPreviewModal } from "@/main/_features/media/_containers/media-preview-phone"
import { mediaEntryHref } from "@/main/_features/media/_lib/media-card"
import { getAnimeLibraryEntryAtom } from "@/main/_atoms/anime-library-collection.atoms"
import { usePlaylistMenuItem } from "@/main/_features/playlists/_components/playlist-menu-item"
import { usePluginCardMenuItems } from "@/main/_features/plugin/plugin-actions"
import { useAtomValue } from "jotai"
import { gridLayout, rowCoverWidth } from "@/components/shared/cover-layout"
import { useNetInfo } from "@react-native-community/netinfo"
import { Image } from "expo-image"
import Check from "lucide-react-native/icons/check"
import Eye from "lucide-react-native/icons/eye"
import Library from "lucide-react-native/icons/library"
import React from "react"
import { PixelRatio, Pressable, ScrollView, type ScrollViewInstance, useWindowDimensions, View } from "react-native"
import Animated from "react-native-reanimated"
import { useCoverFlightSource } from "@/components/shared/cover-flight"
import { useImageFade } from "@/components/ui/core/image-fade"
import { usePressScale } from "@/components/ui/core/press"
import { SCALE } from "@/lib/motion"

/*
 * The cover parts of the phone kit (phone-screen.css) that Discover and Search share:
 *   PhoneCoverCard  `.ps-card`: the 2:3 cover with the accent mark top right (`.ps-badge`), the plain one bottom left
 *                   (`.ps-tag`), the progress line on top; title (13dp, two lines) and one quiet line under it
 *   PhoneSection    `.ps-section`: Home's 20dp heading with a quiet count, one text action on the right, a note under it
 *   ChipRow         `.ps-chips`: pills in one row that scrolls sideways on its own; the chosen one stays in sight
 *   PhoneEmpty      `.ps-empty`: what is missing, why, and up to two ways on
 *   bones           `.ps-loading`: the final layout as flat blocks (feature, cover row, grid)
 */

type Media = AL_BaseAnime | AL_BaseManga

/**
 * Android's font size zooms the text, not the lengths (`--ps-text-zoom`): covers grow with it, so large text gets fewer,
 * wider cards instead of squeezed titles.
 */
export function useTextZoom() {
    return PixelRatio.getFontScale()
}

export function useRowCoverWidth() {
    const { width } = useWindowDimensions()
    const { rail } = useTabletLayout()
    return rowCoverWidth(width, rail, useTextZoom())
}

/** The grid of covers (`.ps-grid`): columns of at least 100dp (78dp × zoom) with 12dp between; tablet 8.75rem and 16dp. */
export function useGridColumns(contentWidth: number) {
    const { rail } = useTabletLayout()
    return gridLayout(contentWidth, rail, useTextZoom())
}

export const SEASON_LABELS: Record<string, [string, string]> = {
    WINTER: ["Winter", "Winter"], SPRING: ["Spring", "Frühling"], SUMMER: ["Summer", "Sommer"], FALL: ["Fall", "Herbst"],
}

export const MEDIA_STATUS_LABELS: Record<string, [string, string]> = {
    FINISHED: ["Finished", "Abgeschlossen"], RELEASING: ["Releasing", "Läuft"], NOT_YET_RELEASED: ["Upcoming", "Demnächst"],
    HIATUS: ["Hiatus", "Pausiert"], CANCELLED: ["Cancelled", "Abgebrochen"],
}

/** "Fall 2026", in the app language; empty when AniList knows neither. */
export function seasonYearLabel(t: Translate, media: { season?: string | null, seasonYear?: number | null, startDate?: { year?: number | null } | null }) {
    const season = media.season ? t(...(SEASON_LABELS[media.season] ?? [media.season, media.season])) : ""
    const year = media.seasonYear || media.startDate?.year || ""
    return [season, year].filter(Boolean).join(" ")
}

/** The last data a query had, so a refetch or a new key keeps the screen instead of showing bones again. */
export function useLastData<T>(data: T | undefined): T | undefined {
    const [last, setLast] = React.useState(data)
    if (data !== undefined && data !== last) setLast(data)
    return data ?? last
}

/** "No internet connection, so …" while the phone is offline, else the plain sentence (`offlineAware`). */
export function useOfflineAware() {
    const t = useTr()
    const offline = useNetInfo().isConnected === false
    return React.useCallback((plain: [string, string], whenOffline: [string, string]) => offline ? t(...whenOffline) : t(...plain), [offline, t])
}

export type CoverCardProps = {
    media: Media
    type: "anime" | "manga"
    width: number
    blurAdult: boolean
    progress?: { value: number, total: number }
    /** accent mark top right: new episodes, in the library, the user's score */
    badge?: string
    /** plain mark bottom left: progress, episode, airing / upcoming */
    tag?: string
    meta?: React.ReactNode
    metaTone?: "accent"
    /** the card's accessible name when the parts alone would be unclear */
    label?: string
    /** a mark in front of the line (Search: the library icon) */
    metaIcon?: React.ReactNode
    /** the library mark top left (My lists: titles with local files, the desktop card's library badge) */
    inLibrary?: boolean
    /** long-press items after Preview (My lists: Continue) */
    menuItems?: CardMenuItem[]
    /**
     * The title is on the user's AniList list (My lists: every card). "Add to playlist" then only needs a streaming source,
     * as 2.0.32's lists-phone.tsx (`canStream || library`); else the library entry decides.
     */
    onList?: boolean
}

/**
 * A tap opens the anime page (`/entry?id=`) or the manga page (`/manga/entry?id=`), a long press the card menu with
 * Preview, the caller's items and, for anime of the library, "Add to playlist" (2.14), as Home's cards.
 */
export const PhoneCoverCard = React.memo(function PhoneCoverCard({ media, type, width, blurAdult, progress, badge, tag, meta, metaTone, label, metaIcon, inLibrary, menuItems, onList }: CoverCardProps) {
    const t = useTr()
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    const [menuAt, setMenuAt] = React.useState<CardMenuAnchor | null>(null)
    const closeMenu = React.useCallback(() => setMenuAt(null), [])
    // "Add to playlist" on the library's terms (search-phone.tsx): the anime's library entry decides
    const libraryEntry = useAtomValue(getAnimeLibraryEntryAtom(media.id))
    const playlistItem = usePlaylistMenuItem(media.id, type, { local: !!libraryEntry?.libraryData || !!libraryEntry?.nakamaLibraryData, onList: onList ?? !!libraryEntry?.listData })
    const pluginItems = usePluginCardMenuItems(type, media)
    const title = media.title?.userPreferred || media.title?.romaji || media.title?.english || ""
    const veiled = blurAdult && !!media.isAdult
    const shownProgress = !!progress && progress.total > 0 && progress.value > 0
    const hasMeta = meta != null && meta !== ""
    // the cover gives way under the finger and flies into the page it opens (cover-flight.tsx); a blurred one does not fly
    const coverUri = getImageUrl(media.coverImage?.large || media.coverImage?.extraLarge || "")
    const { coverRef, onLoad: onCoverLoad, hidden: coverHidden, open: openEntry } = useCoverFlightSource(media.id, veiled ? "" : coverUri, getImageUrl(media.coverImage?.extraLarge || media.coverImage?.large || ""))
    const press = usePressScale(SCALE.pressCard)
    const fade = useImageFade()

    return (
        <Animated.View style={[{ width }, press.animatedStyle]}>
        <Pressable
            accessibilityRole="link"
            accessibilityLabel={label ?? [title, typeof meta === "string" ? meta : ""].filter(Boolean).join(", ")}
            accessibilityHint={t("Long press for more", "Lange drücken für mehr")}
            onPress={() => openEntry(mediaEntryHref(type, media.id))}
            onPressIn={press.pressIn}
            onPressOut={press.pressOut}
            onLongPress={event => setMenuAt({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })}
            delayLongPress={500}
            className="gap-1"
        >
            <CardMenu anchor={menuAt} title={title} onClose={closeMenu}
                items={[{ id: "preview", label: t("Preview", "Vorschau"), icon: Eye, onPress: () => setPreviewModalMediaId(media.id, type) },
                    ...(menuItems ?? []), ...(playlistItem ? [playlistItem] : []), ...pluginItems]} />
            <View ref={coverRef} collapsable={false} className="mb-1 aspect-[2/3] w-full overflow-hidden rounded-surface-sm bg-sm-surface-control">
                <Image
                    source={coverUri}
                    recyclingKey={String(media.id)}
                    contentFit="cover"
                    transition={fade}
                    onLoad={onCoverLoad}
                    blurRadius={veiled ? 24 : 0}
                    style={{ position: "absolute", inset: 0, opacity: coverHidden ? 0 : veiled ? 0.8 : 1 }}
                    accessibilityIgnoresInvertColors
                />
                {veiled && <View pointerEvents="none" className="absolute inset-0 bg-black/30" />}
                {shownProgress && (
                    <View className="absolute left-0 right-0 top-0 h-[3px] bg-black/55">
                        <View style={{ width: `${Math.min(100, (100 * progress!.value) / progress!.total)}%` }} className="h-full bg-sm-accent-strong" />
                    </View>
                )}
                {!!badge && <CardMark text={badge} className="right-1.5 top-1.5" textClassName="text-sm-accent" />}
                {!!tag && <CardMark text={tag} className="bottom-1.5 left-1.5" textClassName="text-sm-text" />}
                {inLibrary && (
                    <View className="absolute left-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full bg-[rgba(12,12,14,0.82)]">
                        <Library size={14} color={colors.smText} strokeWidth={2.5} />
                    </View>
                )}
            </View>
            <Text numberOfLines={2} className="text-[13px] font-medium leading-[18px]">{title}</Text>
            {hasMeta && (
                <View className="flex-row items-center">
                    {metaIcon}
                    <Text numberOfLines={1} className={cn("shrink text-xs", metaTone === "accent" ? "font-semibold text-sm-accent" : "text-sm-text-subtle")}
                        style={{ fontVariant: ["tabular-nums"] }}>{meta}</Text>
                </View>
            )}
        </Pressable>
        </Animated.View>
    )
})

/** `.ps-badge` / `.ps-tag`: a dark pill on the cover, so it reads on any picture. */
function CardMark({ text, className, textClassName }: { text: string, className: string, textClassName: string }) {
    return (
        <View style={{ maxWidth: "88%" }} className={cn("absolute rounded-full bg-[rgba(12,12,14,0.82)] px-[7px] py-[3px]", className)}>
            <Text numberOfLines={1} className={cn("text-[11px] font-semibold leading-[14px]", textClassName)} style={{ fontVariant: ["tabular-nums"] }}>{text}</Text>
        </View>
    )
}

/** `.ps-section`: heading with a quiet count, one text action on the right, a note under it. */
export function PhoneSection({ title, count, action, note, titleClassName, children, className }: {
    title: string
    count?: number | string
    action?: React.ReactNode
    note?: string
    titleClassName?: string
    children?: React.ReactNode
    className?: string
}) {
    return (
        <View className={cn("gap-3", className)}>
            {/* CSS centres the one wrapped line in the min-height (align-content: normal); Yoga would put it at the top */}
            <View className="min-h-9 flex-row flex-wrap items-center justify-between gap-x-3" style={{ alignContent: "center" }}>
                <SectionTitle className={cn("min-w-0 shrink", titleClassName)}>
                    {title}
                    {count != null && count !== "" && <Text className="text-sm font-medium text-sm-text-subtle" style={{ fontVariant: ["tabular-nums"] }}>{"  "}{count}</Text>}
                </SectionTitle>
                {!!action && <View className="-mr-2 ml-auto">{action}</View>}
            </View>
            {!!note && <Text className="-mt-1.5 text-[13px] leading-[19.5px] text-sm-text-muted">{note}</Text>}
            {children}
        </View>
    )
}

/** `.ps-chips`: one row of pills that scrolls sideways; the chosen chip scrolls into sight when it changes. */
export function ChipRow({ label, chips, selected, onSelect, multiple }: {
    label: string
    /** `count` shows quietly after the label (`.ps-tabs` with counts: My lists' status pills) */
    chips: { value: string, label: string, count?: number }[]
    selected: string[]
    onSelect: (value: string) => void
    /** several chosen (toggles with a check mark) instead of one (a radio group) */
    multiple?: boolean
}) {
    const scroll = React.useRef<ScrollViewInstance>(null)
    const places = React.useRef(new Map<string, { x: number, width: number }>())
    const [rowWidth, setRowWidth] = React.useState(0)
    const offset = React.useRef(0)
    const first = selected[0]
    // The chosen chip stays in sight, also when a type switch or a link changes it (the row keeps its place otherwise).
    React.useEffect(() => {
        const place = first ? places.current.get(first) : undefined
        if (!place || !rowWidth) return
        const left = place.x - 16, right = place.x + place.width + 16 - rowWidth
        if (left < offset.current) scroll.current?.scrollTo({ x: Math.max(0, left), animated: true })
        else if (right > offset.current) scroll.current?.scrollTo({ x: right, animated: true })
    }, [first, rowWidth])
    return (
        <ScrollView
            ref={scroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            onLayout={event => setRowWidth(event.nativeEvent.layout.width)}
            onScroll={event => { offset.current = event.nativeEvent.contentOffset.x }}
            scrollEventThrottle={64}
            accessibilityLabel={label}
            accessibilityRole={multiple ? undefined : "radiogroup"}
            className="-mx-4 grow-0"
            contentContainerClassName="gap-2 px-4"
        >
            {chips.map(chip => {
                const chosen = selected.includes(chip.value)
                return (
                    <Pressable
                        key={chip.value}
                        onLayout={event => places.current.set(chip.value, { x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width })}
                        accessibilityRole={multiple ? "togglebutton" : "radio"}
                        accessibilityState={multiple ? { checked: chosen } : { selected: chosen, checked: chosen }}
                        accessibilityLabel={chip.count === undefined ? chip.label : `${chip.label}, ${chip.count}`}
                        onPress={() => onSelect(chip.value)}
                        className={cn("min-h-12 flex-row items-center gap-1.5 rounded-full px-4",
                            chosen ? "bg-sm-accent-soft active:bg-sm-surface-control" : "bg-sm-surface-raised active:bg-sm-surface-control")}
                    >
                        {multiple && chosen && <Check size={16} color={colors.smAccent} strokeWidth={2.5} />}
                        <Text className={cn("text-sm", chosen ? "font-semibold text-sm-accent" : "font-medium text-sm-text-muted")}>{chip.label}</Text>
                        {chip.count !== undefined && <Text className={cn("text-sm", chosen ? "font-semibold text-sm-accent" : "text-sm-text-subtle")}
                            style={{ fontVariant: ["tabular-nums"] }}>{chip.count}</Text>}
                    </Pressable>
                )
            })}
        </ScrollView>
    )
}

/** `.ps-empty`: centred, on the raised surface; title, why, and the ways on as buttons under it. */
export function PhoneEmpty({ title, text, children }: { title: string, text?: string, children?: React.ReactNode }) {
    return (
        <View className="items-center gap-1.5 rounded-surface bg-sm-surface-raised px-4 py-6">
            <Text className="text-center text-[15px] font-semibold">{title}</Text>
            {!!text && <Text className="max-w-[352px] text-center text-[13px] leading-[19.5px] text-sm-text-muted">{text}</Text>}
            {!!children && <View className="mt-2 flex-row flex-wrap justify-center gap-2">{children}</View>}
        </View>
    )
}

/** `.ps-bone[data-kind="feature"]`: the spotlight while it loads. */
export function FeatureBones({ label }: { label: string }) {
    return <View accessibilityRole="progressbar" accessibilityLabel={label} className="h-[216px] rounded-surface bg-sm-surface-raised" />
}

/** A row of cover bones (`.ps-loading .ps-row`). */
export function CoverRowBones({ label }: { label: string }) {
    const width = useRowCoverWidth()
    return (
        <View accessibilityRole="progressbar" accessibilityLabel={label} className="-mx-4 flex-row gap-3 overflow-hidden px-4">
            {Array.from({ length: 4 }, (_, i) => <View key={i} style={{ width, aspectRatio: 2 / 3 }} className="rounded-surface-sm bg-sm-surface-raised" />)}
        </View>
    )
}

/** Six cover bones in the grid's columns (`.ps-loading .ps-grid`). */
export function GridBones({ label, contentWidth }: { label: string, contentWidth: number }) {
    const grid = useGridColumns(contentWidth)
    return (
        <View accessibilityRole="progressbar" accessibilityLabel={label} style={{ columnGap: grid.gap, rowGap: grid.rowGap }} className="flex-row flex-wrap">
            {Array.from({ length: 6 }, (_, i) => <View key={i} style={{ width: grid.width, aspectRatio: 2 / 3 }} className="rounded-surface-sm bg-sm-surface-raised" />)}
        </View>
    )
}
