import type { AL_BaseAnime, Anime_Entry, Anime_EntryDownloadInfo, Anime_Episode, Anime_LocalFileType } from "@/api/generated/types"
import { getServerBaseUrl } from "@/api/client/server-url"
import { useUpdateAnimeEntryProgress } from "@/api/hooks/anime_entries.hooks"
import { getEpisodeMinutesRemaining, getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { useUpdateLocalFileData } from "@/api/hooks/localfiles.hooks"
import { CardMenu, type CardMenuAnchor } from "@/components/shared/card-menu"
import { PickRow, RowGroup } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Dialog, Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { Muted, SectionTitle, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { utf8ToBase64 } from "@/lib/helpers/base64"
import { copyToClipboard, openInAppBrowser } from "@/lib/helpers/browser"
import { getImageUrl } from "@/lib/server/assets"
import { useEpisodeSpoilerState } from "@/lib/theme/anime-spoilers"
import { colors } from "@/lib/theme/tokens"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useExternalPlayerLink } from "@/main/_atoms/playback.atoms"
import { IN_APP_PLAYER_READY } from "@/main/_features/player/player-availability"
import { useHasTorrentProvider, useServerHMACAuth, useServerStatus } from "@/main/_hooks/use-server-status"
import { useHandleEpisodeSection } from "@/main/entry/_lib/handle-episode-section"
import { useHandlePlayMedia } from "@/main/entry/_lib/handle-play-media"
import { PhoneDownloadedEpisodes } from "./phone-downloaded-episodes"
import { useOfflineEpisodes } from "@/main/android-downloads/_lib/use-offline"
import { __torrentSearch_selectionAtom, __torrentSearch_selectionEpisodeAtom } from "@/main/entry/_containers/torrent-search/torrent-search.atoms"
import { useSetAtom } from "jotai"
import { FlashList } from "@shopify/flash-list"
import { Image } from "expo-image"
import { forEpisodeType, usePluginActions, useRunPluginAction } from "@/main/_features/plugin/plugin-actions"
import BadgeCheck from "lucide-react-native/icons/badge-check"
import CalendarDays from "lucide-react-native/icons/calendar-days"
import CircleAlert from "lucide-react-native/icons/circle-exclamation-point"
import CircleCheck from "lucide-react-native/icons/circle-check"
import Download from "lucide-react-native/icons/download"
import Ellipsis from "lucide-react-native/icons/ellipsis"
import FileVideo from "lucide-react-native/icons/file-play"
import Info from "lucide-react-native/icons/info"
import LibraryBig from "lucide-react-native/icons/library-big"
import LockOpen from "lucide-react-native/icons/lock-open"
import PencilLine from "lucide-react-native/icons/pencil-line"
import Puzzle from "lucide-react-native/icons/puzzle"
import Unlink from "lucide-react-native/icons/unlink"
import { successFeedback } from "@/lib/feedback"
import React from "react"
import { Pressable, TextInput, useWindowDimensions, View } from "react-native"

/*
 * The local library tab of an anime page (episode-section.tsx, episode-item.tsx, episode-grid-item.tsx,
 * undownloaded-episode-list.tsx, mobile-anime.css): the "up next" cards, the episodes as hairline rows (96×56 picture,
 * "Episode 8" over the episode title, the row's state in the accent), the episodes not in the library, specials, others.
 *
 * Playing: every row and card is one play target, disabled until the player exists (E3, IN_APP_PLAYER_READY).
 * "On this device" (phone-downloaded-episodes.tsx) sits on top: the episodes the Go server saved on the phone (E4, 2.9).
 * A library episode's menu ends with the plugins' items (2.17). The download arrow of an episode
 * not in the library opens the torrent sheet for it (torrent-search-phone.tsx).
 */

const PAGE = 24
const libraryEpisodeItems = forEpisodeType("library")
const PAGINATE_FROM = 29

export function EpisodeSection({ entry, bottomSection }: { entry: Anime_Entry, bottomSection?: React.ReactNode }) {
    const t = useTr()
    const { media, hasInvalidEpisodes, episodesToWatch, mainEpisodes, specialEpisodes, ncEpisodes } = useHandleEpisodeSection({ entry })
    const { playMediaFile } = useHandlePlayMedia()
    const { data: watchHistory } = useGetContinuityWatchHistory()
    const [page, setPage] = React.useState(1)

    if (!media) return null

    const play = IN_APP_PLAYER_READY
        ? (episode: Anime_Episode) => playMediaFile({ path: episode.localFile?.path ?? "", mediaId: entry.mediaId, episode })
        : undefined

    if ((!entry.listData && !entry._isNakamaEntry) || !entry.libraryData) {
        return <View className="gap-10">
            <PhoneDownloadedEpisodes mediaId={entry.mediaId} />
            {media.status !== "NOT_YET_RELEASED"
                ? <View className="flex-row items-center gap-2">
                    <LibraryBig size={20} color="#fefce8" />
                    <Text className="text-xl font-semibold tracking-[-0.5px] text-[#fefce8]">{entry._isNakamaEntry
                        ? t("Not in the Nakama's library", "Nicht in der Nakama-Bibliothek")
                        : t("Not in your library", "Nicht in deiner Bibliothek")}</Text>
                </View>
                : <Text className="text-lg font-semibold tracking-[-0.45px] text-[#fefce8]">{t("Not yet released", "Noch nicht erschienen")}</Text>}
            {/* 2.0.32: <h4>/<h5> (globals.css), then the list and the rest in their own `pt-4 space-y-10` box */}
            <View className="gap-10 pt-4">
                {!entry._isNakamaEntry && <UndownloadedEpisodeList downloadInfo={entry.downloadInfo} media={media} />}
                {bottomSection}
            </View>
        </View>
    }

    const paginate = mainEpisodes.length >= PAGINATE_FROM
    const pages = paginate ? Math.ceil(mainEpisodes.length / PAGE) : 1
    const shown = paginate ? mainEpisodes.slice((page - 1) * PAGE, page * PAGE) : mainEpisodes

    return <View className="gap-6">
        <PhoneDownloadedEpisodes mediaId={entry.mediaId} />
        {hasInvalidEpisodes &&<View className="flex-row items-center gap-2 rounded-surface-sm bg-[rgba(234,179,8,0.12)] p-3">
            <CircleAlert size={18} color={colors.smWarning} />
            <Text className="flex-1 text-sm">{t("Some episodes are invalid. Update the metadata to fix this.", "Einige Episoden sind ungültig. Aktualisiere die Metadaten, um das zu beheben.")}</Text>
        </View>}

        {episodesToWatch.length > 0 && <UpNextRow episodes={episodesToWatch} entry={entry} watchHistory={watchHistory} onPlay={play} />}

        <View className="gap-10">
            <View>
                {shown.map(episode => <EpisodeItem key={episode.localFile?.path || episode.episodeNumber} mobileEntry episode={episode} media={media}
                    isWatched={!!entry.listData?.progress && entry.listData.progress >= episode.progressNumber} watchedProgress={entry.listData?.progress}
                    onPlay={play} percentageComplete={getEpisodePercentageComplete(watchHistory, entry.mediaId, episode.episodeNumber)} />)}
                {pages > 1 && <View className="mt-6 flex-row flex-wrap justify-center gap-1">
                    {Array.from({ length: pages }, (_, i) => i + 1).map(n => <Pressable key={n} accessibilityRole="button" accessibilityState={{ selected: n === page }}
                        onPress={() => setPage(n)} className={cn("h-11 min-w-11 items-center justify-center rounded-full px-3", n === page ? "bg-sm-surface-control" : "active:bg-sm-surface-raised")}>
                        <Text className={n === page ? "font-semibold" : "text-sm-text-muted"}>{n}</Text>
                    </Pressable>)}
                </View>}
            </View>

            {!entry._isNakamaEntry && <UndownloadedEpisodeList downloadInfo={entry.downloadInfo} media={media} watchedProgress={entry.listData?.progress} />}

            {specialEpisodes.length > 0 && <View className="gap-2">
                <SectionTitle>{t("Specials", "Specials")}</SectionTitle>
                <View>{specialEpisodes.map(episode => <EpisodeItem key={episode.localFile?.path || episode.displayTitle} episode={episode} media={media}
                    watchedProgress={entry.listData?.progress} onPlay={play} />)}</View>
            </View>}

            {ncEpisodes.length > 0 && <View className="gap-2">
                <SectionTitle>{t("Others", "Sonstiges")}</SectionTitle>
                <View>{ncEpisodes.map(episode => <EpisodeItem key={episode.localFile?.path} episode={episode} media={media}
                    watchedProgress={entry.listData?.progress} onPlay={play} />)}</View>
            </View>}

            {bottomSection}
        </View>
    </View>
}

/** The episode cards over the list (the carousel of EpisodeCard): picture, episode title, "Episode 3", watch progress */
export function UpNextRow({ episodes, entry, watchHistory, onPlay }: {
    episodes: Anime_Episode[], entry: Anime_Entry, watchHistory: ReturnType<typeof useGetContinuityWatchHistory>["data"], onPlay?: (episode: Anime_Episode) => void
}) {
    const t = useTr()
    const { width } = useWindowDimensions()
    const cardWidth = Math.round(Math.min(width * 0.72, 300))
    return <FlashList horizontal data={episodes} keyExtractor={(episode, i) => episode.localFile?.path || String(i)} showsHorizontalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ width: 12 }} />} snapToInterval={cardWidth + 12} snapToAlignment="start" decelerationRate="fast"
        renderItem={({ item: episode }) => {
            const image = episode.episodeMetadata?.image || episode.baseAnime?.bannerImage || episode.baseAnime?.coverImage?.extraLarge
            const percent = getEpisodePercentageComplete(watchHistory, entry.mediaId, episode.episodeNumber)
            const minutes = getEpisodeMinutesRemaining(watchHistory, entry.mediaId, episode.episodeNumber)
            return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !onPlay }} disabled={!onPlay} onPress={() => onPlay?.(episode)}
                accessibilityLabel={`${t("Play", "Abspielen")}: ${episode.displayTitle}${episode.episodeTitle ? ` · ${episode.episodeTitle}` : ""}`}
                style={{ width: cardWidth }} className="aspect-video justify-end overflow-hidden rounded-surface bg-sm-surface-control">
                {!!image && <Image source={getImageUrl(image)} contentFit="cover" style={{ position: "absolute", inset: 0 }} accessibilityIgnoresInvertColors />}
                <View className="px-3 pb-3 pt-8" style={{ backgroundImage: "linear-gradient(180deg, rgba(12,12,14,0) 0%, rgba(12,12,14,0.85) 60%)" }}>
                    {!!episode.episodeTitle && <Text numberOfLines={1} className="text-[13px] text-sm-text-muted">{episode.episodeTitle}</Text>}
                    <Text className="text-[15px] font-semibold">{episode.displayTitle}{minutes ? `  ·  ${minutes} ${t("min left", "Min. übrig")}` : ""}</Text>
                </View>
                {!!percent && <View className="absolute bottom-0 left-0 h-1 w-full bg-white/10"><View style={{ width: `${Math.min(100, percent)}%` }} className="h-full bg-brand-500" /></View>}
            </Pressable>
        }} />
}

