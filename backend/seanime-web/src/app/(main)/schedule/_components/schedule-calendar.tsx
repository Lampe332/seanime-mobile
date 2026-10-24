import { AL_MediaListStatus, Anime_ScheduleItem } from "@/api/generated/types"
import { useGetAnimeCollectionSchedule } from "@/api/hooks/anime_collection.hooks"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { Modal } from "@/components/ui/modal"
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

const MAX_EVENT_COUNT = 4
export type StatusFilter = { value: AL_MediaListStatus, en: string, de: string }
const STATUS_FILTERS: StatusFilter[] = [
    { value: "CURRENT", en: "Watching", de: "Schaue ich" }, { value: "PLANNING", en: "Planning", de: "Geplant" },
    { value: "PAUSED", en: "Paused", de: "Pausiert" }, { value: "COMPLETED", en: "Completed", de: "Abgeschlossen" },
    { value: "DROPPED", en: "Dropped", de: "Abgebrochen" }, { value: "REPEATING", en: "Rewatching", de: "Schaue erneut" },
]
const calendarSourceAtom = atomWithStorage<"list" | "all">("sea-calendar-source", "list")

export const weekStartsOnAtom = atomWithStorage("sea-calendar-week-starts-on", 1)
const calendarDisableAnimations = atomWithStorage("sea-calendar-disable-animations", false)
const calendarParamsAtom = atomWithStorage("sea-release-calendar-params", {
    indicateWatchedEpisodes: true,
    listStatuses: ["PLANNING", "CURRENT", "COMPLETED", "PAUSED"] as AL_MediaListStatus[],
})

type ScheduleCalendarProps = {
    children?: React.ReactNode
    items?: Anime_ScheduleItem[]
}

