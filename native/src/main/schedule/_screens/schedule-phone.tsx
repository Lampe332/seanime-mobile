import type { AL_MediaListStatus, Anime_ScheduleItem } from "@/api/generated/types"
import { useGetAnimeCollectionSchedule } from "@/api/hooks/anime_collection.hooks"
import { useCoverFlightSource } from "@/components/shared/cover-flight"
import { PickRow, RowGroup, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { stepIn } from "@/components/ui/core/animations"
import { cn } from "@/components/ui/core/styling"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Heading, Muted, Text } from "@/components/ui/text/text"
import { appLanguageAtom, useTr } from "@/lib/app-language"
import { getImageUrl } from "@/lib/server/assets"
import { atomWithStorage } from "@/lib/storage"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { __anilist_userAnimeListDataAtom } from "@/main/_atoms/anilist.atoms"
import {
    calendarDays,
    type CalendarDayItem,
    type CalendarEvent,
    type CalendarParams,
    DEFAULT_CALENDAR_PARAMS,
    scheduleEvents,
    STATUS_FILTERS,
    weekdayLabels,
} from "@/main/schedule/_lib/schedule-phone"
import { useGlobalScheduleCounts, useGlobalScheduleDay } from "@/main/schedule/_lib/use-global-schedule"
import type { Locale } from "date-fns"
import { addDays } from "date-fns/addDays"
import { addMonths } from "date-fns/addMonths"
import { format } from "date-fns/format"
import { isSameMonth } from "date-fns/isSameMonth"
import { isToday } from "date-fns/isToday"
import { isTomorrow } from "date-fns/isTomorrow"
import { parseISO } from "date-fns/parseISO"
import { startOfDay } from "date-fns/startOfDay"
import { startOfMonth } from "date-fns/startOfMonth"
import { subMonths } from "date-fns/subMonths"
import { de } from "date-fns/locale/de"
import { Image } from "expo-image"
import { useImageFade } from "@/components/ui/core/image-fade"
import { useAtom, useAtomValue } from "jotai"
import Check from "lucide-react-native/icons/check"
import ChevronLeft from "lucide-react-native/icons/chevron-left"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal"
import React from "react"
import { Pressable, View } from "react-native"
import Animated from "react-native-reanimated"

/*
 * The calendar (schedule-calendar.tsx + schedule-phone.tsx + schedule-phone.css): on Android the schedule page is the phone
 * calendar itself (PhoneSchedule), the next seven days as an agenda or the month grid, the filters in a sheet. Same language
 * as Home and Downloads: neutral surfaces, the accent only on today, the selected day and the one action.
 * Tablet (≥ 720dp): the days of the agenda side by side, two columns, three from 1100dp (tablet.css "Calendar").
 */

const phoneViewAtom = atomWithStorage<"week" | "month">("sea-calendar-phone-view", "week")
const calendarSourceAtom = atomWithStorage<"list" | "all">("sea-calendar-source", "list")
export const weekStartsOnAtom = atomWithStorage("sea-calendar-week-starts-on", 1)
export const calendarParamsAtom = atomWithStorage<CalendarParams>("sea-release-calendar-params", DEFAULT_CALENDAR_PARAMS)