/** One row of the episode list (EpisodeGridItem, mobile-anime.css): the whole row plays, the actions sit on the right */
export function EpisodeRow({ media, image, title, episodeTitle, isWatched, isInvalid, isFiller, length, percentageComplete, episodeNumber, watchedProgress,
    mobileEntry, onPress, action, children }: {
    media: AL_BaseAnime
    image?: string | null
    title: string
    episodeTitle?: string | null
    isWatched?: boolean
    isInvalid?: boolean
    isFiller?: boolean
    length?: number | string | null
    percentageComplete?: number
    episodeNumber?: number
    watchedProgress?: number
    mobileEntry?: boolean
    onPress?: () => void
    action?: React.ReactNode
    children?: React.ReactNode
}) {
    const t = useTr()
    const ts = useThemeSettings()
    const serverStatus = useServerStatus()
    const spoiler = useEpisodeSpoilerState(ts, { mediaId: media.id, episodeNumber, watchedProgress })
    const shown = image || media.coverImage?.large
    const playable = !!onPress
    return <View className="flex-row items-center border-b border-sm-line py-[11px] pl-1 pr-1">
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !playable }} disabled={!playable} onPress={onPress}
            accessibilityLabel={`${t("Play", "Abspielen")}: ${title}${episodeTitle ? ` · ${episodeTitle}` : ""}`}
            className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-80">
            <View className={cn("h-14 w-24 overflow-hidden rounded-[8px] bg-sm-surface-control", isInvalid && "border-2 border-red-700", isFiller && "border-2 border-yellow-900")}>
                {/* memory-disk (r19): a row drawn again keeps its decoded thumbnail instead of reading the disk cache again */}
                {!!shown && <Image source={getImageUrl(shown)} contentFit="cover" cachePolicy="memory-disk" blurRadius={spoiler.blurImage ? 24 : 0}
                    style={{ position: "absolute", inset: 0, opacity: isWatched ? 0.25 : 1 }} accessibilityIgnoresInvertColors />}
                {serverStatus?.settings?.library?.enableWatchContinuity && !!percentageComplete && !isWatched &&
                    <View className="absolute bottom-0 left-0 h-1 w-full bg-white/10"><View style={{ width: `${Math.min(100, percentageComplete)}%` }} className="h-full bg-brand-500" /></View>}
                {isFiller && <View className="absolute left-0 top-0 rounded-br-[6px] bg-orange-800 px-1"><Text className="text-[11px] font-semibold text-white">Filler</Text></View>}
            </View>
            <View className="min-w-0 flex-1">
                {isInvalid && <Text className="text-[13px] text-red-300">Unidentified</Text>}
                <Text numberOfLines={2} className={cn(episodeTitle ? "text-xs leading-[17px] text-sm-text-subtle" : "text-[15px] font-semibold")}>
                    {title.replaceAll("`", "'")}{!!episodeTitle && !!length && `   ${length}m`}
                </Text>
                {!!episodeTitle && episodeTitle !== title && <Text numberOfLines={2} className="text-[15px] font-medium leading-[21px]" style={spoiler.blurTitle ? { opacity: 0.15 } : undefined}>
                    {episodeTitle.replaceAll("`", "'")}
                </Text>}
                {children}
                {mobileEntry && <Text className="mt-[3px] text-xs text-sm-accent">{isWatched ? t("Watched", "Gesehen") : t("Available", "Verfügbar")}</Text>}
            </View>
        </Pressable>
        {!!action && <View className="items-center">{action}</View>}
    </View>
}

