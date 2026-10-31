import { AL_MediaListStatus } from "@/api/generated/types"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { cn } from "@/components/ui/core/styling"
import { Modal } from "@/components/ui/modal"
import { appLanguageAtom, useTr } from "@/lib/app-language"
import { addDays, addMonths, format, isSameMonth, isToday, isTomorrow, type Locale, parseISO, startOfDay, startOfMonth, subMonths } from "date-fns"
import { de } from "date-fns/locale"
import { useAtom, useAtomValue } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import React from "react"
import { LuCheck, LuChevronLeft, LuChevronRight, LuSlidersHorizontal } from "react-icons/lu"
import { useGlobalScheduleCounts } from "../_lib/use-global-schedule"
import type { CalendarDayItem, CalendarEvent, StatusFilter } from "./schedule-calendar"
import "@/components/shared/mobile-surface.css"
import "./schedule-phone.css"

const phoneViewAtom = atomWithStorage<"week" | "month">("sea-calendar-phone-view", "week")

type PhoneScheduleProps = {
    days: CalendarDayItem[]
    eventsOn: (day: Date) => CalendarEvent[]
    isAllAnime: boolean
    source: "list" | "all"
    onSource: (source: "list" | "all") => void
    statuses: AL_MediaListStatus[]
    onStatuses: (statuses: AL_MediaListStatus[]) => void
    statusFilters: StatusFilter[]
    indicateWatched: boolean
    onIndicateWatched: (value: boolean) => void
    weekStartsOn: number
    onWeekStartsOn: (value: number) => void
    currentDate: Date
    onMonth: (date: Date) => void
    selectedDate: string
    onSelectDate: (date: string) => void
    loading: boolean
    error: boolean
    onRetry: () => void
}