/** The schedule page and Home's "Schedule calendar" (My AniList): the phone calendar with its own head. */
export function ScheduleCalendar() {
    const anilistListData = useAtomValue(__anilist_userAnimeListDataAtom)
    const [currentDate, setCurrentDate] = React.useState(() => new Date())
    const [selectedDate, setSelectedDate] = React.useState(() => format(new Date(), "yyyy-MM-dd"))
    const [source, setSource] = useAtom(calendarSourceAtom)
    const isAllAnime = source === "all"
    const personalQuery = useGetAnimeCollectionSchedule({ enabled: !isAllAnime })
    const globalQuery = useGlobalScheduleDay(selectedDate, isAllAnime)
    const query = isAllAnime ? globalQuery : personalQuery
    const [params, setParams] = useAtom(calendarParamsAtom)
    const [weekStartsOn, setWeekStartsOn] = useAtom(weekStartsOnAtom)

    const eventsOn = React.useCallback((day: Date) => scheduleEvents(query.data, day, anilistListData, isAllAnime ? null : params.listStatuses),
        [query.data, anilistListData, isAllAnime, params.listStatuses])
    const days = React.useMemo(() => calendarDays(currentDate, weekStartsOn, eventsOn), [currentDate, weekStartsOn, eventsOn])

    return <PhoneSchedule
        days={days} eventsOn={eventsOn} isAllAnime={isAllAnime} source={source} onSource={setSource}
        statuses={params.listStatuses} onStatuses={next => setParams({ ...params, listStatuses: next })}
        indicateWatched={params.indicateWatchedEpisodes} onIndicateWatched={value => setParams({ ...params, indicateWatchedEpisodes: value })}
        weekStartsOn={weekStartsOn} onWeekStartsOn={setWeekStartsOn}
        currentDate={currentDate} onMonth={setCurrentDate} selectedDate={selectedDate} onSelectDate={setSelectedDate}
        loading={query.isLoading} error={query.isError} onRetry={() => void query.refetch()}
    />
}