export function IconAction({ icon: Icon, label, color = colors.smTextSubtle, disabled, onPress }: {
    icon: React.ComponentType<{ size?: number, color?: string }>, label: string, color?: string, disabled?: boolean, onPress?: (anchor: CardMenuAnchor) => void
}) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
        onPress={event => onPress?.({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })}
        className={cn("h-11 w-11 items-center justify-center rounded-full active:bg-sm-surface-control", disabled && "opacity-60")}>
        <Icon size={20} color={color} />
    </Pressable>
}

const PLUGIN_EPISODE_FILTERS = {
    undownloaded: forEpisodeType("undownloaded"),
    torrentstream: forEpisodeType("torrentstream"),
    debridstream: forEpisodeType("debridstream"),
}

/**
 * The plugins' ⋯ on an episode that has no menu of its own (PluginEpisodeGridItemMenuItems isDropdownMenu): episodes not
 * in the library and the torrent/debrid stream lists. Nothing without plugin items.
 */
export function PluginEpisodeMenu({ type, episode, title }: { type: keyof typeof PLUGIN_EPISODE_FILTERS, episode: Anime_Episode, title: string }) {
    const t = useTr()
    const items = usePluginActions("episodeGridItems", PLUGIN_EPISODE_FILTERS[type])
    const run = useRunPluginAction()
    const [menuAt, setMenuAt] = React.useState<CardMenuAnchor | null>(null)
    const close = React.useCallback(() => setMenuAt(null), [])
    if (!items.length) return null
    return <>
        <IconAction icon={Ellipsis} label={t("Episode options", "Optionen der Folge")} onPress={setMenuAt} />
        <CardMenu anchor={menuAt} title={title} onClose={close} items={items.map(item => ({ id: `plugin:${item.extensionId}:${item.id}`,
            label: item.label || "???", icon: Puzzle, onPress: () => run(item, { episode, type }) }))} />
    </>
}