/** Android phone calendar: the next seven days as an agenda, or the month grid; filters live in a sheet. */
export function PhoneSchedule(props: PhoneScheduleProps) {
    const { days, eventsOn, isAllAnime, statuses, statusFilters, currentDate, selectedDate, loading, error } = props
    const t = useTr()
    const german = useAtomValue(appLanguageAtom) === "de"
    const locale = german ? { locale: de } : undefined
    const [view, setView] = useAtom(phoneViewAtom)
    const [weekOffset, setWeekOffset] = React.useState(0)
    const [filtersOpen, setFiltersOpen] = React.useState(false)

    const firstDay = addDays(startOfDay(new Date()), weekOffset * 7)
    const week = Array.from({ length: 7 }, (_, i) => addDays(firstDay, i))
    // All anime loads one day at a time; the grid and the strip get their per-day counts from one range query
    const gridStart = parseISO(days[0].date)
    const countsRange = view === "month" ? [gridStart, addDays(parseISO(days[days.length - 1].date), 1)] : [firstDay, addDays(firstDay, 7)]
    const { data: allCounts, isLoading: countsLoading } = useGlobalScheduleCounts(countsRange[0], countsRange[1], isAllAnime)
    const countIn = (dates: string[]) => dates.reduce((n, date) => n + (allCounts?.[date] ?? 0), 0)
    const weekEvents = isAllAnime ? [] : week.map(day => ({ day, events: eventsOn(day) }))
    const weekCount = weekEvents.reduce((n, d) => n + d.events.length, 0)
    const monthCount = days.filter(d => d.isCurrentMonth).reduce((n, d) => n + d.events.length, 0)

    const episodes = (n: number) => `${n} ${n === 1 ? t("episode", "Folge") : t("episodes", "Folgen")}`
    const dayTitle = (day: Date) => isToday(day) ? t("Today", "Heute") : isTomorrow(day) ? t("Tomorrow", "Morgen")
        : format(day, german ? "EEEE, d. MMMM" : "EEEE, MMMM d", locale)
    const range = `${format(week[0], german ? "d. MMM" : "MMM d", locale)} – ${format(week[6], german ? "d. MMM" : "MMM d", locale)}`

    const weekLabel = weekOffset === 0 ? t("next 7 days", "nächste 7 Tage") : range
    const facts = isAllAnime
        ? countsLoading ? t("Counting episodes on AniList…", "Folgen auf AniList werden gezählt …")
            : !allCounts ? t("All anime on AniList", "Alle Anime auf AniList")
                : view === "week" ? `${episodes(countIn(week.map(d => format(d, "yyyy-MM-dd"))))} · ${weekLabel}`
                    : `${episodes(countIn(days.filter(d => d.isCurrentMonth).map(d => d.date)))} · ${format(currentDate, "MMMM", locale)}`
        : loading ? t("Loading…", "Lädt …")
            : view === "week" ? `${episodes(weekCount)} · ${weekLabel}`
                : `${episodes(monthCount)} · ${format(currentDate, "MMMM", locale)}`

    const statusSummary = isAllAnime ? t("All anime, regardless of your list", "Alle Anime, unabhängig von deiner Liste")
        : statuses.length === statusFilters.length ? t("All statuses", "Alle Status")
            : statuses.length === 0 ? t("No status selected", "Kein Status gewählt")
                : statusFilters.filter(f => statuses.includes(f.value)).map(f => t(f.en, f.de)).join(", ")

    const selectDay = (date: string) => {
        props.onSelectDate(date)
        const selected = parseISO(date)
        if (!isSameMonth(selected, currentDate)) props.onMonth(selected)
    }
    const goMonth = (next: Date) => {
        props.onMonth(next)
        props.onSelectDate(format(next, "yyyy-MM-dd"))
    }
    const toToday = () => {
        setWeekOffset(0)
        props.onMonth(new Date())
        props.onSelectDate(format(new Date(), "yyyy-MM-dd"))
    }

    const selected = days.find(d => d.date === selectedDate) ?? days.find(d => d.isToday && d.isCurrentMonth) ?? days.find(d => d.isCurrentMonth)!
    const status = error ? <div className="msc-note" role="alert">
            <p>{t("The calendar could not be loaded.", "Der Kalender konnte nicht geladen werden.")}</p>
            <button type="button" className="msc-text-action" onClick={props.onRetry}>{t("Try again", "Erneut versuchen")}</button>
        </div>
        : loading ? <p className="msc-note" role="status">{t("Loading episodes…", "Folgen werden geladen …")}</p> : null

    return <div className="msc" data-mobile-schedule>
        <header className="msc-header">
            <h1>{t("Schedule", "Sendeplan")}</h1>
            <p>{facts}</p>
        </header>

        <button type="button" className="msc-filter" onClick={() => setFiltersOpen(true)} data-schedule-filter-button>
            <span className="msc-filter-text">
                <span className="msc-filter-title">{isAllAnime ? t("All anime", "Alle Anime") : t("My AniList", "Meine AniList")}</span>
                <span className="msc-filter-meta">{statusSummary}</span>
            </span>
            <LuSlidersHorizontal aria-hidden className="msc-filter-icon" />
            <span className="sr-only">{t("Change filter", "Filter ändern")}</span>
        </button>

        <div className="msc-tabs" role="tablist" aria-label={t("Calendar view", "Kalenderansicht")}>
            {([["week", t("Week", "Woche")], ["month", t("Month", "Monat")]] as const).map(([value, label]) =>
                <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => setView(value)} data-schedule-view={value}>{label}</button>)}
        </div>

        {view === "week" && <section className="msc-section" aria-label={t("Week", "Woche")}>
            <div className="msc-nav">
                <button type="button" className="msc-icon-button" aria-label={t("Previous 7 days", "Vorherige 7 Tage")} onClick={() => setWeekOffset(o => o - 1)}><LuChevronLeft aria-hidden /></button>
                <h2>{weekOffset === 0 ? t("Next 7 days", "Nächste 7 Tage") : range}</h2>
                <button type="button" className="msc-icon-button" aria-label={t("Next 7 days", "Nächste 7 Tage")} onClick={() => setWeekOffset(o => o + 1)}><LuChevronRight aria-hidden /></button>
                {weekOffset !== 0 && <button type="button" className="msc-text-action" onClick={toToday}>{t("Today", "Heute")}</button>}
            </div>

            {isAllAnime ? <>
                <DayStrip week={week} selectedDate={selectedDate} onSelect={props.onSelectDate} locale={locale} counts={allCounts} />
                {status ?? <DayList title={dayTitle(parseISO(selectedDate))} events={eventsOn(parseISO(selectedDate))}
                    indicateWatched={props.indicateWatched} episodes={episodes} />}
            </> : status ?? (weekCount === 0
                ? <p className="msc-note">{t("No episodes from your list in these 7 days.", "In diesen 7 Tagen keine Folgen aus deiner Liste.")}</p>
                : weekEvents.filter(d => d.events.length > 0).map(d =>
                    <DayList key={d.day.toISOString()} title={dayTitle(d.day)} today={isToday(d.day)} events={d.events}
                        indicateWatched={props.indicateWatched} episodes={episodes} />))}
        </section>}

        {view === "month" && <section className="msc-section" aria-label={t("Month", "Monat")}>
            <div className="msc-nav">
                <button type="button" className="msc-icon-button" aria-label={t("Previous month", "Vorheriger Monat")} onClick={() => goMonth(startOfMonth(subMonths(currentDate, 1)))}><LuChevronLeft aria-hidden /></button>
                <h2><time dateTime={format(currentDate, "yyyy-MM")}>{format(currentDate, "MMMM yyyy", locale)}</time></h2>
                <button type="button" className="msc-icon-button" aria-label={t("Next month", "Nächster Monat")} onClick={() => goMonth(startOfMonth(addMonths(currentDate, 1)))}><LuChevronRight aria-hidden /></button>
                {!isSameMonth(currentDate, new Date()) && <button type="button" className="msc-text-action" onClick={toToday}>{t("Today", "Heute")}</button>}
            </div>
            <MonthGrid days={days} selected={selected.date} weekStartsOn={props.weekStartsOn} counts={isAllAnime ? allCounts ?? {} : undefined} onSelect={selectDay} />
            {status ?? <DayList title={dayTitle(parseISO(selected.date))} today={selected.isToday} events={selected.events}
                indicateWatched={props.indicateWatched} episodes={episodes} showEmpty />}
        </section>}

        <FilterSheet {...props} open={filtersOpen} onOpenChange={setFiltersOpen} />
    </div>
}

