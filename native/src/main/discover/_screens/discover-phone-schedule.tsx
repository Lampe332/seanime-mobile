import { CardMenu, type CardMenuAnchor } from "@/components/shared/card-menu"
import { useCoverFlightSource } from "@/components/shared/cover-flight"
import { LoadingRows, Notice, TextAction } from "@/components/shared/phone-kit"
import { PhoneEmpty, PhoneSection, useOfflineAware } from "@/components/shared/phone-cards"
import { Button } from "@/components/ui/button/button"
import { Text } from "@/components/ui/text/text"
import { getAppLanguage, type Translate, useTr } from "@/lib/app-language"
import { MENU_ENTRIES } from "@/lib/nav/nav-items"
import { useRouter } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { useMediaPreviewModal } from "@/main/_features/media/_containers/media-preview-phone"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { type Airing, airingTimeLabel, listStatusLabel, scheduleDayTitle, scheduleFacts } from "@/main/discover/_lib/discover-phone"
import { type DiscoverSchedule, useDiscoverEntry } from "@/main/discover/_lib/discover-phone-hooks"
import { isToday } from "date-fns/isToday"
import { Image } from "expo-image"
import { useImageFade } from "@/components/ui/core/image-fade"
import Eye from "lucide-react-native/icons/eye"
import React from "react"
import { Pressable, View } from "react-native"

/** The header's facts line on the schedule tab; nothing when the two weeks are empty (the empty state says so). */
export function scheduleFactsLine(t: Translate, schedule: DiscoverSchedule) {
    if (schedule.error || schedule.offline || ((schedule.moreError || schedule.moreOffline) && !schedule.days?.length)) {
        return t("Schedule not loaded", "Sendeplan nicht geladen")
    }
    if (!schedule.days || schedule.loadingMore) return t("Loading the schedule…", "Sendeplan wird geladen …")
    if (!schedule.count && schedule.reach >= 14) return undefined
    return scheduleFacts(t, schedule.count, schedule.reach)
}

/**
 * Schedule tab (discover-phone-schedule.tsx): the next two weeks as day sections of episode rows. "Open calendar" leads to
 * the schedule screen once it exists (2.7, `MENU_ENTRIES.ready`); until then the notices offer only Try again.
 */
export function DiscoverPhoneSchedule({ schedule }: { schedule: DiscoverSchedule }) {
    const t = useTr()
    const router = useRouter()
    const offlineAware = useOfflineAware()
    const german = getAppLanguage() === "de"
    // "Later today" / "Tomorrow" are counted from when the tab was opened; the query window changes at midnight anyway
    const [now] = React.useState(() => Date.now())
    const calendarReady = MENU_ENTRIES.some(entry => entry.id === "schedule" && entry.ready)
    const calendar = calendarReady ? <TextAction label={t("Open calendar", "Kalender öffnen")} onPress={() => router.push("/schedule")} /> : null
    const retry = <TextAction label={t("Try again", "Erneut versuchen")} onPress={schedule.retry} />

    if (schedule.offline) return <Notice text={t("No internet connection. The schedule loads when you're back online.",
        "Keine Internetverbindung. Der Sendeplan lädt, sobald du wieder online bist.")}>{calendar}</Notice>
    if (schedule.error) return <Notice text={offlineAware(["The schedule couldn't be loaded.", "Der Sendeplan konnte nicht geladen werden."],
        ["No internet connection, so the schedule couldn't be loaded.", "Keine Internetverbindung, deshalb konnte der Sendeplan nicht geladen werden."])}>
        {retry}
        {calendar}
    </Notice>
    if (!schedule.days) return <ScheduleBones label={t("Loading the schedule", "Sendeplan wird geladen")} />
    if (!schedule.days.length && schedule.reach >= 14) return <PhoneEmpty title={t("No episodes in the next two weeks", "Keine Folgen in den nächsten zwei Wochen")}
        text={t("AniList lists no upcoming episodes of Japanese anime for this period.", "AniList führt für diesen Zeitraum keine kommenden Folgen japanischer Anime.")}>
        {calendarReady && <Button intent="secondary" onPress={() => router.push("/schedule")}>{t("Open calendar", "Kalender öffnen")}</Button>}
    </PhoneEmpty>

    return (
        <View className="gap-6">
            {schedule.days.map(day => (
                // Today in the accent, as in the calendar
                <PhoneSection key={day.key} title={scheduleDayTitle(t, day.date, now, german)} count={day.items.length}
                    titleClassName={isToday(day.date) ? "text-sm-accent" : undefined}>
                    <View className="gap-0.5 overflow-hidden rounded-surface">
                        {day.items.map(item => <ScheduleRow key={item.id} item={item} german={german} />)}
                    </View>
                </PhoneSection>
            ))}
            {schedule.loadingMore && <ScheduleBones label={t("Loading the later days", "Spätere Tage werden geladen")} short />}
            {schedule.moreError && <Notice text={offlineAware(["The later days couldn't be loaded.", "Die späteren Tage konnten nicht geladen werden."],
                ["No internet connection, so the later days couldn't be loaded.", "Keine Internetverbindung, deshalb konnten die späteren Tage nicht geladen werden."])}>
                {retry}
                {calendar}
            </Notice>}
            {schedule.moreOffline && <Notice text={t("No internet connection. The later days load when you're back online.",
                "Keine Internetverbindung. Die späteren Tage laden, sobald du wieder online bist.")}>{calendar}</Notice>}
        </View>
    )
}