type PhoneScheduleProps = {
    days: CalendarDayItem[]
    eventsOn: (day: Date) => CalendarEvent[]
    isAllAnime: boolean
    source: "list" | "all"
    onSource: (source: "list" | "all") => void
    statuses: AL_MediaListStatus[]
    onStatuses: (statuses: AL_MediaListStatus[]) => void
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

function useDateLocale() {
    const german = useAtomValue(appLanguageAtom) === "de"
    return { german, locale: german ? { locale: de } : undefined }
}

/** Android phone calendar: the next seven days as an agenda, or the month grid; filters live in a sheet. */
function PhoneSchedule(props: PhoneScheduleProps) {
    const { days, eventsOn, isAllAnime, statuses, currentDate, selectedDate, loading, error } = props
    const t = useTr()
    const { german, locale } = useDateLocale()
    const { isTablet } = useTabletLayout()
    const [view, setView] = useAtom(phoneViewAtom)
    const [weekOffset, setWeekOffset] = React.useState(0)
    const [filtersOpen, setFiltersOpen] = React.useState(false)
    // The next or previous 7 days / month slide in from their side; the pager row stays (usePhoneStep).
    const [step, setStep] = React.useState(0)
    const entering = step ? stepIn(isTablet, step > 0) : undefined

    const firstDay = addDays(startOfDay(new Date()), weekOffset * 7)
    const week = Array.from({ length: 7 }, (_, i) => addDays(firstDay, i))
    // All anime loads one day at a time; the grid and the strip get their per-day counts from one range query
    const countsRange = view === "month" ? [parseISO(days[0].date), addDays(parseISO(days[days.length - 1].date), 1)] : [firstDay, addDays(firstDay, 7)]
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
        : statuses.length === STATUS_FILTERS.length ? t("All statuses", "Alle Status")
            : statuses.length === 0 ? t("No status selected", "Kein Status gewählt")
                : STATUS_FILTERS.filter(f => statuses.includes(f.value)).map(f => t(f.en, f.de)).join(", ")

    const selectDay = (date: string) => {
        props.onSelectDate(date)
        const selected = parseISO(date)
        if (!isSameMonth(selected, currentDate)) {
            setStep(selected > currentDate ? 1 : -1)
            props.onMonth(selected)
        }
    }
    const goWeek = (by: number) => {
        setStep(by)
        setWeekOffset(o => o + by)
    }
    const goMonth = (by: number) => {
        const next = startOfMonth(by > 0 ? addMonths(currentDate, 1) : subMonths(currentDate, 1))
        setStep(by)
        props.onMonth(next)
        props.onSelectDate(format(next, "yyyy-MM-dd"))
    }
    const toToday = () => {
        setStep(view === "week" ? -Math.sign(weekOffset) : new Date() > currentDate ? 1 : -1)
        setWeekOffset(0)
        props.onMonth(new Date())
        props.onSelectDate(format(new Date(), "yyyy-MM-dd"))
    }

    const selected = days.find(d => d.date === selectedDate) ?? days.find(d => d.isToday && d.isCurrentMonth) ?? days.find(d => d.isCurrentMonth)!
    const status = error ? <View accessibilityRole="alert" className="py-2">
            <Text className="leading-[22.5px] text-sm-text-muted">{t("The calendar could not be loaded.", "Der Kalender konnte nicht geladen werden.")}</Text>
            <View className="-ml-2 self-start"><TextAction label={t("Try again", "Erneut versuchen")} onPress={props.onRetry} /></View>
        </View>
        : loading ? <Note>{t("Loading episodes…", "Folgen werden geladen …")}</Note> : null

    return (
        <View className="gap-5">
            {/* r16 (Nick 10.11., on purpose unlike 2.0.32's 32dp extrabold): the head of every tab, title 28/32 bold, facts 3dp under it,
                24dp to the first block (this column's gap is 20) */}
            <View className="mb-1 pt-1">
                <Heading>{t("Schedule", "Sendeplan")}</Heading>
                <Muted className="mt-[3px]" style={{ fontVariant: ["tabular-nums"] }}>{facts}</Muted>
            </View>

            <Pressable accessibilityRole="button" accessibilityLabel={`${isAllAnime ? t("All anime", "Alle Anime") : t("My AniList", "Meine AniList")}, ${statusSummary}`}
                accessibilityHint={t("Change filter", "Filter ändern")} onPress={() => setFiltersOpen(true)}
                className="min-h-16 flex-row items-center gap-3 rounded-surface bg-sm-surface-raised px-4 py-2.5 active:bg-sm-surface-control">
                <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="text-[15px] font-semibold">{isAllAnime ? t("All anime", "Alle Anime") : t("My AniList", "Meine AniList")}</Text>
                    <Text numberOfLines={1} className="text-[13px] text-sm-text-muted">{statusSummary}</Text>
                </View>
                <SlidersHorizontal size={20} color={colors.smTextMuted} />
            </Pressable>

            <View className={cn(isTablet && "w-full max-w-[416px]")}>
                <Tabs variant="segment" value={view} onValueChange={value => {
                    setStep(0)
                    setView(value as "week" | "month")
                }} items={[{ value: "week", label: t("Week", "Woche") }, { value: "month", label: t("Month", "Monat") }]} />
            </View>

            {view === "week" && (
                <View className="gap-4">
                    <Pager title={weekOffset === 0 ? t("Next 7 days", "Nächste 7 Tage") : range}
                        previous={t("Previous 7 days", "Vorherige 7 Tage")} next={t("Next 7 days", "Nächste 7 Tage")}
                        onPrevious={() => goWeek(-1)} onNext={() => goWeek(1)} onToday={weekOffset !== 0 ? toToday : undefined} />
                    <Animated.View key={`week-${weekOffset}`} entering={entering} className="gap-4">
                        {isAllAnime ? <>
                            <DayStrip week={week} selectedDate={selectedDate} onSelect={props.onSelectDate} locale={locale} counts={allCounts} />
                            {status ?? <DayList key={selectedDate} title={dayTitle(parseISO(selectedDate))} events={eventsOn(parseISO(selectedDate))}
                                indicateWatched={props.indicateWatched} episodes={episodes} />}
                        </> : status ?? (weekCount === 0
                            ? <Note>{t("No episodes from your list in these 7 days.", "In diesen 7 Tagen keine Folgen aus deiner Liste.")}</Note>
                            : <DayColumns>
                                {weekEvents.filter(d => d.events.length > 0).map(d =>
                                    <DayList key={d.day.toISOString()} title={dayTitle(d.day)} today={isToday(d.day)} events={d.events}
                                        indicateWatched={props.indicateWatched} episodes={episodes} />)}
                            </DayColumns>)}
                    </Animated.View>
                </View>
            )}

            {view === "month" && (
                <View className="gap-4">
                    <Pager title={format(currentDate, "MMMM yyyy", locale)} previous={t("Previous month", "Vorheriger Monat")} next={t("Next month", "Nächster Monat")}
                        onPrevious={() => goMonth(-1)} onNext={() => goMonth(1)} onToday={!isSameMonth(currentDate, new Date()) ? toToday : undefined} />
                    <Animated.View key={`month-${format(currentDate, "yyyy-MM")}`} entering={entering} className="gap-4">
                        <MonthGrid days={days} selected={selected.date} weekStartsOn={props.weekStartsOn} counts={isAllAnime ? allCounts ?? {} : undefined} onSelect={selectDay} />
                        {status ?? <DayList key={selected.date} title={dayTitle(parseISO(selected.date))} today={selected.isToday} events={selected.events}
                            indicateWatched={props.indicateWatched} episodes={episodes} showEmpty />}
                    </Animated.View>
                </View>
            )}

            <FilterSheet {...props} open={filtersOpen} onOpenChange={setFiltersOpen} />
        </View>
    )
}

function Note({ children }: { children: React.ReactNode }) {
    return <Text className="py-2 leading-[22.5px] text-sm-text-muted">{children}</Text>
}

/** `.msc-nav`: previous, the range in the middle, next, and "Today" while away from it. */
function Pager({ title, previous, next, onPrevious, onNext, onToday }: {
    title: string
    previous: string
    next: string
    onPrevious: () => void
    onNext: () => void
    onToday?: () => void
}) {
    const t = useTr()
    return (
        <View className="-mx-2 flex-row items-center gap-1">
            <Button intent="icon" accessibilityLabel={previous} onPress={onPrevious}><ChevronLeft size={22} color={colors.smText} /></Button>
            <Text accessibilityRole="header" className="min-w-0 flex-1 text-center text-[17px] font-bold tracking-[-0.17px]" style={{ fontVariant: ["tabular-nums"] }}>{title}</Text>
            <Button intent="icon" accessibilityLabel={next} onPress={onNext}><ChevronRight size={22} color={colors.smText} /></Button>
            {!!onToday && <TextAction label={t("Today", "Heute")} onPress={onToday} />}
        </View>
    )
}

/** The agenda's days; a tablet of 720dp and more sets them side by side (2 columns, 3 from 1100dp). */
function DayColumns({ children }: { children: React.ReactNode }) {
    const { rail, window } = useTabletLayout()
    const [width, setWidth] = React.useState(0)
    const columns = !rail ? 1 : window.width >= 1100 ? 3 : window.width >= 720 ? 2 : 1
    if (columns === 1) return <View className="gap-4">{children}</View>
    const gap = 24
    const cell = width ? (width - gap * (columns - 1)) / columns : 0
    return (
        <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ columnGap: gap, rowGap: 16 }} className="flex-row flex-wrap items-start">
            {!!cell && React.Children.map(children, child => <View style={{ width: cell }}>{child}</View>)}
        </View>
    )
}