export function ScheduleCalendar(props: ScheduleCalendarProps) {

    const {
        children,
        items,
        ...rest
    } = props

    const t = useTr()
    const anilistListData = useAtomValue(__anilist_userAnimeListDataAtom)

    // State for the current displayed month
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
    const [animationsDisabled, setAnimationDisabled] = useAtom(calendarDisableAnimations)

    const [weekStartsOn, setWeekStartsOn] = useAtom(weekStartsOnAtom)

    // Function to go to the previous month
    const goToPreviousMonth = () => {
        const next = startOfMonth(subMonths(currentDate, 1))
        setCurrentDate(next)
        setSelectedDate(format(next, "yyyy-MM-dd"))
    }

    // Function to go to the next month
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
        <>
            <div className="flex h-full min-w-0 flex-col rounded-2xl border border-gray-800 overflow-hidden" data-schedule-calendar aria-busy={!items && scheduleLoading}>
                {!items && <div className="p-3 sm:p-4 border-b border-gray-800 bg-gray-900/30 space-y-3" data-schedule-filters>
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/40 border border-gray-800" role="group" aria-label={t("Calendar source", "Kalenderquelle")}>
                        {([['list', t('My AniList', 'Meine AniList')], ['all', t('All anime', 'Alle Anime')]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={source === value} onClick={() => setSource(value)} className={cn("min-h-11 rounded-lg px-2 text-sm font-semibold transition-colors", source === value ? "bg-gray-700 text-white shadow-sm" : "text-gray-400 hover:text-white")} data-schedule-source={value}>{label}</button>)}
                    </div>
                    {!isAllAnime ? <>
                        <div className="flex items-center justify-between gap-2"><p className="text-xs text-gray-400">{t("Which AniList statuses to show?", "Welche AniList-Status anzeigen?")}</p><button type="button" className="min-h-11 px-2 text-xs font-semibold text-[--brand]" onClick={() => setCalendarParams(draft => { draft.listStatuses = STATUS_FILTERS.map(item => item.value) })}>{t("All statuses", "Alle Status")}</button></div>
                        <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("AniList status, multiple choice", "AniList-Status, Mehrfachauswahl")}>
                            {STATUS_FILTERS.map(({ value, en, de: label_de }) => <button key={value} type="button" aria-pressed={calendarParams.listStatuses.includes(value)} data-schedule-status={value} onClick={() => setCalendarParams(draft => { draft.listStatuses = draft.listStatuses.includes(value) ? draft.listStatuses.filter(status => status !== value) : [...draft.listStatuses, value] })} className={cn("min-h-11 min-w-0 break-words px-1 rounded-xl border text-[11px] font-semibold transition-colors", calendarParams.listStatuses.includes(value) ? "border-[--brand] bg-gray-800 text-[--brand]" : "border-gray-800 bg-gray-900/40 text-gray-400")}>{t(en, label_de)}</button>)}
                        </div>
                        {calendarParams.listStatuses.length === 0 && <p className="text-sm text-gray-400" data-schedule-no-status>{t("Pick at least one status.", "Wähle mindestens einen Status aus.")}</p>}
                    </> : <p className="text-xs leading-relaxed text-gray-400">{t("All episodes AniList knows for the selected day, regardless of your list. Tap a date to load the airing times.", "Alle bei AniList erfassten Folgen am gewählten Tag – unabhängig von deiner Liste. Datum antippen, um die Sendezeiten zu laden.")}</p>}
                </div>}
                <header
                    className="relative grid grid-cols-[auto_1fr_auto_auto] lg:flex items-center justify-center py-3 px-2 lg:py-4 lg:px-6 gap-1 lg:gap-4 flex-none rounded-tr-xl rounded-tl-xl border-b bg-[--background]"
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
                    <div className="hidden lg:block w-full"></div>
                    <h1
                        className={cn(
                            "text-base lg:text-lg font-semibold text-[--muted] text-center flex-1 min-w-0 lg:absolute lg:inset-0 z-[0] flex items-center justify-center pointer-events-none",
                            isSameMonth(currentDate, new Date()) && "text-gray-100",
                        )}
                        data-schedule-calendar-header-title
                    >
                        <time dateTime={format(currentDate, "yyyy-MM")} data-schedule-calendar-header-title-time>
                            <span className="hidden lg:inline">{format(currentDate, "MMMM yyyy")}</span>
                            <span className="lg:hidden">{format(currentDate, "MMM yyyy")}</span>
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
                            label="Week starts on" options={[
                            { label: "Monday", value: "1" },
                            { label: "Sunday", value: "0" },
                        ]} value={String(weekStartsOn)} onValueChange={v => setWeekStartsOn(Number(v))}
                            data-schedule-calendar-header-settings-popover-week-starts-on
                        />
                        <Separator />
                        <Switch
                            label="Indicate watched episodes"
                            side="right"
                            value={calendarParams.indicateWatchedEpisodes}
                            onValueChange={v => setCalendarParams(draft => {
                                draft.indicateWatchedEpisodes = v
                                return
                            })}
                            data-schedule-calendar-header-settings-popover-indicate-watched-episodes
                        />
                        <Separator />
                        <Switch
                            label="Disable image transitions"
                            side="right"
                            value={animationsDisabled}
                            onValueChange={v => setAnimationDisabled(v)}
                            data-schedule-calendar-header-settings-popover-disable-animations
                        />
                    </Popover>
                </header>
                {!items && scheduleLoading && <p className="p-3 text-sm text-[--muted]" role="status">{t("Loading episodes…", "Folgen werden geladen…")}</p>}
                {!items && scheduleError && <div className="p-3 text-sm" role="alert">
                    {t("Calendar could not be loaded.", "Kalender konnte nicht geladen werden.")}
                    <button type="button" onClick={() => refetch()} className="ml-2 min-h-11 underline">{t("Try again", "Erneut versuchen")}</button>
                </div>}
                <div
                    className="flex flex-auto flex-col rounded-br-xl rounded-bl-xl overflow-hidden"
                    data-schedule-calendar-body
                >
                    <div className={cn("grid-cols-7 gap-px border-b bg-[--background] text-center text-base font-semibold leading-6 text-gray-200 flex-none", isAllAnime ? "hidden" : "hidden lg:grid")}>
                        {weekStartsOn === 0 && <div className="py-2" data-schedule-calendar-day-name-sunday>
                            S<span className="sr-only sm:not-sr-only">un</span>
                        </div>}
                        <div className="py-2" data-schedule-calendar-day-name-monday>
                            M<span className="sr-only sm:not-sr-only">on</span>
                        </div>
                        <div className="py-2" data-schedule-calendar-day-name-tuesday>
                            T<span className="sr-only sm:not-sr-only">ue</span>
                        </div>
                        <div className="py-2" data-schedule-calendar-day-name-wednesday>
                            W<span className="sr-only sm:not-sr-only">ed</span>
                        </div>
                        <div className="py-2" data-schedule-calendar-day-name-thursday>
                            T<span className="sr-only sm:not-sr-only">hu</span>
                        </div>
                        <div className="py-2" data-schedule-calendar-day-name-friday>
                            F<span className="sr-only sm:not-sr-only">ri</span>
                        </div>
                        <div className="py-2" data-schedule-calendar-day-name-saturday>
                            S<span className="sr-only sm:not-sr-only">at</span>
                        </div>
                        {weekStartsOn === 1 && <div className="py-2" data-schedule-calendar-day-name-sunday>
                            S<span className="sr-only sm:not-sr-only">un</span>
                        </div>}
                    </div>

                    <div className={cn("bg-[--background]", !isAllAnime && "lg:hidden")} data-schedule-calendar-mobile>
                        <MobileMonthCalendar days={days} selectedDate={selectedDate} weekStartsOn={weekStartsOn} unavailable={scheduleLoading || scheduleError} allAnime={isAllAnime}
                            onSelect={date => { setSelectedDate(date); const selected = parseISO(date); if (!isSameMonth(selected, currentDate)) setCurrentDate(selected) }}
                            onToday={() => { const today = new Date(); setCurrentDate(today); setSelectedDate(format(today, "yyyy-MM-dd")) }} />
                    </div>

                    <div className={cn("bg-[--background] text-xs leading-6 text-gray-200 flex-auto", isAllAnime ? "hidden" : "hidden lg:flex")} data-schedule-calendar-desktop>
                        <div className="w-full grid grid-cols-7 grid-rows-6 gap-2 p-2" data-schedule-calendar-desktop-grid>
                            {days.map((day, index) => (
                                <CalendarDay
                                    key={index}
                                    day={day}
                                    index={index}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </>
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
    return (
        <SeaLink href={event.href} className="block" data-schedule-calendar-mobile-list-day-item-event-link>
            <div
                className="flex items-start gap-3 p-3 rounded-xl border border-gray-800 bg-gray-900/60 hover:bg-gray-800/70 transition-colors"
                data-schedule-calendar-mobile-list-day-item-event-content
            >
                <div
                    className="relative w-12 h-[4.5rem] lg:w-12 lg:h-16 rounded overflow-hidden flex-shrink-0"
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
                        <span className="font-medium" data-schedule-calendar-mobile-list-day-item-event-episode>Episode {event.episode}</span>
                        {event.time && <span>•</span>}
                        {event.time && <span data-schedule-calendar-mobile-list-day-item-event-time>{event.time}</span>}
                        {event.isSeasonFinale && <span>•</span>}
                        {event.isSeasonFinale && (
                            <span className="text-[--blue] font-medium" data-schedule-calendar-mobile-list-day-item-event-finale>Finale</span>
                        )}
                    </div>
                </div>
            </div>
        </SeaLink>
    )
}

interface CalendarDayModalProps {
    day: CalendarDayItem
    open: boolean
    onOpenChange: (open: boolean) => void
}

function CalendarDayModal({ day, open, onOpenChange }: CalendarDayModalProps) {
    const hasEvents = day.events.length > 0
    const calendarParams = useAtomValue(calendarParamsAtom)
    const localDay = parseISO(day.date)

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title={format(localDay, "EEEE, MMMM d, yyyy")}
            description={hasEvents
                ? `${day.events.length} scheduled episode${day.events.length !== 1 ? "s" : ""}`
                : "No scheduled episodes for this day"}
            contentClass="max-w-2xl gap-0 p-0 overflow-hidden"
            headerClass="px-5 pt-5 pb-3 pr-12"
            closeClass="right-5 top-5"
            data-schedule-calendar-day-modal
        >
            <div
                className="max-h-[70vh] overflow-y-auto px-5 pb-5"
                data-schedule-calendar-day-modal-content
            >
                {hasEvents ? (
                    <div className="space-y-3" data-schedule-calendar-day-modal-events>
                        {day.events.map(event => (
                            <MobileEventItem
                                key={event.id}
                                event={event}
                                calendarParams={calendarParams}
                            />
                        ))}
                    </div>
                ) : (
                    <div
                        className="rounded-lg border bg-[--paper] p-4 text-sm text-[--muted]"
                        data-schedule-calendar-day-modal-empty
                    >
                        No episodes are scheduled for this day.
                    </div>
                )}
            </div>
        </Modal>
    )
}

interface CalendarDayBackgroundProps {
    events: CalendarEvent[]
    isToday: boolean
    hoveredEventId: string | null
    onClick?: () => void
}

function CalendarDayBackground({ events, isToday, hoveredEventId, onClick }: CalendarDayBackgroundProps) {

    const [focusedEventIndex, setFocusedEventIndex] = React.useState<number | null>(null)
    const transitionDisabled = useAtomValue(calendarDisableAnimations)
    React.useEffect(() => {
        if (transitionDisabled) {
            setFocusedEventIndex(0)
            return
        }
        // carousel
        const interval = setInterval(() => {
            setFocusedEventIndex(prev => {
                if (prev === null) return 0
                if (prev === events.length - 1) return 0
                return prev + 1
            })
        }, 5000)
        return () => clearInterval(interval)
    }, [events, transitionDisabled])

    const displayedEvent = React.useMemo(() => {
        if (hoveredEventId) {
            const hoveredEvent = events.find(e => e.id === hoveredEventId)
            if (hoveredEvent) return hoveredEvent
        } else if (focusedEventIndex !== null && focusedEventIndex < events.length) {
            return events[focusedEventIndex]
        }
        return events[0]
    }, [hoveredEventId, events, focusedEventIndex])

    return (
        <>
            <div
                className={cn(
                    "absolute top-0 left-0 z-[0] w-full h-full overflow-hidden rounded-md transition-all duration-500 ease-out",
                    isToday ? "opacity-80" : "opacity-20 group-hover:opacity-30",
                )}
                data-schedule-calendar-day-background
            >
                <SeaImage
                    src={displayedEvent?.image || ""}
                    alt="banner"
                    fill
                    className="object-cover transition-all duration-500 ease-out transform"
                    key={displayedEvent?.id}
                    data-schedule-calendar-day-background-image
                />
            </div>
            <div
                className={cn(
                    "absolute cursor-pointer left-0 bottom-0 z-[1] w-full h-full bg-gradient-to-t from-gray-950/100 via-gray-950/80 via-40% to-transparent transition-all duration-300",
                    isToday && "from-gray-950/90 via-gray-950/80 via-40%",
                )}
                data-schedule-calendar-day-background-gradient
                onClick={onClick}
            />
        </>
    )
}

interface CalendarEventListProps {
    events: CalendarEvent[]
    onEventHover: (eventId: string | null) => void
}

function CalendarEventList({ events, onEventHover }: CalendarEventListProps) {
    const handleEventMouseEnter = (eventId: string) => {
        onEventHover(eventId)
    }

    const handleEventMouseLeave = () => {
        onEventHover(null)
    }

    const calendarParams = useAtomValue(calendarParamsAtom)

    return (
        <ol className="mt-1 sm:mt-2 relative z-[1] space-y-0.5 sm:space-y-1" data-schedule-calendar-event-list>
            {events.slice(0, MAX_EVENT_COUNT).map((event) => (
                <li
                    key={event.id}
                    onMouseEnter={() => handleEventMouseEnter(event.id)}
                    onMouseLeave={handleEventMouseLeave}
                    data-schedule-calendar-event-list-item
                >
                    <SeaLink className="group flex" href={event.href} data-schedule-calendar-event-item-link>
                        <div className="flex-auto truncate" data-schedule-calendar-event-item-content>
                            <p
                                className={cn(
                                    "truncate font-medium text-gray-100 flex items-center gap-1",
                                    "text-xs lg:text-sm",
                                    event.isWatched && calendarParams.indicateWatchedEpisodes ? "text-[--muted]" : "group-hover:text-gray-200",
                                )}
                                data-schedule-calendar-event-item-text
                            >
                                {event.isSeasonFinale && !event.isWatched &&
                                    <FaFlag
                                        className="size-2 lg:size-3 text-[--blue] flex-none group-hover:scale-[1.15] transition-transform duration-300"
                                        data-schedule-calendar-event-item-finale-icon
                                    />}
                                {event.isWatched && calendarParams.indicateWatchedEpisodes &&
                                    <FaCheck
                                        className="size-2 lg:size-3 text-[--muted] flex-none group-hover:scale-[1.15] transition-transform duration-300"
                                        data-schedule-calendar-event-item-watched-icon
                                    />}
                                <span className="truncate" data-schedule-calendar-event-item-name>
                                    {event.name}
                                </span>
                                {/*<span className="truncate hidden 2xl:inline-block" data-schedule-calendar-event-item-name>*/}
                                {/*    {event.name.length > 40 ? event.name.slice(0, 37) + "..." : event.name}*/}
                                {/*</span>*/}
                            </p>
                            <p className="text-xs text-[--muted] lg:hidden" data-schedule-calendar-event-item-episode>
                                Ep. {event.episode}
                                {event.time && <span className="ml-1" data-schedule-calendar-event-item-time>• {event.time}</span>}
                            </p>
                        </div>
                        <time
                            dateTime={event.datetime}
                            className="ml-3 hidden flex-none text-[--muted] group-hover:text-gray-200 lg:flex items-center"
                            data-schedule-calendar-event-item-episode-time
                        >
                            <span className="mr-1 text-sm group-hover:text-[--foreground] font-semibold" data-schedule-calendar-event-item-episode>
                                Ep. {event.episode}
                            </span>
                        </time>
                    </SeaLink>
                </li>
            ))}
            {events.length > MAX_EVENT_COUNT && (
                <Popover
                    className="w-[280px] lg:w-full max-w-sm lg:max-w-sm"
                    trigger={
                        <li className="text-[--muted] cursor-pointer text-sm lg:text-[0.7rem] py-1 pt-0">+ {events.length - MAX_EVENT_COUNT} more</li>
                    }
                    data-schedule-calendar-event-list-more-popover
                >
                    <ol className="text-sm max-w-full block space-y-2" data-schedule-calendar-event-list-more>
                        {events.slice(MAX_EVENT_COUNT).map((event) => (
                            <li key={event.id} data-schedule-calendar-event-list-item-more>
                                <SeaLink className="group flex gap-2" href={event.href} data-schedule-calendar-event-list-item-more-link>
                                    <p
                                        className={cn("flex-auto truncate font-medium text-gray-100 flex items-center gap-2",
                                            event.isWatched && calendarParams.indicateWatchedEpisodes
                                                ? "text-[--muted]"
                                                : "group-hover:text-gray-200")}
                                        data-schedule-calendar-event-list-item-more-text
                                    >
                                        {event.isSeasonFinale && !event.isWatched &&
                                            <FaFlag className="size-3 text-[--blue] flex-none group-hover:scale-[1.15] transition-transform duration-300" />}
                                        {event.isWatched && calendarParams.indicateWatchedEpisodes &&
                                            <FaCheck className="size-3 text-[--muted] flex-none group-hover:scale-[1.15] transition-transform duration-300" />}
                                        {event.name}
                                    </p>
                                    <p className="flex-none" data-schedule-calendar-event-list-item-more-episode>
                                        Ep. {event.episode}
                                    </p>
                                    <time
                                        dateTime={event.datetime}
                                        className="ml-3 hidden flex-none text-[--muted] group-hover:text-gray-200 xl:block"
                                        data-schedule-calendar-event-list-item-more-time
                                    >
                                        {event.time}
                                    </time>
                                </SeaLink>
                            </li>
                        ))}
                    </ol>
                </Popover>
            )}
        </ol>
    )
}

function CalendarDay({ day, index }: { day: CalendarDayItem, index: number }) {
    const [hoveredEventId, setHoveredEventId] = React.useState<string | null>(null)
    const [modalOpen, setModalOpen] = React.useState(false)

    const hoveredEvent = React.useMemo(() => {
        if (hoveredEventId) {
            return day.events.find((e: CalendarEvent) => e.id === hoveredEventId)
        }
        return null
    }, [hoveredEventId, day.events])

    return (
        <div
            key={index}
            className={cn(
                day.isCurrentMonth ? "bg-[--background]" : "opacity-20",
                "relative py-1 px-1 sm:py-2 sm:px-3 h-24 sm:h-32 lg:h-40 rounded-md",
                "flex flex-col justify-between group",
            )}
            data-schedule-calendar-day-item
            data-schedule-calendar-day-index={index}
        >
            {day.events[0] && (
                <CalendarDayBackground
                    events={day.events}
                    isToday={day.isToday}
                    hoveredEventId={hoveredEventId}
                    onClick={() => setModalOpen(true)}
                />
            )}

            <div className="absolute -top-2 left-10 right-1 z-[5] pointer-events-none hidden lg:block">
                <div
                    className={cn(
                        "transition-all duration-300 ease-out",
                        hoveredEvent ? "opacity-100 transform translate-y-0" : "opacity-0 transform -translate-y-2",
                    )}
                    data-schedule-calendar-day-hovered-event
                >
                    {hoveredEvent && (
                        <div
                            className="bg-gray-900/70 backdrop-blur-sm rounded-md px-2 py-1.5 border"
                            data-schedule-calendar-day-hovered-event-content
                        >
                            <p className="text-xs font-medium text-gray-100 line-clamp-2 leading-tight" data-schedule-calendar-day-hovered-event-text>
                                <span
                                    className="text-[--muted] font-normal"
                                    data-schedule-calendar-day-hovered-event-text-name
                                >{hoveredEvent.name.slice(0, 28) + (hoveredEvent.name.length > 28
                                    ? "..."
                                    : "")}</span>
                                {hoveredEvent.isSeasonFinale &&
                                    <span className="text-[--blue] ml-1" data-schedule-calendar-day-hovered-event-text-finale>Finale</span>}
                                <span className="ml-1" data-schedule-calendar-day-hovered-event-text-episode> Ep. {hoveredEvent.episode}</span>
                                {hoveredEvent.time &&
                                    <span className="ml-1" data-schedule-calendar-day-hovered-event-text-time>- {hoveredEvent.time}</span>}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <time
                dateTime={day.date}
                className={
                    day.isToday
                        ? "z-[1] relative flex h-5 w-5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 text-sm sm:text-base lg:text-lg items-center justify-center rounded-full bg-white font-bold group-hover:rotate-12 transition-transform duration-300 ease-out text-black"
                        : "text-xs sm:text-sm lg:text-base group-hover:text-white group-hover:font-bold transition-transform duration-300 ease-out"
                }
                data-schedule-calendar-day-date
            >
                {day.date.split("-")?.pop()?.replace(/^0/, "")}
            </time>

            <CalendarDayModal
                day={day}
                open={modalOpen}
                onOpenChange={setModalOpen}
            />
            {day.events.length > 0 && (
                <CalendarEventList
                    events={day.events}
                    onEventHover={setHoveredEventId}
                />
            )}
        </div>
    )
}
