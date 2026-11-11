import type { AL_BaseAnime, AL_BaseManga, Anime_EntryLibraryData, Anime_EntryListData, Anime_NakamaEntryLibraryData, Manga_EntryListData } from "@/api/generated/types"
import { Text } from "@/components/ui/text/text"
import { getImageUrl } from "@/lib/server/assets"
import { colors } from "@/lib/theme/tokens"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { __mangaLibrary_latestChapterNumbersAtom } from "@/main/manga/_lib/handle-manga-collection"
import { getMangaEntryUnreadState } from "@/main/manga/_lib/manga-unread"
import { Image } from "expo-image"
import { useAtomValue } from "jotai"
import BookOpen from "lucide-react-native/icons/book-open"
import CirclePlay from "lucide-react-native/icons/circle-play"
import Eye from "lucide-react-native/icons/eye"
import FolderOpen from "lucide-react-native/icons/folder-open"
import Library from "lucide-react-native/icons/library"
import Star from "lucide-react-native/icons/star"
import { SignalTowerIcon } from "@/components/shared/legacy-icons"
import React from "react"
import { Pressable, View } from "react-native"
import Animated from "react-native-reanimated"
import { CardMenu, type CardMenuAnchor } from "@/components/shared/card-menu"
import { useCoverFlightSource } from "@/components/shared/cover-flight"
import { useImageFade } from "@/components/ui/core/image-fade"
import { usePressScale } from "@/components/ui/core/press"
import { SCALE } from "@/lib/motion"
import { useTr } from "@/lib/app-language"
import { useMediaPreviewModal } from "@/main/_features/media/_containers/media-preview-phone"
import { useLibraryExplorer } from "@/main/_features/library-explorer/library-explorer.atoms"
import { usePlaylistMenuItem } from "@/main/_features/playlists/_components/playlist-menu-item"
import { usePluginCardMenuItems } from "@/main/_features/plugin/plugin-actions"
import { cardProgressBar, cardProgressLabel, cardProgressTotal, cardSeasonLine, cardUnwatchedCount, mediaEntryHref, userScoreColor } from "../_lib/media-card"

/*
 * A cover card as on Android Home (media-entry-card.tsx + home-mobile.css): the 3:4 cover with 12dp corners, a faint
 * bottom gradient, the progress line on top, the progress as the dark pill of the other screens' cards (.ps-tag; the
 * desktop corner was too faint on bright covers), the user's score bottom right, the releasing mark top right, under it
 * the title (13dp, two lines) and the season line (12dp).
 *
 * A tap opens the anime page (`/entry?id=`) or the manga page (`/manga/entry?id=`), a long press the card menu with Preview,
 * for a title with local files "Open in library explorer" and "Add to playlist" (CardMenu, 2.14). Not yet here: the
 * plugins' badges (Dub, 2.17).
 */