function DayStrip({ week, selectedDate, onSelect, locale, counts }: { week: Date[], selectedDate: string, onSelect: (date: string) => void, locale?: { locale: Locale }, counts?: Record<string, number> }) {
    return (
        <View className="flex-row gap-1">
            {week.map(day => {
                const date = format(day, "yyyy-MM-dd")
                const pressed = date === selectedDate
                const today = isToday(day)
                const count = counts?.[date]
                return (
                    <Pressable key={date} accessibilityRole="button" accessibilityState={{ selected: pressed }}
                        accessibilityLabel={[format(day, "EEEE d", locale), count ? String(count) : ""].filter(Boolean).join(", ")}
                        onPress={() => onSelect(date)}
                        className={cn("min-h-[76px] flex-1 items-center gap-0.5 rounded-surface-sm py-2", pressed ? "bg-brand-500" : "active:bg-sm-surface-control")}>
                        <Text className={cn("text-xs", pressed ? "text-white/85" : "text-sm-text-muted")}>{format(day, "EEEEEE", locale)}</Text>
                        <Text className={cn("text-[17px] font-semibold", pressed ? "text-white" : today ? "text-sm-accent" : "text-sm-text")}
                            style={{ fontVariant: ["tabular-nums"] }}>{format(day, "d")}</Text>
                        <Text className={cn("min-h-[14px] text-[11px] font-semibold leading-[14px]", pressed ? "text-white/85" : "text-sm-accent")}>{count || ""}</Text>
                    </Pressable>
                )
            })}
        </View>
    )
}