/** A library episode: lock toggle and its menu (Mark as watched, File info, Update metadata, Copy stream URL, Unmatch) */
function EpisodeItem({ episode, media, isWatched, watchedProgress, onPlay, percentageComplete, mobileEntry }: {
    episode: Anime_Episode
    media: AL_BaseAnime
    isWatched?: boolean
    watchedProgress?: number
    onPlay?: (episode: Anime_Episode) => void
    percentageComplete?: number
    mobileEntry?: boolean
}) {
    const t = useTr()
    const { updateLocalFile, isPending } = useUpdateLocalFileData()
    const { mutate: updateProgress, isPending: isUpdatingProgress } = useUpdateAnimeEntryProgress(media.id, episode.progressNumber, false)
    const { getHMACTokenQueryParam } = useServerHMACAuth()
    const { encodePath } = useExternalPlayerLink()
    const [menuAt, setMenuAt] = React.useState<CardMenuAnchor | null>(null)
    const [sheet, setSheet] = React.useState<"info" | "metadata" | null>(null)
    const closeMenu = React.useCallback(() => setMenuAt(null), [])
    const pluginItems = usePluginActions("episodeGridItems", libraryEpisodeItems)
    const runPlugin = useRunPluginAction()

    const copyStreamUrl = async () => {
        if (!episode.localFile) return
        if (!episode._isNakamaEpisode) {
            const path = encodePath ? utf8ToBase64(episode.localFile.path) : encodeURIComponent(episode.localFile.path)
            const tokenQuery = await getHMACTokenQueryParam("/api/v1/mediastream/file", "&")
            await copyToClipboard(`${getServerBaseUrl()}/api/v1/mediastream/file?path=${path}${tokenQuery}`)
        } else {
            const tokenQuery = await getHMACTokenQueryParam("/api/v1/nakama/stream", "&")
            await copyToClipboard(`${getServerBaseUrl()}/api/v1/nakama/stream?type=file&path=${utf8ToBase64(episode.localFile.path)}${tokenQuery}`)
        }
        toast.info(t("Stream URL copied", "Stream-URL kopiert"))
    }

    const items = [
        // Sets the list progress to this episode, as the player's "Update progress" does
        ...(!isWatched && episode.progressNumber > 0 ? [{
            id: "watched", label: t("Mark as watched", "Als gesehen markieren"), icon: CircleCheck,
            onPress: () => !isUpdatingProgress && updateProgress({ episodeNumber: episode.progressNumber, mediaId: media.id, totalEpisodes: media.episodes || 0, malId: media.idMal || undefined },
                { onSuccess: () => {
                    toast.success(t("Marked as watched", "Als gesehen markiert"))
                    successFeedback()
                } }),
        }] : []),
        ...(episode.localFile ? [{ id: "info", label: t("File info", "Dateiinfo"), icon: Info, onPress: () => setSheet("info") }] : []),
        ...(!episode._isNakamaEpisode ? [{ id: "metadata", label: t("Update metadata", "Metadaten ändern"), icon: PencilLine, onPress: () => setSheet("metadata") }] : []),
        ...(episode.localFile ? [{ id: "stream-url", label: t("Copy stream URL", "Stream-URL kopieren"), icon: FileVideo, onPress: () => void copyStreamUrl() }] : []),
        ...(!episode._isNakamaEpisode && episode.localFile ? [{ id: "unmatch", label: t("Unmatch", "Zuordnung lösen"), icon: Unlink,
            onPress: () => updateLocalFile(episode.localFile!, { mediaId: 0, locked: false, ignored: false }) }] : []),
        // the plugins' items for library episodes (PluginEpisodeGridItemMenuItems type "library")
        ...(!episode._isNakamaEpisode ? pluginItems.map(item => ({ id: `plugin:${item.extensionId}:${item.id}`, label: item.label || "???", icon: Puzzle,
            onPress: () => runPlugin(item, { episode, type: "library" }) })) : []),
    ]

    return <>
        <EpisodeRow media={media} image={episode.episodeMetadata?.image} title={episode.displayTitle} episodeTitle={episode.episodeTitle}
            isWatched={episode.progressNumber > 0 && isWatched} isInvalid={episode.isInvalid} isFiller={episode.episodeMetadata?.isFiller}
            length={episode.episodeMetadata?.length} percentageComplete={percentageComplete} episodeNumber={episode.episodeNumber} watchedProgress={watchedProgress}
            mobileEntry={mobileEntry} onPress={onPlay ? () => onPlay(episode) : undefined}
            action={<>
                {!episode._isNakamaEpisode && <IconAction icon={episode.localFile?.locked ? BadgeCheck : LockOpen} disabled={isPending}
                    label={episode.localFile?.locked ? t("Unlock file", "Datei entsperren") : t("Lock file", "Datei sperren")}
                    color={episode.localFile?.locked ? colors.smSuccess : colors.smWarning}
                    onPress={() => episode.localFile && updateLocalFile(episode.localFile, { locked: !episode.localFile.locked })} />}
                <IconAction icon={Ellipsis} label={t("Episode options", "Optionen der Folge")} onPress={setMenuAt} />
            </>} />
        <CardMenu anchor={menuAt} title={episode.displayTitle} items={items} onClose={closeMenu} />
        {sheet === "info" && <EpisodeInfoDialog episode={episode} onClose={() => setSheet(null)} />}
        {sheet === "metadata" && <MetadataSheet episode={episode} onClose={() => setSheet(null)} />}
    </>
}

