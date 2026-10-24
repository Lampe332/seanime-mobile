import { AL_MediaListStatus, Anime_ScheduleItem } from "@/api/generated/types"
import { useGetAnimeCollectionSchedule } from "@/api/hooks/anime_collection.hooks"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { Popover } from "@/components/ui/popover"
import { RadioGroup } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { addMonths, Day, endOfMonth, endOfWeek, format, isSameMonth, isToday, parseISO, startOfMonth, startOfWeek, subMonths } from "date-fns"
import { addDays } from "date-fns/addDays"
import { de } from "date-fns/locale"
import { useTr } from "@/lib/app-language"
import { useGlobalScheduleDay } from "../_lib/use-global-schedule"
import { useImmerAtom } from "jotai-immer"
import { useAtom, useAtomValue } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import sortBy from "lodash/sortBy"
import React from "react"
import { AiOutlineArrowLeft, AiOutlineArrowRight } from "react-icons/ai"
import { BiCog } from "react-icons/bi"
import { FaCheck, FaFlag } from "react-icons/fa6"
import { __anilist_userAnimeListDataAtom } from "../../_atoms/anilist.atoms"
import { PhoneSchedule } from "./schedule-phone"

type CalendarParams = {
    indicateWatchedEpisodes: boolean
    listStatuses: AL_MediaListStatus[]
}

export type StatusFilter = { value: AL_MediaListStatus, en: string, de: string }
const STATUS_FILTERS: StatusFilter[] = [
    { value: "CURRENT", en: "Watching", de: "Schaue ich" }, { value: "PLANNING", en: "Planning", de: "Geplant" },
    { value: "PAUSED", en: "Paused", de: "Pausiert" }, { value: "COMPLETED", en: "Completed", de: "Abgeschlossen" },
    { value: "DROPPED", en: "Dropped", de: "Abgebrochen" }, { value: "REPEATING", en: "Rewatching", de: "Schaue erneut" },
]
const calendarSourceAtom = atomWithStorage<"list" | "all">("sea-calendar-source", "list")

export const weekStartsOnAtom = atomWithStorage("sea-calendar-week-starts-on", 1)
const calendarParamsAtom = atomWithStorage("sea-release-calendar-params", {
    indicateWatchedEpisodes: true,
    listStatuses: ["PLANNING", "CURRENT", "COMPLETED", "PAUSED"] as AL_MediaListStatus[],
})