function DayStrip({ week, selectedDate, onSelect, locale, counts }: { week: Date[], selectedDate: string, onSelect: (date: string) => void, locale?: { locale: Locale }, counts?: Record<string, number> }) {
    return <div className="msc-strip" role="group">
        {week.map(day => {
            const date = format(day, "yyyy-MM-dd")
            return <button key={date} type="button" aria-pressed={date === selectedDate} aria-current={isToday(day) ? "date" : undefined} onClick={() => onSelect(date)} data-schedule-date={date} data-event-count={counts?.[date]}>
                <span>{format(day, "EEEEEE", locale)}</span>
                <span className="msc-strip-day">{format(day, "d")}</span>
                <span className="msc-day-count">{counts?.[date] || ""}</span>
            </button>
        })}
    </div>
}

/** `counts` replaces the per-day events for All anime, which loads only the chosen day's episodes. */
function MonthGrid({ days, selected, weekStartsOn, counts, onSelect }: { days: CalendarDayItem[], selected: string, weekStartsOn: number, counts?: Record<string, number>, onSelect: (date: string) => void }) {
    const t = useTr()
    const names = t("Mo Tu We Th Fr Sa Su", "Mo Di Mi Do Fr Sa So").split(" ")
    const labels = weekStartsOn === 0 ? [names[6], ...names.slice(0, 6)] : names
    return <div className="msc-month">
        <div className="msc-weekdays" aria-hidden>{labels.map(label => <span key={label}>{label}</span>)}</div>
        <div className="msc-grid" role="group" aria-label={t("Days of the month", "Tage im Monat")}>
            {days.map(day => {
                const count = counts ? counts[day.date] ?? 0 : day.events.length
                return <button key={day.date} type="button" onClick={() => onSelect(day.date)}
                    aria-pressed={day.date === selected} aria-current={day.isToday ? "date" : undefined}
                    aria-label={`${format(parseISO(day.date), "dd.MM.yyyy")}, ${count} ${t("episodes", "Folgen")}${day.isToday ? t(", today", ", heute") : ""}`}
                    className={cn("msc-day", !day.isCurrentMonth && "msc-day-outside", count > 0 && "msc-day-busy")}
                    data-schedule-date={day.date} data-event-count={count}>
                    <span>{Number(day.date.slice(-2))}</span>
                    <span className="msc-day-count">{count > 0 ? count : ""}</span>
                </button>
            })}
        </div>
    </div>
}

function DayList({ title, today, events, indicateWatched, episodes, showEmpty }: {
    title: string, today?: boolean, events: CalendarEvent[], indicateWatched: boolean, episodes: (n: number) => string, showEmpty?: boolean
}) {
    const t = useTr()
    if (!events.length && !showEmpty) return null
    return <div className="msc-day-list" data-schedule-day>
        <div className="msc-day-head">
            <h3 data-today={today || undefined}>{title}</h3>
            <span>{episodes(events.length)}</span>
        </div>
        {events.length > 0 ? <div className="msc-rows">
            {events.map(event => <EventRow key={event.id} event={event} indicateWatched={indicateWatched} />)}
        </div> : <p className="msc-note">{t("Nothing airs from your selection on this day.", "An diesem Tag läuft nichts aus deiner Auswahl.")}</p>}
    </div>
}