/** `counts` replaces the per-day events for All anime, which loads only the chosen day's episodes. */
export function MonthGrid({ days, selected, weekStartsOn, counts, onSelect }: { days: CalendarDayItem[], selected: string, weekStartsOn: number, counts?: Record<string, number>, onSelect: (date: string) => void }) {
    const t = useTr()
    const { german } = useDateLocale()
    return (
        <View className="gap-1">
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="flex-row">
                {weekdayLabels(german, weekStartsOn).map(label => <Text key={label} className="flex-1 py-1 text-center text-xs text-sm-text-subtle">{label}</Text>)}
            </View>
            <View accessibilityLabel={t("Days of the month", "Tage im Monat")} className="-m-0.5 flex-row flex-wrap">
                {days.map(day => {
                    const count = counts ? counts[day.date] ?? 0 : day.events.length
                    const pressed = day.date === selected
                    return (
                        <View key={day.date} style={{ width: `${100 / 7}%` }} className="p-0.5">
                            <Pressable accessibilityRole="button" accessibilityState={{ selected: pressed }} onPress={() => onSelect(day.date)}
                                accessibilityLabel={`${format(parseISO(day.date), "dd.MM.yyyy")}, ${count} ${t("episodes", "Folgen")}${day.isToday ? t(", today", ", heute") : ""}`}
                                className={cn("min-h-[52px] items-center justify-center gap-0.5 rounded-surface-sm",
                                    pressed ? "bg-brand-500" : count > 0 ? "bg-sm-surface-raised active:bg-sm-surface-control" : "active:bg-sm-surface-control",
                                    !day.isCurrentMonth && "opacity-40")}>
                                <Text className={cn("text-[15px]", pressed ? "font-semibold text-white" : day.isToday ? "font-extrabold text-sm-accent"
                                    : count > 0 ? "font-semibold text-sm-text" : "text-sm-text-muted")} style={{ fontVariant: ["tabular-nums"] }}>
                                    {Number(day.date.slice(-2))}
                                </Text>
                                <Text className={cn("min-h-[14px] text-[11px] font-semibold leading-[14px]", pressed ? "text-white/85" : "text-sm-accent")}>{count > 0 ? count : ""}</Text>
                            </Pressable>
                        </View>
                    )
                })}
            </View>
        </View>
    )
}

export function DayList({ title, today, events, indicateWatched, episodes, showEmpty }: {
    title: string, today?: boolean, events: CalendarEvent[], indicateWatched: boolean, episodes: (n: number) => string, showEmpty?: boolean
}) {
    const t = useTr()
    if (!events.length && !showEmpty) return null
    return (
        <View className="gap-2.5">
            <View className="flex-row items-baseline justify-between gap-3">
                <Text accessibilityRole="header" className={cn("min-w-0 flex-1 text-lg font-bold tracking-[-0.18px]", today && "text-sm-accent")}>{title}</Text>
                <Text className="text-[13px] text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>{episodes(events.length)}</Text>
            </View>
            {events.length > 0
                ? <RowGroup>{events.map(event => <EventRow key={event.id} event={event} indicateWatched={indicateWatched} />)}</RowGroup>
                : <Note>{t("Nothing airs from your selection on this day.", "An diesem Tag läuft nichts aus deiner Auswahl.")}</Note>}
        </View>
    )
}

const WATCHED_LOOK = { opacity: 0.55 }