/** Without `items` it is the schedule page (phone screen); with `items` the home screen's month view of those items. */
export function ScheduleCalendar({ items }: { items?: Anime_ScheduleItem[] }) {
    const t = useTr()
    const anilistListData = useAtomValue(__anilist_userAnimeListDataAtom)

    const [currentDate, setCurrentDate] = React.useState(new Date())
    const [selectedDate, setSelectedDate] = React.useState(() => format(new Date(), "yyyy-MM-dd"))
    const [source, setSource] = useAtom(calendarSourceAtom)
    const isAllAnime = !items && source === "all"
    const personalQuery = useGetAnimeCollectionSchedule({ enabled: !items && !isAllAnime })
    const globalQuery = useGlobalScheduleDay(selectedDate, isAllAnime)
    const schedule = items ?? (isAllAnime ? globalQuery.data : personalQuery.data)
    const scheduleLoading = !items && (isAllAnime ? globalQuery.isLoading : personalQuery.isLoading)
    const scheduleError = !items && (isAllAnime ? globalQuery.isError : personalQuery.isError)
    const refetch = () => isAllAnime ? globalQuery.refetch() : personalQuery.refetch()
    const isUserSchedule = !items && !isAllAnime

    const [calendarParams, setCalendarParams] = useImmerAtom(calendarParamsAtom)

    const [weekStartsOn, setWeekStartsOn] = useAtom(weekStartsOnAtom)

    const goToPreviousMonth = () => {
        const next = startOfMonth(subMonths(currentDate, 1))
        setCurrentDate(next)
        setSelectedDate(format(next, "yyyy-MM-dd"))
    }

    const goToNextMonth = () => {
        const next = startOfMonth(addMonths(currentDate, 1))
        setCurrentDate(next)
        setSelectedDate(format(next, "yyyy-MM-dd"))
    }

    const isSameLocalDay = (dateLeft: Date, dateRight: Date) => {
        return (
            dateLeft.getFullYear() === dateRight.getFullYear() &&
            dateLeft.getMonth() === dateRight.getMonth() &&
            dateLeft.getDate() === dateRight.getDate()
        )
    }

    function isStatusIncluded(mediaId: number) {
        if (!isUserSchedule) return true
        const entry = anilistListData[String(mediaId)]
        if (!entry || !entry.status) return false
        return calendarParams.listStatuses.includes(entry.status)
    }

    function isEpisodeWatched(mediaId: number, episodeNumber: number) {
        const entry = anilistListData[String(mediaId)]
        if (!entry || !entry.progress) return false
        return entry.progress >= episodeNumber
    }

    const eventsOn = React.useCallback((day: Date): CalendarEvent[] => {
        let events = schedule?.filter(item => isSameLocalDay(new Date(item.dateTime!), day) && isStatusIncluded(item.mediaId))?.map(item => {
            return {
                id: String(item.mediaId) + "-" + String(item.episodeNumber) + "-" + String(item.dateTime),
                name: item.title,
                time: format(new Date(item.dateTime!), "HH:mm"),
                datetime: item.dateTime!,
                href: `/entry?id=${item.mediaId}`,
                image: item.image,
                episode: item.episodeNumber || 1,
                isSeasonFinale: item.isSeasonFinale && !item.isMovie,
                isMovie: item.isMovie,
                isWatched: isEpisodeWatched(item.mediaId, item.episodeNumber),
            }
        }) ?? []
        events = sortBy(events, (e) => e.episode)
        return sortBy(events, (e) => e.datetime)
    }, [schedule, calendarParams, anilistListData, isUserSchedule])

    const days = React.useMemo(() => {
        const startOfCurrentMonth = startOfMonth(currentDate)
        const endOfCurrentMonth = endOfMonth(currentDate)

        const startOfCalendar = startOfWeek(startOfCurrentMonth, { weekStartsOn: weekStartsOn as Day })
        const endOfCalendar = endOfWeek(endOfCurrentMonth, { weekStartsOn: weekStartsOn as Day })

        const daysArray = []
        let day = startOfCalendar

        while (day <= endOfCalendar) {
            daysArray.push({
                date: format(day, "yyyy-MM-dd"),
                isCurrentMonth: isSameMonth(day, currentDate),
                isToday: isToday(day),
                isSelected: false,
                events: eventsOn(day),
            })
            day = addDays(day, 1)
        }
        return daysArray
    }, [currentDate, weekStartsOn, eventsOn])

    if (!items) return <PhoneSchedule
        days={days} eventsOn={eventsOn} isAllAnime={isAllAnime} source={source} onSource={setSource}
        statuses={calendarParams.listStatuses} onStatuses={next => setCalendarParams(draft => { draft.listStatuses = next })}
        statusFilters={STATUS_FILTERS} indicateWatched={calendarParams.indicateWatchedEpisodes}
        onIndicateWatched={v => setCalendarParams(draft => { draft.indicateWatchedEpisodes = v })}
        weekStartsOn={weekStartsOn} onWeekStartsOn={setWeekStartsOn}
        currentDate={currentDate} onMonth={setCurrentDate} selectedDate={selectedDate} onSelectDate={setSelectedDate}
        loading={!!scheduleLoading} error={!!scheduleError} onRetry={refetch}
    />

    return (
        <div className="flex h-full min-w-0 flex-col rounded-2xl border border-gray-800 overflow-hidden" data-schedule-calendar aria-busy={!items && scheduleLoading}>
            <header
                className="relative grid grid-cols-[auto_1fr_auto_auto] items-center justify-center py-3 px-2 gap-1 flex-none rounded-tr-xl rounded-tl-xl border-b bg-[--background]"
                data-schedule-calendar-header
            >
                <IconButton
                    icon={<AiOutlineArrowLeft />}
                    onClick={goToPreviousMonth}
                    rounded
                    intent="gray-outline"
                    size="sm"
                    aria-label={t("Previous month", "Vorheriger Monat")}
                    className="min-w-11 min-h-11"
                    data-schedule-calendar-header-button-previous
                />
                <h1
                    className={cn(
                        "text-base font-semibold text-[--muted] text-center flex-1 min-w-0",
                        isSameMonth(currentDate, new Date()) && "text-gray-100",
                    )}
                    data-schedule-calendar-header-title
                >
                    <time dateTime={format(currentDate, "yyyy-MM")} data-schedule-calendar-header-title-time>
                        {format(currentDate, "MMM yyyy")}
                    </time>
                </h1>
                <IconButton
                    icon={<AiOutlineArrowRight />}
                    onClick={goToNextMonth}
                    rounded
                    intent="gray-outline"
                    size="sm"
                    aria-label={t("Next month", "Nächster Monat")}
                    className="min-w-11 min-h-11"
                    data-schedule-calendar-header-button-next
                />

                <Popover
                    trigger={<IconButton icon={<BiCog />} intent="gray-basic" size="sm" aria-label={t("Calendar settings", "Kalender-Einstellungen")} className="min-w-11 min-h-11" data-schedule-calendar-header-button-settings />}
                    className="w-[min(400px,calc(100vw-24px))] space-y-2"
                    data-schedule-calendar-header-settings-popover
                >
                    <RadioGroup
                        label={t("Week starts on", "Woche beginnt am")}
                        options={[
                            { label: t("Monday", "Montag"), value: "1" },
                            { label: t("Sunday", "Sonntag"), value: "0" },
                        ]}
                        value={String(weekStartsOn)}
                        onValueChange={v => setWeekStartsOn(Number(v))}
                        data-schedule-calendar-header-settings-popover-week-starts-on
                    />
                    <Separator />
                    <Switch
                        label={t("Indicate watched episodes", "Gesehene Folgen markieren")}
                        side="right"
                        value={calendarParams.indicateWatchedEpisodes}
                        onValueChange={v => setCalendarParams(draft => { draft.indicateWatchedEpisodes = v })}
                        data-schedule-calendar-header-settings-popover-indicate-watched-episodes
                    />
                </Popover>
            </header>
            <div className="bg-[--background]" data-schedule-calendar-mobile>
                <MobileMonthCalendar days={days} selectedDate={selectedDate} weekStartsOn={weekStartsOn} unavailable={scheduleLoading || scheduleError} allAnime={isAllAnime}
                    onSelect={date => { setSelectedDate(date); const selected = parseISO(date); if (!isSameMonth(selected, currentDate)) setCurrentDate(selected) }}
                    onToday={() => { const today = new Date(); setCurrentDate(today); setSelectedDate(format(today, "yyyy-MM-dd")) }} />
            </div>
        </div>
    )
}