/** "File info": the file name and the episode's details, instead of the name under every title */
export function EpisodeInfoDialog({ episode, onClose }: { episode: Anime_Episode, onClose: () => void }) {
    const t = useTr()
    const summary = (episode.episodeMetadata?.summary || episode.episodeMetadata?.overview)?.replaceAll("`", "'")?.replace(/source:.*/gi, "")
    return <Dialog title={episode.displayTitle} open onOpenChange={open => !open && onClose()}>
        {!!episode.episodeTitle && <Text className="text-lg font-semibold">{episode.episodeTitle.replaceAll("`", "'")}</Text>}
        <Muted>{episode.episodeMetadata?.airDate || t("Unknown airing date", "Sendedatum unbekannt")} - {episode.episodeMetadata?.length || "N/A"} {t("minutes", "Minuten")}</Muted>
        <Text className="text-sm-text-muted">{summary || t("No summary", "Keine Zusammenfassung")}</Text>
        <View className="h-px bg-sm-line" />
        <Muted numberOfLines={2}>{episode.localFile?.name || episode.localFile?.parsedInfo?.original}</Muted>
        {!!episode.episodeMetadata?.anidbId && <View className="flex-row flex-wrap items-center gap-2">
            <Text>{t("AniDB Episode", "AniDB-Episode")}: {episode.fileMetadata?.aniDBEpisode}</Text>
            <Button intent="text" onPress={() => openInAppBrowser(`https://anidb.net/episode/${episode.episodeMetadata?.anidbId}#layout-footer`)}>{t("Open on AniDB", "Auf AniDB öffnen")}</Button>
        </View>}
    </Dialog>
}

