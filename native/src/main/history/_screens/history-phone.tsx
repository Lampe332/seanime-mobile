// geschrieben nach: Mihon/Kotatsu Verlauf-Seite (zuletzt gesehen/gelesen nach Tag, Eintrag entfernen, alles löschen) und dem Stil von scan-summaries-phone.tsx (Zeilen mit Cover)

import { useClearWatchHistory, useHistoryMedia, useIncognito, useRemoveWatchHistoryItem } from "@/api/hooks/app-switches.hooks"
import { useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { PhoneEmpty } from "@/components/shared/phone-cards"
import { LoadingRows, Notice, TextAction } from "@/components/shared/phone-kit"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { Text } from "@/components/ui/text/text"
import { appLanguageAtom, type Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { useThemeColors } from "@/lib/theme/appearance"
import { usePlayNext } from "@/main/_atoms/playback.atoms"
import { __manga_resumeLocationsAtom } from "@/main/manga/_lib/manga-chapter-reader.atoms"
import { ConfirmSheet } from "@/main/settings/_components/settings-kit"
import { Image } from "expo-image"
import { useAtom, useAtomValue } from "jotai"
import HatGlasses from "lucide-react-native/icons/hat-glasses"
import X from "lucide-react-native/icons/x"
import React from "react"
import { Pressable, View } from "react-native"
import { type HistoryEntry, animeHistory, entryLine, groupByDay, historyEntries, mangaHistory, timeOfDay, withoutManga } from "../_lib/history"

type Media = { title?: { userPreferred?: string | null } | null, coverImage?: { large?: string | null, medium?: string | null } | null }

/**
 * History (Menu › History): what was watched and read last, by day. A tap goes on (anime: plays the next episode on its
 * page, manga: its page with "Continue reading"); × or a long press takes an entry out, "Clear history" all of them.
 * Only the app's own history changes, never AniList.
 */
export function HistoryPhone() {
    useThemeColors()
    const t = useTr()
    const language = useAtomValue(appLanguageAtom)
    const router = useRouter()
    const { setPlayNext } = usePlayNext()
    const incognito = useIncognito()
    const { data: watchHistory, isLoading, isError, refetch: refetchHistory } = useGetContinuityWatchHistory()
    const [locations, setLocations] = useAtom(__manga_resumeLocationsAtom)
    const entries = React.useMemo(() => historyEntries(animeHistory(watchHistory), mangaHistory(locations)), [watchHistory, locations])
    const ids = React.useMemo(() => [...new Set(entries.map(entry => entry.mediaId))].sort((a, b) => a - b), [entries])
    const { data: media, refetch: refetchMedia } = useHistoryMedia(ids)
    // pull to refresh: the watch history and the titles again (read only); manga places live on this device
    const refresh = () => Promise.all([refetchHistory(), ids.length > 0 ? refetchMedia() : null])
    // the day the screen was opened ("Today"): read once, not on every render
    const [now] = React.useState(() => Date.now())
    const days = React.useMemo(() => groupByDay(entries, now, language), [entries, now, language])
    const { mutate: removeAnime } = useRemoveWatchHistoryItem()
    const { mutate: clearAnime } = useClearWatchHistory()
    const [removing, setRemoving] = React.useState<HistoryEntry | null>(null)
    const [clearing, setClearing] = React.useState(false)

    const remove = (entry: HistoryEntry) => {
        if (entry.kind === "anime") removeAnime({ mediaId: entry.mediaId })
        else setLocations(prev => withoutManga(prev, entry.mediaId))
    }
    // setPlayNext is new on every render: read from a ref, so the rows keep one `open`
    const playNext = React.useRef(setPlayNext)
    React.useEffect(() => {
        playNext.current = setPlayNext
    })
    const open = React.useCallback((entry: HistoryEntry) => {
        if (entry.kind === "manga") router.push(`/manga/entry?id=${entry.mediaId}`)
        else playNext.current(entry.mediaId, () => router.push(`/entry?id=${entry.mediaId}`))
    }, [router])
    const titleOf = (entry: HistoryEntry) => (media?.[String(entry.mediaId)] as Media | undefined)?.title?.userPreferred
        || (entry.kind === "anime" ? t("Anime", "Anime") : t("Manga", "Manga"))

    return (
        <PhoneScreen title={t("History", "Verlauf")} onRefresh={refresh}
            subtitle={entries.length ? t(`${entries.length} titles`, `${entries.length} Titel`) : undefined}
            actions={entries.length ? <TextAction label={t("Clear history", "Verlauf löschen")} onPress={() => setClearing(true)} /> : undefined}>
            {incognito && (
                <View accessibilityRole="text" className="flex-row items-center gap-2 self-start rounded-full bg-sm-accent-soft px-3 py-1.5">
                    <HatGlasses size={15} color={colors.smAccent} />
                    <Text className="text-[13px] font-semibold text-sm-accent">{t("Incognito: nothing new is added", "Inkognito: nichts Neues wird gemerkt")}</Text>
                </View>
            )}
            {/* the watched episodes failed to load: said so, the chapters read on this device still show */}
            {isError && !watchHistory && <Notice text={t("The watched episodes could not be loaded.", "Die geschauten Folgen konnten nicht geladen werden.")}>
                <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => void refetchHistory()} />
            </Notice>}
            {isLoading ? <LoadingRows label={t("Loading history", "Verlauf wird geladen")} count={4} />
                : !entries.length ? isError && !watchHistory ? null : (
                    <PhoneEmpty title={t("No history yet", "Noch kein Verlauf")}
                        text={t("Episodes you watch and chapters you read show up here.", "Folgen, die du schaust, und Kapitel, die du liest, erscheinen hier.")} />
                ) : days.map(day => (
                    <View key={day.key} className="gap-2">
                        <Text accessibilityRole="header" className="px-1 text-[13px] font-semibold tracking-[0.26px] text-sm-text-muted">{day.label}</Text>
                        <View className="gap-0.5 overflow-hidden rounded-surface">
                            {day.entries.map(entry => {
                                const cover = (media?.[String(entry.mediaId)] as Media | undefined)?.coverImage
                                const title = titleOf(entry)
                                const line = entryLine(entry, language)
                                return <HistoryRow key={`${entry.kind}-${entry.mediaId}`} t={t} entry={entry} title={title} line={line}
                                    time={timeOfDay(entry.at, language)} cover={cover?.large || cover?.medium || ""} onOpen={open} onRemove={setRemoving} />
                            })}
                        </View>
                    </View>
                ))}
            <ConfirmSheet open={!!removing} onOpenChange={open => { if (!open) setRemoving(null) }}
                title={t("Remove from history?", "Aus dem Verlauf entfernen?")}
                text={removing ? t(`${titleOf(removing)} leaves your history on this device. Your AniList stays as it is.`,
                    `${titleOf(removing)} verschwindet aus dem Verlauf auf diesem Gerät. Deine AniList bleibt, wie sie ist.`) : ""}
                action={t("Remove", "Entfernen")} danger onConfirm={() => { if (removing) remove(removing) }} />
            <ConfirmSheet open={clearing} onOpenChange={setClearing}
                title={t("Clear history?", "Verlauf löschen?")}
                text={t("Every watched episode and read chapter leaves your history on this device, and so does Continue watching. Your AniList stays as it is.",
                    "Alle geschauten Folgen und gelesenen Kapitel verschwinden aus dem Verlauf auf diesem Gerät, auch aus „Weiterschauen“. Deine AniList bleibt, wie sie ist.")}
                action={t("Clear", "Löschen")} danger onConfirm={() => {
                    clearAnime()
                    setLocations({})
                }} />
        </PhoneScreen>
    )
}

/** One entry; memoized, so a removed entry or newly loaded titles do not draw every row again. */
const HistoryRow = React.memo(function HistoryRow({ t, entry, title, line, time, cover, onOpen, onRemove }: {
    t: Translate
    entry: HistoryEntry
    title: string
    line: string
    time: string
    cover: string
    onOpen: (entry: HistoryEntry) => void
    onRemove: (entry: HistoryEntry) => void
}) {
    return (
        <Pressable accessibilityRole="button"
            accessibilityLabel={`${title}, ${line}, ${time}`}
            accessibilityHint={entry.kind === "anime" ? t("Continues watching", "Weiterschauen") : t("Opens the manga", "Öffnet den Manga")}
            accessibilityActions={[{ name: "remove", label: t("Remove from history", "Aus dem Verlauf entfernen") }]}
            onAccessibilityAction={() => onRemove(entry)}
            onPress={() => onOpen(entry)} onLongPress={() => onRemove(entry)} delayLongPress={350}
            className="min-h-[76px] flex-row items-center gap-3.5 bg-sm-surface-raised py-2.5 pl-2.5 pr-1 active:bg-sm-surface-control">
            <View className="h-[60px] w-11 overflow-hidden rounded-[6px] bg-sm-surface-control">
                {!!cover && <Image source={{ uri: cover }} style={COVER_STYLE} contentFit="cover" cachePolicy="memory-disk" recyclingKey={cover} />}
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={2} className="font-semibold">{title}</Text>
                <Text numberOfLines={1} className="text-[13px] text-sm-text-muted">
                    {`${entry.kind === "anime" ? t("Anime", "Anime") : t("Manga", "Manga")} · ${line}`}
                </Text>
                <Text className="text-[13px] text-sm-text-subtle" style={TABULAR}>{time}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("Remove from history", "Aus dem Verlauf entfernen")} hitSlop={6}
                onPress={() => onRemove(entry)} className="h-11 w-11 items-center justify-center rounded-full active:bg-sm-surface-control">
                <X size={18} color={colors.smTextSubtle} />
            </Pressable>
        </Pressable>
    )
})

const COVER_STYLE = { width: 44, height: 60 }
const TABULAR = { fontVariant: ["tabular-nums" as const] }