function EventRow({ event, indicateWatched }: { event: CalendarEvent, indicateWatched: boolean }) {
    const t = useTr()
    const watched = event.isWatched && indicateWatched
    return <SeaLink href={event.href} className="msc-row" data-watched={watched || undefined} data-schedule-event>
        <span className="msc-art">{event.image && <SeaImage src={event.image} alt="" fill className="object-cover" />}</span>
        <span className="msc-row-text">
            <span className="msc-row-title">{event.name}</span>
            <span className="msc-row-meta">
                {event.isMovie ? t("Movie", "Film") : `${t("Episode", "Folge")} ${event.episode}`}{event.time && ` · ${event.time}`}
                {event.isSeasonFinale && <span className="msc-finale"> · {t("Finale", "Finale")}</span>}
            </span>
        </span>
        {watched && <LuCheck className="msc-watched" aria-label={t("Watched", "Gesehen")} />}
    </SeaLink>
}

function FilterSheet(props: PhoneScheduleProps & { open: boolean, onOpenChange: (open: boolean) => void }) {
    const t = useTr()
    const { statuses, statusFilters, isAllAnime } = props
    const toggle = (value: AL_MediaListStatus) => props.onStatuses(statuses.includes(value) ? statuses.filter(s => s !== value) : [...statuses, value])
    return <Modal title={t("Calendar filter", "Kalenderfilter")} open={props.open} onOpenChange={props.onOpenChange} contentClass="msc-sheet">
        <div className="msc-sheet-body" data-schedule-filters>
            <div className="msc-tabs" role="radiogroup" aria-label={t("Calendar source", "Kalenderquelle")}>
                {([["list", t("My AniList", "Meine AniList")], ["all", t("All anime", "Alle Anime")]] as const).map(([value, label]) =>
                    <button key={value} type="button" role="radio" aria-checked={props.source === value} onClick={() => props.onSource(value)} data-schedule-source={value}>{label}</button>)}
            </div>

            {isAllAnime ? <p className="msc-sheet-note">{t("Every episode AniList knows, regardless of your list. The calendar shows how many air each day; pick a day to see them.",
                    "Alle bei AniList erfassten Folgen, unabhängig von deiner Liste. Der Kalender zeigt, wie viele pro Tag laufen; Tag antippen, um sie zu sehen.")}</p>
                : <div className="msc-sheet-group">
                    <div className="msc-sheet-head">
                        <h3>{t("Statuses", "Status")}</h3>
                        <button type="button" className="msc-text-action" onClick={() => props.onStatuses(statusFilters.map(f => f.value))}>{t("Select all", "Alle wählen")}</button>
                    </div>
                    <div className="msc-rows">
                        {statusFilters.map(f => <button key={f.value} type="button" role="checkbox" aria-checked={statuses.includes(f.value)} className="msc-check" onClick={() => toggle(f.value)} data-schedule-status={f.value}>
                            <span>{t(f.en, f.de)}</span>
                            <span className="msc-checkbox" aria-hidden><LuCheck /></span>
                        </button>)}
                    </div>
                    {statuses.length === 0 && <p className="msc-sheet-note" data-schedule-no-status>{t("Pick at least one status.", "Wähle mindestens einen Status aus.")}</p>}
                </div>}

            <div className="msc-sheet-group">
                <h3>{t("Week starts on", "Woche beginnt am")}</h3>
                <div className="msc-tabs" role="radiogroup" aria-label={t("Week starts on", "Woche beginnt am")}>
                    {([[1, t("Monday", "Montag")], [0, t("Sunday", "Sonntag")]] as const).map(([value, label]) =>
                        <button key={value} type="button" role="radio" aria-checked={props.weekStartsOn === value} onClick={() => props.onWeekStartsOn(value)}>{label}</button>)}
                </div>
            </div>

            <div className="msc-rows">
                <button type="button" role="switch" aria-checked={props.indicateWatched} className="msc-check" onClick={() => props.onIndicateWatched(!props.indicateWatched)}>
                    <span>{t("Mark watched episodes", "Gesehene Folgen markieren")}</span>
                    <span className="msc-toggle" aria-hidden />
                </button>
            </div>

            <button type="button" className="msc-primary" onClick={() => props.onOpenChange(false)}>{t("Done", "Fertig")}</button>
        </div>
    </Modal>
}