export type CalendarEvent = {
    id: string
    name: string
    time: string
    datetime: string
    href: string
    image: string
    episode: number
    isSeasonFinale: boolean
    isMovie: boolean
    isWatched: boolean
}

export type CalendarDayItem = {
    date: string
    isCurrentMonth: boolean
    isToday: boolean
    isSelected: boolean
    events: CalendarEvent[]
}

function MobileMonthCalendar({ days, selectedDate, weekStartsOn, unavailable, allAnime, onSelect, onToday }: {
    days: CalendarDayItem[]
    selectedDate: string
    weekStartsOn: number
    unavailable: boolean
    allAnime: boolean
    onSelect: (date: string) => void
    onToday: () => void
}) {
    const t = useTr()
    const calendarParams = useAtomValue(calendarParamsAtom)
    const selected = days.find(day => day.date === selectedDate) ?? days.find(day => day.isCurrentMonth)!
    const week = t("Mo Tu We Th Fr Sa Su", "Mo Di Mi Do Fr Sa So").split(" ")
    const labels = weekStartsOn === 0 ? [week[6], ...week.slice(0, 6)] : week
    const monthEvents = days.filter(day => day.isCurrentMonth).reduce((n, day) => n + day.events.length, 0)

    return <div data-schedule-mobile-month>
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-[--muted]">
            <span>{allAnime ? t("All anime · day view", "Alle Anime · Tagesansicht") : unavailable ? t("Release calendar", "Veröffentlichungskalender") : t(`${monthEvents} ${monthEvents === 1 ? "episode" : "episodes"} from your selection`, `${monthEvents} ${monthEvents === 1 ? "Folge" : "Folgen"} aus deiner Auswahl`)}</span>
            <button type="button" onClick={onToday} className="min-h-11 px-3 rounded-lg border text-sm text-gray-100 hover:bg-gray-800" data-schedule-today>{t("Today", "Heute")}</button>
        </div>
        <div className="grid grid-cols-7 text-center text-xs text-[--muted]" aria-hidden="true">
            {labels.map(label => <div key={label} className="py-2">{label}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1 px-2 pb-3" role="group" aria-label={t("Days of the month", "Tage im Monat")} data-schedule-mobile-grid>
            {days.map(day => <button key={day.date} type="button"
                aria-label={`${format(parseISO(day.date), "dd.MM.yyyy")}, ${allAnime && day.date !== selectedDate ? t("tap to load", "durch Antippen laden") : `${day.events.length} ${t("episodes", "Folgen")}`}${day.isToday ? t(", today", ", heute") : ""}`}
                aria-pressed={day.date === selected.date} aria-current={day.isToday ? "date" : undefined}
                data-schedule-date={day.date} data-event-count={day.events.length}
                onClick={() => onSelect(day.date)}
                className={cn("relative min-w-0 min-h-12 rounded-xl border flex flex-col items-center justify-center gap-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[--brand]",
                    day.date === selected.date ? "bg-[--brand] border-[--brand] text-black shadow-sm" : day.events.length > 0 ? "border-gray-700 bg-gray-800/50 text-gray-100 hover:bg-gray-800" : "border-transparent text-gray-400 hover:bg-gray-900",
                    !day.isCurrentMonth && "opacity-40",
                    day.isToday && day.date !== selected.date && "border-[--brand] text-[--brand] font-bold")}>
                <span>{Number(day.date.slice(-2))}</span>
                <span className={cn("text-[11px] leading-3 min-h-3", day.date === selected.date ? "text-black/80" : "text-gray-300")}>
                    {day.events.length > 0 ? <><span aria-hidden="true" className={day.date === selected.date ? "text-black/80" : "text-[--brand]"}>● </span>{day.events.length}</> : ""}
                </span>
            </button>)}
        </div>
        <section className="border-t border-gray-800 bg-gray-900/20 p-3 sm:p-4 space-y-3" aria-live="polite" aria-atomic="false" data-schedule-selected-day>
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold" data-schedule-selected-date>{t(format(parseISO(selected.date), "EEEE, MMMM d"), format(parseISO(selected.date), "EEEE, d. MMMM", { locale: de }))}{selected.isToday ? t(" · Today", " · Heute") : ""}</h3>
                <span className="shrink-0 rounded-full border border-gray-800 px-2 py-1 text-xs text-gray-300">{unavailable ? "…" : selected.events.length} {selected.events.length === 1 ? t("episode", "Folge") : t("episodes", "Folgen")}</span>
            </div>
            {selected.events.length > 0 ? selected.events.map(event => <MobileEventItem key={event.id} event={event} calendarParams={calendarParams} />)
                : !unavailable && <p className="text-sm text-[--muted] py-4" data-schedule-empty-day>{t("No releases for this selection on this day.", "Keine Veröffentlichungen für diese Auswahl an diesem Tag.")}</p>}
        </section>
    </div>
}

interface MobileEventItemProps {
    event: CalendarEvent
    calendarParams: CalendarParams
}

function MobileEventItem({ event, calendarParams }: MobileEventItemProps) {
    const t = useTr()
    return (
        <SeaLink href={event.href} className="block" data-schedule-calendar-mobile-list-day-item-event-link>
            <div
                className="flex items-start gap-3 p-3 rounded-xl border border-gray-800 bg-gray-900/60 hover:bg-gray-800/70 transition-colors"
                data-schedule-calendar-mobile-list-day-item-event-content
            >
                <div
                    className="relative w-12 h-[4.5rem] rounded overflow-hidden flex-shrink-0"
                    data-schedule-calendar-mobile-list-day-item-event-image-container
                >
                    <SeaImage
                        src={event.image || ""}
                        alt={event.name}
                        fill
                        className="object-cover"
                        data-schedule-calendar-mobile-list-day-item-event-image
                    />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2" data-schedule-calendar-mobile-list-day-item-event-header>
                        <p
                            className={cn(
                                "font-semibold text-sm leading-snug text-gray-100 line-clamp-2",
                                event.isWatched && calendarParams.indicateWatchedEpisodes && "text-[--muted]",
                            )}
                            data-schedule-calendar-mobile-list-day-item-event-text
                        >
                            {event.name}
                        </p>
                        <div className="flex items-center gap-1 flex-shrink-0" data-schedule-calendar-mobile-list-day-item-event-icons>
                            {event.isSeasonFinale && !event.isWatched && (
                                <FaFlag className="size-3 text-[--blue]" data-schedule-calendar-mobile-list-day-item-event-finale-icon />
                            )}
                            {event.isWatched && calendarParams.indicateWatchedEpisodes && (
                                <FaCheck className="size-3 text-[--muted]" data-schedule-calendar-mobile-list-day-item-event-watched-icon />
                            )}
                        </div>
                    </div>

                    <div
                        className="flex flex-wrap items-center gap-2 mt-2 text-xs text-[--muted]"
                        data-schedule-calendar-mobile-list-day-item-event-episode-time
                    >
                        <span className="font-medium" data-schedule-calendar-mobile-list-day-item-event-episode>{t("Episode", "Folge")} {event.episode}</span>
                        {event.time && <span>•</span>}
                        {event.time && <span data-schedule-calendar-mobile-list-day-item-event-time>{event.time}</span>}
                        {event.isSeasonFinale && <span>•</span>}
                        {event.isSeasonFinale && (
                            <span className="text-[--blue] font-medium" data-schedule-calendar-mobile-list-day-item-event-finale>{t("Finale", "Finale")}</span>
                        )}
                    </div>
                </div>
            </div>
        </SeaLink>
    )
}