/** Episode number, AniDB episode and type of a local file */
function MetadataSheet({ episode, onClose }: { episode: Anime_Episode, onClose: () => void }) {
    const t = useTr()
    const { updateLocalFile, isPending } = useUpdateLocalFileData()
    const [number, setNumber] = React.useState(String(episode.fileMetadata?.episode ?? ""))
    const [anidb, setAnidb] = React.useState(episode.fileMetadata?.aniDBEpisode ?? "")
    const [type, setType] = React.useState<string>(episode.fileMetadata?.type ?? "main")
    const valid = number.trim() !== "" && Number(number) >= 0
    const save = () => episode.localFile && updateLocalFile(episode.localFile, {
        metadata: { ...episode.localFile.metadata, type: type as Anime_LocalFileType, episode: Number(number), aniDBEpisode: anidb.toUpperCase() },
    }, () => {
        onClose()
        toast.success(t("Metadata saved", "Metadaten gespeichert"))
    })
    const field = "min-h-12 rounded-surface-sm bg-sm-surface-raised px-4 font-sans text-base text-sm-text"
    return <Sheet title={episode.displayTitle} description={episode.localFile?.name} open onOpenChange={open => !open && onClose()}
        footer={<Button wrapperClassName="flex-1" loading={isPending} disabled={!valid} onPress={save}>{t("Save", "Speichern")}</Button>}>
        <SheetGroup title={t("Episode number", "Episodennummer")} note={t("Relative episode number. If movie, episode number = 1", "Relative Episodennummer. Bei einem Film ist sie 1.")}>
            <TextInput value={number} onChangeText={v => setNumber(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" accessibilityLabel={t("Episode number", "Episodennummer")} className={field} />
        </SheetGroup>
        <SheetGroup title={t("AniDB episode", "AniDB-Episode")} note={t("Specials typically contain the letter S", "Specials enthalten meist den Buchstaben S")}>
            <TextInput value={anidb} onChangeText={setAnidb} autoCapitalize="characters" accessibilityLabel={t("AniDB episode", "AniDB-Episode")} className={field} />
        </SheetGroup>
        <SheetGroup title={t("Type", "Typ")}>
            <RowGroup>
                {[["main", t("Main", "Haupt")], ["special", "Special"], ["nc", t("NC/Other", "NC/Sonstiges")]].map(([value, label]) =>
                    <PickRow key={value} radio checked={type === value} label={label} onPress={() => setType(value)} />)}
            </RowGroup>
        </SheetGroup>
    </Sheet>
}

/** Episodes neither in the library nor (with a torrent provider) watched; at most 28 */
function UndownloadedEpisodeList({ downloadInfo, media, watchedProgress }: { downloadInfo: Anime_EntryDownloadInfo | undefined, media: AL_BaseAnime, watchedProgress?: number }) {
    const t = useTr()
    const { hasTorrentProvider } = useHasTorrentProvider()
    const [info, setInfo] = React.useState<Anime_Episode | null>(null)
    const setTorrentSearchEpisode = useSetAtom(__torrentSearch_selectionEpisodeAtom)
    const openTorrentSearch = useSetAtom(__torrentSearch_selectionAtom)
    // episodes already saved (or on their way) on the phone are not offered again (web excludeEpisodes)
    const onPhone = useOfflineEpisodes(media.id)
    const episodes = downloadInfo?.episodesToDownload?.filter(ep => !onPhone.some(item => Number(item.episode) === ep.episodeNumber))
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
    if (!episodes?.length) return null
    const text = !hasTorrentProvider ? t("The following episodes are not in your library:", "Diese Episoden sind nicht in deiner Bibliothek:")
        : downloadInfo?.rewatch ? t("You have not downloaded the following:", "Das hast du noch nicht heruntergeladen:")
            : t("You have not watched nor downloaded the following:", "Das hast du weder gesehen noch heruntergeladen:")
    return <View className="gap-4">
        <Text className="text-base">{text}</Text>
        <View>
            {episodes.slice(0, 28).map((ep, idx) => {
                if (!ep.episode) return null
                const episode = ep.episode
                return <EpisodeRow key={episode.localFile?.path || idx} media={media} image={episode.episodeMetadata?.image} isInvalid={episode.isInvalid}
                    title={episode.displayTitle} episodeTitle={episode.episodeTitle} episodeNumber={episode.episodeNumber} watchedProgress={watchedProgress}
                    action={<>
                        {/* The torrent sheet, searching this episode to download */}
                        {hasTorrentProvider && <IconAction icon={Download} label={t("Download", "Herunterladen")} color="#fed7aa" onPress={() => {
                            setTorrentSearchEpisode(episode.episodeNumber)
                            React.startTransition(() => openTorrentSearch("download"))
                        }} />}
                        <IconAction icon={Info} label={t("Episode info", "Infos zur Folge")} onPress={() => setInfo(episode)} />
                        <PluginEpisodeMenu type="undownloaded" episode={episode} title={episode.displayTitle} />
                    </>}>
                    <View className="mt-1 flex-row items-center gap-1">
                        <CalendarDays size={14} color={colors.smTextMuted} />
                        <Text className="text-sm text-sm-text-muted">{episode.episodeMetadata?.airDate
                            ? `${t("Aired on", "Ausgestrahlt am")} ${new Date(episode.episodeMetadata.airDate).toLocaleDateString()}`
                            : t("Aired", "Ausgestrahlt")}</Text>
                    </View>
                </EpisodeRow>
            })}
        </View>
        {episodes.length > 28 && <Text className="text-lg font-semibold">{t("And more...", "Und mehr …")}</Text>}
        {!!info && <EpisodeInfoDialog episode={info} onClose={() => setInfo(null)} />}
    </View>
}

