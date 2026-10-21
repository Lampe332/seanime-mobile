import { SeaContextMenu } from "@/app/(main)/_features/context-menu/sea-context-menu"
import { MediaEntryCardAdultVeil } from "@/app/(main)/_features/media/_components/media-entry-card-components"
import { useMediaPreviewModal } from "@/app/(main)/_features/media/_containers/media-preview-modal"
import { offlineAware, PhoneEmpty, PhoneLoading, PhoneNotice, PhoneSection } from "@/app/(main)/_features/phone-screen/phone-screen"
import { PluginMediaCardContextMenuItems } from "@/app/(main)/_features/plugin/actions/plugin-actions"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { Airing, airingTimeLabel, listStatusLabel, scheduleDayTitle, scheduleFacts } from "@/app/(main)/discover/_lib/discover-phone"
import { DiscoverSchedule, useDiscoverEntry } from "@/app/(main)/discover/_lib/discover-phone-hooks"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuTrigger } from "@/components/ui/context-menu"
import { appLanguageAtom, Translate, useTr } from "@/lib/app-language"
import { getImageUrl } from "@/lib/server/assets"
import { isToday } from "date-fns"
import { useAtomValue } from "jotai/react"
import React from "react"
import { LuEye } from "react-icons/lu"

/** The header's facts line on the schedule tab; nothing when the two weeks are empty (the empty state says so). */
export function scheduleFactsLine(t: Translate, schedule: DiscoverSchedule) {
    if (schedule.error || schedule.offline || ((schedule.moreError || schedule.moreOffline) && !schedule.days?.length)) {
        return t("Schedule not loaded", "Sendeplan nicht geladen")
    }
    if (!schedule.days || schedule.loadingMore) return t("Loading the schedule…", "Sendeplan wird geladen …")
    if (!schedule.count && schedule.reach >= 14) return undefined
    return scheduleFacts(t, schedule.count, schedule.reach)
}

/** Schedule tab: the next two weeks as day sections of episode rows; the full calendar sits in the header. */
export function DiscoverPhoneSchedule({ schedule }: { schedule: DiscoverSchedule }) {
    const t = useTr()
    const german = useAtomValue(appLanguageAtom) === "de"
    const calendar = <SeaLink href="/schedule" className="ps-text-action" data-discover-calendar-link>{t("Open calendar", "Kalender öffnen")}</SeaLink>
    const retry = <button type="button" className="ps-text-action" onClick={schedule.retry}>{t("Try again", "Erneut versuchen")}</button>

    if (schedule.offline) return <PhoneNotice data-discover-schedule-error text={t("No internet connection. The schedule loads when you're back online.",
        "Keine Internetverbindung. Der Sendeplan lädt, sobald du wieder online bist.")}>{calendar}</PhoneNotice>
    if (schedule.error) return <PhoneNotice data-discover-schedule-error text={offlineAware(t,
        ["The schedule couldn't be loaded.", "Der Sendeplan konnte nicht geladen werden."],
        ["No internet connection, so the schedule couldn't be loaded.", "Keine Internetverbindung, deshalb konnte der Sendeplan nicht geladen werden."])}>
        {retry}
        {calendar}
    </PhoneNotice>
    if (!schedule.days) return <PhoneLoading label={t("Loading the schedule", "Sendeplan wird geladen")} layout={["head", "row", "row", "row", "head", "row", "row"]} />
    if (!schedule.days.length && schedule.reach >= 14) return <PhoneEmpty data-discover-schedule-empty title={t("No episodes in the next two weeks", "Keine Folgen in den nächsten zwei Wochen")}
        text={t("AniList lists no upcoming episodes of Japanese anime for this period.", "AniList führt für diesen Zeitraum keine kommenden Folgen japanischer Anime.")}>
        <SeaLink href="/schedule" className="ps-secondary">{t("Open calendar", "Kalender öffnen")}</SeaLink>
    </PhoneEmpty>

    const now = Date.now()
    return <div className="pd-days" data-discover-airing-schedule-container>
        {schedule.days.map(day => <PhoneSection key={day.key} id={`pd-day-${day.key}`} title={scheduleDayTitle(t, day.date, now, german)}
            count={day.items.length} data-discover-block="schedule-day" data-day={day.key} data-today={isToday(day.date) || undefined}>
            <div className="ps-list">
                {day.items.map(item => <ScheduleRow key={item.id} item={item} german={german} />)}
            </div>
        </PhoneSection>)}
        {schedule.loadingMore && <PhoneLoading label={t("Loading the later days", "Spätere Tage werden geladen")} layout={["head", "row", "row"]} />}
        {schedule.moreError && <PhoneNotice data-discover-schedule-more-error text={offlineAware(t,
            ["The later days couldn't be loaded.", "Die späteren Tage konnten nicht geladen werden."],
            ["No internet connection, so the later days couldn't be loaded.", "Keine Internetverbindung, deshalb konnten die späteren Tage nicht geladen werden."])}>
            {retry}
            {calendar}
        </PhoneNotice>}
        {schedule.moreOffline && <PhoneNotice data-discover-schedule-more-error text={t("No internet connection. The later days load when you're back online.",
            "Keine Internetverbindung. Die späteren Tage laden, sobald du wieder online bist.")}>{calendar}</PhoneNotice>}
    </div>
}

/** An episode: cover, title, "Episode 5" (with the list status when on a list), time; long press for Preview. */
const ScheduleRow = React.memo(function ScheduleRow({ item, german }: { item: Airing, german: boolean }) {
    const t = useTr()
    const media = item.media!
    const serverStatus = useServerStatus()
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    const status = listStatusLabel(t, "anime", useDiscoverEntry("anime", media.id).listData?.status)
    const title = media.title?.userPreferred || media.title?.romaji || media.title?.english || ""
    const offline = !!serverStatus?.isOffline
    return <SeaContextMenu content={<ContextMenuGroup>
        <ContextMenuLabel className="text-[--muted] line-clamp-1 py-0 my-2">{title}</ContextMenuLabel>
        {!offline && <ContextMenuItem onClick={() => setPreviewModalMediaId(media.id, "anime")}><LuEye /> {t("Preview", "Vorschau")}</ContextMenuItem>}
        <PluginMediaCardContextMenuItems for="anime" media={media} />
    </ContextMenuGroup>}>
        <ContextMenuTrigger asChild>
            <SeaLink href={offline ? `/offline/entry/anime?id=${media.id}` : `/entry?id=${media.id}`} className="ps-list-row" data-discover-schedule-row={item.id}
                data-media-id={media.id} data-media-mal-id={media.idMal ?? undefined} data-media-type="anime">
                <span className="ps-list-cover">
                    <SeaImage src={getImageUrl(media.coverImage?.large || media.coverImage?.medium || "")} alt="" fill sizes="3rem" className="ps-cover-image" />
                    {!!serverStatus?.settings?.anilist?.blurAdultContent && media.isAdult && <MediaEntryCardAdultVeil />}
                </span>
                <span className="ps-list-text">
                    <span className="ps-list-title">{title}</span>
                    <span className="ps-list-meta">
                        {t(`Episode ${item.episode}`, `Folge ${item.episode}`)}
                        {!!status && <> · <span className="pd-status">{status}</span></>}
                    </span>
                </span>
                <time className="ps-list-side" dateTime={new Date(item.airingAt * 1000).toISOString()}>{airingTimeLabel(item.airingAt, german)}</time>
            </SeaLink>
        </ContextMenuTrigger>
    </SeaContextMenu>
})