function EventRow({ event, indicateWatched }: { event: CalendarEvent, indicateWatched: boolean }) {
    const t = useTr()
    const fade = useImageFade()
    const watched = event.isWatched && indicateWatched
    const what = event.isMovie ? t("Movie", "Film") : `${t("Episode", "Folge")} ${event.episode}`
    // the row's cover flies into the page it opens (cover-flight.tsx), dimmed like the row shows it when watched
    const coverUri = event.image ? getImageUrl(event.image) : ""
    const { coverRef, onLoad, hidden, open } = useCoverFlightSource(event.mediaId, coverUri, undefined, watched ? WATCHED_LOOK : undefined)
    return (
        <Pressable accessibilityRole="link"
            accessibilityLabel={[event.name, what, event.time, event.isSeasonFinale && t("Finale", "Finale"), watched && t("Watched", "Gesehen")].filter(Boolean).join(", ")}
            onPress={() => open(`/entry?id=${event.mediaId}`)}
            className="min-h-20 flex-row items-center gap-3.5 bg-sm-surface-raised py-2.5 pl-2.5 pr-3.5 active:bg-sm-surface-control">
            <View ref={coverRef} collapsable={false} style={{ opacity: watched ? WATCHED_LOOK.opacity : 1 }} className="h-[62px] w-11 overflow-hidden rounded-[6px] bg-sm-surface-control">
                {!!coverUri && <Image source={coverUri} recyclingKey={event.id} contentFit="cover" onLoad={onLoad}
                    transition={fade} style={{ position: "absolute", inset: 0, opacity: hidden ? 0 : 1 }} accessibilityIgnoresInvertColors />}
            </View>
            <View className="min-w-0 flex-1 gap-[3px]">
                <Text numberOfLines={2} className={cn("text-[15px] font-semibold leading-[20px]", watched && "text-sm-text-muted")}>{event.name}</Text>
                <Text className="text-[13px] text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>
                    {what}{event.time ? ` · ${event.time}` : ""}
                    {event.isSeasonFinale && <Text className="text-[13px] font-semibold text-sm-accent">{` · ${t("Finale", "Finale")}`}</Text>}
                </Text>
            </View>
            {watched && <Check size={18} color={colors.smTextSubtle} />}
        </Pressable>
    )
}

function FilterSheet(props: PhoneScheduleProps & { open: boolean, onOpenChange: (open: boolean) => void }) {
    const t = useTr()
    const { statuses, isAllAnime } = props
    const toggle = (value: AL_MediaListStatus) => props.onStatuses(statuses.includes(value) ? statuses.filter(s => s !== value) : [...statuses, value])
    return (
        <Sheet title={t("Calendar filter", "Kalenderfilter")} open={props.open} onOpenChange={props.onOpenChange}
            footer={<Button wrapperClassName="flex-1" onPress={() => props.onOpenChange(false)}>{t("Done", "Fertig")}</Button>}>
            <Tabs variant="segment" value={props.source} onValueChange={value => props.onSource(value as "list" | "all")}
                items={[{ value: "list", label: t("My AniList", "Meine AniList") }, { value: "all", label: t("All anime", "Alle Anime") }]} />

            {isAllAnime
                ? <Muted className="text-sm leading-[21px]">{t("Every episode AniList knows, regardless of your list. The calendar shows how many air each day; pick a day to see them.",
                    "Alle bei AniList erfassten Folgen, unabhängig von deiner Liste. Der Kalender zeigt, wie viele pro Tag laufen; Tag antippen, um sie zu sehen.")}</Muted>
                : <SheetGroup title={t("Statuses", "Status")}
                    action={<TextAction label={t("Select all", "Alle wählen")} onPress={() => props.onStatuses(STATUS_FILTERS.map(f => f.value))} />}
                    note={statuses.length === 0 ? t("Pick at least one status.", "Wähle mindestens einen Status aus.") : undefined}>
                    <RowGroup>
                        {STATUS_FILTERS.map(f => <PickRow key={f.value} checked={statuses.includes(f.value)} label={t(f.en, f.de)} onPress={() => toggle(f.value)} />)}
                    </RowGroup>
                </SheetGroup>}

            <SheetGroup title={t("Week starts on", "Woche beginnt am")}>
                <Tabs variant="segment" value={String(props.weekStartsOn)} onValueChange={value => props.onWeekStartsOn(Number(value))}
                    items={[{ value: "1", label: t("Monday", "Montag") }, { value: "0", label: t("Sunday", "Sonntag") }]} />
            </SheetGroup>

            <RowGroup>
                <SwitchRow label={t("Mark watched episodes", "Gesehene Folgen markieren")} checked={props.indicateWatched} onCheckedChange={props.onIndicateWatched} />
            </RowGroup>
        </Sheet>
    )
}