export const MediaEntryCard = React.memo(function MediaEntryCard({ media, type, width, listData, libraryData, nakamaLibraryData, showLibraryBadge, hideReleasingBadge, withScore = true, overlay, seasonTop }: {
    media: AL_BaseAnime | AL_BaseManga
    type: "anime" | "manga"
    width: number
    listData?: Anime_EntryListData | Manga_EntryListData
    libraryData?: Anime_EntryLibraryData
    nakamaLibraryData?: Anime_NakamaEntryLibraryData
    showLibraryBadge?: boolean
    hideReleasingBadge?: boolean
    withScore?: boolean
    /** drawn over the cover's right edge (Aired recently: the episode and when it aired) */
    overlay?: React.ReactNode
    /**
     * Extra room over the year line. On the anime page 2.0.32's year is an `inline-flex` <p> in a block <div>, so it sits on
     * the div's 24px line box (S22: 5dp lower than a plain 16dp line).
     */
    seasonTop?: number
}) {
    const serverStatus = useServerStatus()
    const ts = useThemeSettings()
    const total = cardProgressTotal(type, media)
    const bar = cardProgressBar(type, media, listData)
    const label = cardProgressLabel(type, listData?.progress, total)
    const watching = listData?.status === "CURRENT" || listData?.status === "REPEATING"
    const unwatched = type === "anime" && watching && ts.showAnimeUnwatchedCount
        ? cardUnwatchedCount(media as AL_BaseAnime, listData?.progress, libraryData, nakamaLibraryData) : 0
    const veiled = !!serverStatus?.settings?.anilist?.blurAdultContent && !!media.isAdult
    const title = media.title?.userPreferred || ""
    const season = cardSeasonLine(media)
    const releasing = (media.status === "RELEASING" || media.status === "NOT_YET_RELEASED") && !hideReleasingBadge
    const score = withScore ? listData?.score : undefined
    const t = useTr()
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    const { openDirInLibraryExplorer } = useLibraryExplorer()
    const [menuAt, setMenuAt] = React.useState<CardMenuAnchor | null>(null)
    const closeMenu = React.useCallback(() => setMenuAt(null), [])
    const playlistItem = usePlaylistMenuItem(media.id, type, { local: !!libraryData || !!nakamaLibraryData, onList: !!listData })
    const pluginItems = usePluginCardMenuItems(type, media)
    // the cover gives way under the finger and flies into the page it opens (cover-flight.tsx); a blurred one does not fly
    const coverUri = getImageUrl(media.coverImage?.extraLarge || media.coverImage?.large || "")
    const { coverRef, onLoad: onCoverLoad, hidden: coverHidden, open: openEntry } = useCoverFlightSource(media.id, veiled ? "" : coverUri)
    const press = usePressScale(SCALE.pressCard)
    const fade = useImageFade()

    return (
        <Animated.View style={[{ width }, press.animatedStyle]}>
        <Pressable accessibilityRole="link"
            accessibilityLabel={[title, season, label ? `${label}` : ""].filter(Boolean).join(", ")}
            accessibilityHint={t("Long press for more", "Lange drücken für mehr")}
            onPress={() => openEntry(mediaEntryHref(type, media.id))}
            onPressIn={press.pressIn}
            onPressOut={press.pressOut}
            onLongPress={event => setMenuAt({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })}
            delayLongPress={500}>
            <CardMenu anchor={menuAt} title={title} onClose={closeMenu}
                items={[{ id: "preview", label: t("Preview", "Vorschau"), icon: Eye, onPress: () => setPreviewModalMediaId(media.id, type) },
                    // "Open in library explorer" for a title with local files, at its folder (MediaEntryCard handleOpenInExplorerClick)
                    ...(libraryData?.sharedPath ? [{ id: "explorer", label: t("Open in library explorer", "Im Bibliotheks-Explorer öffnen"), icon: FolderOpen,
                        onPress: () => openDirInLibraryExplorer(libraryData.sharedPath) }] : []),
                    ...(playlistItem ? [playlistItem] : []), ...pluginItems]} />
            <View ref={coverRef} collapsable={false} className="aspect-[3/4] w-full overflow-hidden rounded-surface-sm bg-sm-surface-raised">
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
                {/* MediaCardBodyBottomGradient: the lower 40% fades to #0c0c0c at .8 */}
                <View pointerEvents="none" className="absolute inset-x-0 -bottom-1 h-[40%]"
                    style={{ opacity: 0.8, backgroundImage:"linear-gradient(0deg, #0c0c0c, rgba(12,12,12,0))" }} />
                {veiled && <View pointerEvents="none" className="absolute inset-0 bg-black/30" />}
                {!!bar && (
                    <View className="absolute left-0 top-0 h-1 w-full bg-[#374151]">
                        <View style={{ width: `${bar.percent}%`, backgroundColor: bar.current ? colors.brand400 : "#9ca3af" }} className="h-full" />
                    </View>
                )}
                {showLibraryBadge && !!libraryData && (
                    <View className="absolute left-0 top-0 rounded-br-ui bg-[rgba(217,119,6,0.8)] px-2 py-1.5">
                        <Library size={16} color="#451a03" />
                    </View>
                )}
                {releasing && (
                    <View className={`absolute right-1 top-2 h-7 items-center justify-center rounded-full px-2.5 ${media.status === "RELEASING" ? "bg-brand-500" : "bg-[#3f3f46]"}`}>
                        <SignalTowerIcon size={16} color="#ffffff" />
                    </View>
                )}
                {overlay}
                {(!!label || unwatched > 0 || type === "manga") && (
                    <CardPill type={type} mediaId={media.id} label={label} unwatched={unwatched} progress={listData?.progress} />
                )}
                {!!score && (
                    <View style={{ backgroundColor: userScoreColor(score) }} className="absolute bottom-0 right-0 h-7 w-14 flex-row items-center justify-center gap-1 rounded-tl-ui">
                        <Star size={13} color="#ffffff" fill={score >= 90 ? "#ffffff" : "transparent"} />
                        <Text className="text-sm font-bold text-white">{score / 10}</Text>
                    </View>
                )}
            </View>
            <View className="gap-1 pt-2">
                <Text numberOfLines={2} className="text-[13px] font-medium leading-[18px]">{title}</Text>
                {!!season && <Text numberOfLines={1} className="text-xs text-sm-text-subtle" style={seasonTop ? { paddingTop: seasonTop } : undefined}>{season}</Text>}
            </View>
        </Pressable>
        </Animated.View>
    )
})

/** The dark pill bottom left: the unwatched / unread count over the progress, as in MediaEntryProgressBadge. */
function CardPill({ type, mediaId, label, unwatched, progress }: { type: "anime" | "manga", mediaId: number, label: string | null, unwatched: number, progress?: number }) {
    const ts = useThemeSettings()
    const mangaData = useAtomValue(__mangaLibrary_latestChapterNumbersAtom)
    const unread = type === "manga" && ts.showMangaUnreadCount
        ? getMangaEntryUnreadState(mediaId, progress || 0, mangaData.latestChapterNumbers, mangaData.storedProviders, mangaData.storedFilters)
        : null
    const top = unwatched > 0
        ? <View className="flex-row items-center gap-1"><CirclePlay size={14} color={colors.smText} /><Text className="text-[11px] font-normal">{unwatched}</Text></View>
        : unread?.known && unread.unread > 0
            ? <View className="flex-row items-center gap-1"><BookOpen size={12} color={colors.smText} /><Text className="text-[11px] font-normal">{unread.unread}</Text></View>
            : null
    if (!top && !label) return null
    return (
        <View className="absolute bottom-1.5 left-1.5 items-start rounded-full bg-[rgba(12,12,14,0.82)] px-[7px] py-[3px]">
            {top}
            {!!label && <PillLabel label={label} />}
        </View>
    )
}

function PillLabel({ label }: { label: string }) {
    const [done, rest] = label.split("/")
    return (
        <Text className="text-[11px] font-semibold leading-[14px]" style={{ fontVariant: ["tabular-nums"] }}>
            {done}{rest !== undefined && <Text className="text-[11px] font-semibold leading-[14px] text-sm-text-muted">/{rest}</Text>}
        </Text>
    )
}