/** A day head and its rows as bones (`["head", "row", "row", "row", …]`). */
function ScheduleBones({ label, short }: { label: string, short?: boolean }) {
    return (
        <View className="gap-3">
            <View className="mt-1 h-7 w-36 rounded-surface-sm bg-sm-surface-raised" />
            <LoadingRows label={label} count={short ? 2 : 3} />
        </View>
    )
}

/** An episode: cover, title, "Episode 5" (with the list status when on a list), time; long press for Preview. */
const ScheduleRow = React.memo(function ScheduleRow({ item, german }: { item: Airing, german: boolean }) {
    const t = useTr()
    const fade = useImageFade()
    const media = item.media!
    const serverStatus = useServerStatus()
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    const [menuAt, setMenuAt] = React.useState<CardMenuAnchor | null>(null)
    const closeMenu = React.useCallback(() => setMenuAt(null), [])
    const status = listStatusLabel(t, "anime", useDiscoverEntry("anime", media.id).listData?.status)
    const title = media.title?.userPreferred || media.title?.romaji || media.title?.english || ""
    const veiled = !!serverStatus?.settings?.anilist?.blurAdultContent && !!media.isAdult
    const time = airingTimeLabel(item.airingAt, german)
    const episode = t(`Episode ${item.episode}`, `Folge ${item.episode}`)
    // the row's cover flies into the page it opens (cover-flight.tsx); a blurred one does not fly
    const coverUri = getImageUrl(media.coverImage?.large || media.coverImage?.medium || "")
    const { coverRef, onLoad, hidden, open } = useCoverFlightSource(media.id, veiled ? "" : coverUri, getImageUrl(media.coverImage?.extraLarge || ""))
    return (
        <Pressable
            accessibilityRole="link"
            accessibilityLabel={[title, episode, status, time].filter(Boolean).join(", ")}
            accessibilityHint={t("Long press for more", "Lange drücken für mehr")}
            onPress={() => open(`/entry?id=${media.id}`)}
            onLongPress={event => setMenuAt({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })}
            delayLongPress={500}
            className="min-h-[76px] w-full flex-row flex-wrap items-center gap-3.5 bg-sm-surface-raised py-2.5 pl-2.5 pr-4 active:bg-sm-surface-control"
        >
            <CardMenu anchor={menuAt} title={title} onClose={closeMenu}
                items={[{ id: "preview", label: t("Preview", "Vorschau"), icon: Eye, onPress: () => setPreviewModalMediaId(media.id, "anime") }]} />
            <View ref={coverRef} collapsable={false} className="aspect-[2/3] w-11 overflow-hidden rounded-[8px] bg-sm-surface-control">
                <Image source={coverUri} recyclingKey={String(media.id)} contentFit="cover"
                    blurRadius={veiled ? 24 : 0} transition={fade} onLoad={onLoad}
                    style={{ position: "absolute", inset: 0, opacity: hidden ? 0 : 1 }} accessibilityIgnoresInvertColors />
                {veiled && <View pointerEvents="none" className="absolute inset-0 bg-black/30" />}
            </View>
            {/* Large text: the row wraps (time on its own line) instead of squeezing the title */}
            <View style={{ flexBasis: 128 }} className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={4} className="text-[15px] font-semibold leading-[20px]">{title}</Text>
                <Text className="text-[13px] text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>
                    {episode}
                    {!!status && <>{" · "}<Text className="text-[13px] font-semibold text-sm-accent">{status}</Text></>}
                </Text>
            </View>
            <Text className="ml-auto text-[13px] font-semibold text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>{time}</Text>
        </Pressable>
    )
})