/**
 * Home's "Schedule calendar" with All anime (web home-screen GlobalAnimeScheduleCalendar): AniList's episodes from two weeks
 * back to two weeks ahead as the month grid and the chosen day's list, in the calendar's look (decision in the map, §9).
 */
export function ScheduleMonthCalendar({ items, loading, error, onRetry }: { items: Anime_ScheduleItem[] | undefined, loading: boolean, error: boolean, onRetry: () => void }) {
    const t = useTr()
    const { german, locale } = useDateLocale()
    const { isTablet } = useTabletLayout()
    const anilistListData = useAtomValue(__anilist_userAnimeListDataAtom)
    const weekStartsOn = useAtomValue(weekStartsOnAtom)
    const params = useAtomValue(calendarParamsAtom)
    const [currentDate, setCurrentDate] = React.useState(() => new Date())
    const [selectedDate, setSelectedDate] = React.useState(() => format(new Date(), "yyyy-MM-dd"))
    const [step, setStep] = React.useState(0)
    const eventsOn = React.useCallback((day: Date) => scheduleEvents(items, day, anilistListData, null), [items, anilistListData])
    const days = React.useMemo(() => calendarDays(currentDate, weekStartsOn, eventsOn), [currentDate, weekStartsOn, eventsOn])
    const selected = days.find(d => d.date === selectedDate) ?? days.find(d => d.isCurrentMonth)!
    const episodes = (n: number) => `${n} ${n === 1 ? t("episode", "Folge") : t("episodes", "Folgen")}`
    const goMonth = (by: number) => {
        const next = startOfMonth(by > 0 ? addMonths(currentDate, 1) : subMonths(currentDate, 1))
        setStep(by)
        setCurrentDate(next)
        setSelectedDate(format(next, "yyyy-MM-dd"))
    }
    const toToday = () => {
        setStep(new Date() > currentDate ? 1 : -1)
        setCurrentDate(new Date())
        setSelectedDate(format(new Date(), "yyyy-MM-dd"))
    }
    const selectDay = (date: string) => {
        setSelectedDate(date)
        const day = parseISO(date)
        if (!isSameMonth(day, currentDate)) {
            setStep(day > currentDate ? 1 : -1)
            setCurrentDate(day)
        }
    }
    const day = parseISO(selected.date)
    const title = isToday(day) ? t("Today", "Heute") : format(day, german ? "EEEE, d. MMMM" : "EEEE, MMMM d", locale)
    return (
        <View className="gap-4">
            <Pager title={format(currentDate, "MMMM yyyy", locale)} previous={t("Previous month", "Vorheriger Monat")} next={t("Next month", "Nächster Monat")}
                onPrevious={() => goMonth(-1)} onNext={() => goMonth(1)} onToday={!isSameMonth(currentDate, new Date()) ? toToday : undefined} />
            <Animated.View key={format(currentDate, "yyyy-MM")} entering={step ? stepIn(isTablet, step > 0) : undefined} className="gap-4">
                <MonthGrid days={days} selected={selected.date} weekStartsOn={weekStartsOn} onSelect={selectDay} />
                {error ? <View accessibilityRole="alert" className="py-2">
                        <Text className="leading-[22.5px] text-sm-text-muted">{t("The calendar could not be loaded.", "Der Kalender konnte nicht geladen werden.")}</Text>
                        <View className="-ml-2 self-start"><TextAction label={t("Try again", "Erneut versuchen")} onPress={onRetry} /></View>
                    </View>
                    : loading ? <Note>{t("Loading episodes…", "Folgen werden geladen …")}</Note>
                        : <DayList key={selected.date} title={title} today={selected.isToday} events={selected.events} indicateWatched={params.indicateWatchedEpisodes}
                            episodes={episodes} showEmpty />}
            </Animated.View>
        </View>
    )
}
