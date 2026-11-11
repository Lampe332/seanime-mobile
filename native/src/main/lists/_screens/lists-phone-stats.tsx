import { useGetAniListStats, useGetRawAnimeCollection } from "@/api/hooks/anilist.hooks"
import { useGetRawAnilistMangaCollection } from "@/api/hooks/manga.hooks"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { Facts, FORMAT_LABELS, LoadingRows, Notice, TextAction } from "@/components/shared/phone-kit"
import { PhoneEmpty, PhoneSection, useOfflineAware } from "@/components/shared/phone-cards"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { barGrow, swapIn } from "@/components/ui/core/animations"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { formatScore, getListFacts, getPhoneLists, getStatsView, type ListType, type StatRow, statusLabel, type StatsView } from "@/main/lists/_lib/lists-phone"
import React from "react"
import { Pressable, View } from "react-native"
import Animated from "react-native-reanimated"

type Bar = { key: string, label: string, value: string, ratio: number, meta?: string }

/** Rows a long section shows before "Show all". */
const BARS_SHOWN = 5

/**
 * The AniList stats of the chosen type (lists-phone-stats.tsx; Anime | Manga above switches it): key facts, highlights and
 * ranked bars, with the desktop stats' data and math.
 *
 * "Started anime" is AniList's own total, which leaves Planning out; the planned titles stand next to it, so the list's
 * "336 anime" and the stats' "312" add up instead of looking like a bug (2.0.33, see lists-phone.ts `getListFacts`).
 */
export function ListsStats({ type, typeSwitch, actions }: { type: ListType, typeSwitch: React.ReactNode, actions: React.ReactNode }) {
    const t = useTr()
    const offlineAware = useOfflineAware()
    const query = useGetAniListStats(true)
    const stats = type === "anime" ? query.data?.animeStats : query.data?.mangaStats
    const thisYear = new Date().getFullYear()
    // The planned titles come from the list itself, counted like its header (the stats query has no statuses)
    const showAdult = !!useServerStatus()?.settings?.anilist?.enableAdultContent
    const animeQuery = useGetRawAnimeCollection()
    const mangaQuery = useGetRawAnilistMangaCollection()
    const rawLists = (type === "anime" ? animeQuery : mangaQuery).data?.MediaListCollection?.lists
    const [openedAt] = React.useState(() => Date.now()) // the planned count does not depend on the time
    const listPlanned = React.useMemo(() => rawLists ? getListFacts(type, getPhoneLists(rawLists, showAdult), openedAt).planned : undefined,
        [type, rawLists, showAdult, openedAt])
    const view = React.useMemo(() => stats ? getStatsView(type, stats, thisYear, listPlanned) : null, [type, stats, thisYear, listPlanned])
    // A finished request without stats shows the empty state, not an endless load.
    const loading = query.isPending
    const failed = query.isError && !query.data
    const f = formats(t)

    const total = view ? started(t, type, view.count) : ""
    const facts = loading ? t("Loading your stats…", "Deine Statistik wird geladen …")
        : failed ? t("Not loaded", "Nicht geladen")
            : !view?.count ? total
                : [total, view.planned > 0 && t(`${f.number(view.planned)} planned`, `${f.number(view.planned)} geplant`),
                    type === "anime" ? t(`${f.days(view.minutes / 1440)} watched`, `${f.days(view.minutes / 1440)} geschaut`)
                        : t(`${f.chapters(view.chapters)} read`, `${f.chapters(view.chapters)} gelesen`)].filter(Boolean).join(" · ")

    return (
        <PhoneScreen title={t("My lists", "Meine Listen")} subtitle={facts} actions={actions}>
            {typeSwitch}
            {failed ? <Notice text={offlineAware(["Your stats could not be loaded.", "Deine Statistik konnte nicht geladen werden."],
                    ["No internet connection, so your stats could not be loaded.", "Keine Internetverbindung, deshalb konnte deine Statistik nicht geladen werden."])}>
                    <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => void query.refetch()} />
                </Notice>
                : loading ? <View className="gap-6"><LoadingRows label={t("Loading your stats", "Deine Statistik wird geladen")} count={3} />
                    <View className="h-[216px] rounded-surface bg-sm-surface-raised" /></View>
                    : !view?.count ? <PhoneEmpty
                            title={type === "anime" ? t("No anime stats yet", "Noch keine Anime-Statistik") : t("No manga stats yet", "Noch keine Manga-Statistik")}
                            text={t("Stats appear once titles are on your AniList list.", "Die Statistik erscheint, sobald Titel auf deiner AniList-Liste stehen.")} />
                        : <StatsContent key={type} t={t} type={type} view={view} thisYear={thisYear} />}
        </PhoneScreen>
    )
}

function started(t: Translate, type: ListType, count: number) {
    const n = count.toLocaleString(t("en-US", "de-DE"))
    return type === "anime" ? t(`${n} anime started`, `${n} Anime begonnen`) : t(`${n} manga started`, `${n} Manga begonnen`)
}

/** Numbers in the app language: "5,320" / "5.320", "41 days" / "41 Tage". */
function formats(t: Translate) {
    const locale = t("en-US", "de-DE")
    const number = (value: number, digits = 0) => value.toLocaleString(locale, { maximumFractionDigits: digits })
    const plural = (value: string, one: [string, string], many: [string, string]) => value === "1" ? t(...one) : t(`${value} ${many[0]}`, `${value} ${many[1]}`)
    return {
        number,
        /** Days with one decimal below 10 unless `digits` says otherwise */
        days: (days: number, digits?: number) => plural(number(days, digits ?? (days < 10 ? 1 : 0)), ["1 day", "1 Tag"], ["days", "Tage"]),
        hours: (value: number) => plural(number(value), ["1 hour", "1 Stunde"], ["hours", "Stunden"]),
        chapters: (value: number) => plural(number(value), ["1 chapter", "1 Kapitel"], ["chapters", "Kapitel"]),
        titles: (value: number) => plural(number(value), ["1 title", "1 Titel"], ["titles", "Titel"]),
        started: (value: number) => plural(number(value), ["1 title started", "1 Titel begonnen"], ["titles started", "Titel begonnen"]),
        mean: (score: number | undefined) => score ? number(score / 10, 1) : "–",
        avg: (score: number | undefined) => score ? t(`Score avg ${number(score / 10, 1)}`, `Ø-Bewertung ${number(score / 10, 1)}`) : "",
    }
}

function StatsContent({ t, type, view, thisYear }: { t: Translate, type: ListType, view: StatsView, thisYear: number }) {
    const f = formats(t)
    const hours = Math.round(view.minutes / 60)
    const startedIn = (value: number | null, year: number) => ({ value: f.number(value ?? 0), note: value != null ? String(year) : t("No activity", "Keine Aktivität") })
    const meta = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" · ")
    const watched = (minutes: number | undefined) => t(`${f.number(Math.round((minutes ?? 0) / 60))} h watched`, `${f.number(Math.round((minutes ?? 0) / 60))} Std. geschaut`)
    const bars = {
        scores: view.scores.map(row => bar(row, formatScore(t, row.score ?? Number(row.key)), f.titles(row.count))),
        statuses: view.statuses.map(row => bar(row, t(...statusLabel(row.key, type)), f.titles(row.count))),
        formats: view.formats.map(row => bar(row, t(...(FORMAT_LABELS[row.key] ?? [row.key, row.key])), f.titles(row.count),
            meta(watched(row.minutes), f.avg(row.meanScore)))),
        genres: view.genres.map(row => bar(row, row.key, f.titles(row.count),
            meta(type === "anime" ? watched(row.minutes) : f.chapters(row.chapters ?? 0), f.avg(row.meanScore)))),
        startYears: view.startYears.map(row => bar(row, row.key, f.titles(row.count))),
        releaseYears: view.releaseYears.map(row => bar(row, row.key, f.titles(row.count))),
        studios: view.studios.map(row => bar(row, row.label ?? row.key, f.titles(row.count), f.avg(row.meanScore))),
    }
    const thisYearFacts = startedIn(view.thisYear, thisYear)
    const lastYearFacts = startedIn(view.lastYear, thisYear - 1)

    return (
        <>
            {/* How fresh the numbers are, up front: the server keeps AniList's stats for an hour. */}
            <PhoneSection title={type === "anime" ? t("Anime stats", "Anime-Statistik") : t("Manga stats", "Manga-Statistik")}
                note={t("From AniList, up to an hour old.", "Von AniList, bis zu einer Stunde alt.")}>
                <Facts items={[
                    {
                        label: type === "anime" ? t("Started anime", "Begonnene Anime") : t("Started manga", "Begonnene Manga"),
                        value: f.number(view.count),
                        // AniList counts every list but Planning; the list header counts those too
                        note: view.planned > 0 ? t(`without ${f.number(view.planned)} planned`, `ohne ${f.number(view.planned)} geplante`) : undefined,
                    },
                    ...(type === "anime" ? [
                        { label: t("Episodes", "Folgen"), value: f.number(view.episodes) },
                        { label: t("Watch time", "Geschaute Zeit"), value: f.days(hours / 24, 1), note: f.hours(hours) },
                    ] : [{ label: t("Chapters", "Kapitel"), value: f.number(view.chapters) }]),
                    { label: t("Mean score", "Durchschnittsbewertung"), value: f.mean(view.meanScore) },
                    { label: t("Started this year", "Dieses Jahr begonnen"), ...thisYearFacts },
                    { label: t("Started last year", "Letztes Jahr begonnen"), ...lastYearFacts },
                ]} />
            </PhoneSection>

            {(view.modeScore || view.completion || view.topGenre || view.peakYear) && (
                <PhoneSection title={t("Highlights", "Highlights")}>
                    <Facts items={[
                        ...(view.modeScore ? [{ label: t("Most used score", "Häufigste Bewertung"), value: formatScore(t, view.modeScore.score), note: f.titles(view.modeScore.count) }] : []),
                        ...(view.completion ? [{
                            label: t("Completion", "Abschlussquote"), value: t(`${view.completion.rate}%`, `${view.completion.rate} %`),
                            note: t(`${f.number(view.completion.completed)} of ${f.number(view.completion.started)} started titles`,
                                `${f.number(view.completion.completed)} von ${f.number(view.completion.started)} begonnenen Titeln`),
                        }] : []),
                        ...(view.topGenre ? [{ label: t("Top genre", "Top-Genre"), value: view.topGenre.genre, note: meta(f.titles(view.topGenre.count), f.avg(view.topGenre.meanScore)) }] : []),
                        ...(view.peakYear ? [{ label: t("Peak start year", "Stärkstes Startjahr"), value: String(view.peakYear.year), note: f.started(view.peakYear.count) }] : []),
                    ]} />
                </PhoneSection>
            )}

            <BarSection t={t} title={t("Score distribution", "Bewertungsverteilung")} bars={bars.scores} />
            <BarSection t={t} title={t("List status", "Listenstatus")} bars={bars.statuses} />
            <BarSection t={t} title={t("Formats", "Formate")} bars={bars.formats} />
            <BarSection t={t} title={t("Top genres", "Top-Genres")} bars={bars.genres} />
            <BarSection t={t} title={t("Started by year", "Begonnen pro Jahr")} bars={bars.startYears} />
            <BarSection t={t} title={t("Release years", "Erscheinungsjahre")} bars={bars.releaseYears} />
            <BarSection t={t} title={t("Top studios", "Top-Studios")} bars={bars.studios} />
        </>
    )
}

function bar(row: StatRow, label: string, value: string, meta?: string): Bar {
    return { key: row.key, label, value, ratio: row.ratio, meta }
}

/**
 * A ranked list (`.ps-bars`): label and value over a thin bar, an optional detail line under it. The accent marks the largest
 * bar, which in lists ordered by score or year is not the first. Long lists show the first five until "Show all"; the added
 * rows rise in under them.
 */
function BarSection({ t, title, bars }: { t: Translate, title: string, bars: Bar[] }) {
    const [all, setAll] = React.useState(false)
    const { isTablet } = useTabletLayout()
    if (!bars.length) return null
    const cut = !all && bars.length > BARS_SHOWN + 1
    return (
        <PhoneSection title={title}>
            <View className="gap-3 rounded-surface bg-sm-surface-raised p-4">
                {(cut ? bars.slice(0, BARS_SHOWN) : bars).map((row, index) => {
                    const max = row.ratio === 1
                    const content = (
                        <View accessible accessibilityLabel={[row.label, row.value, row.meta].filter(Boolean).join(", ")} className="gap-1.5">
                            <View className="flex-row items-baseline justify-between gap-3">
                                <Text className="min-w-0 flex-1 text-sm">{row.label}</Text>
                                <Text className="text-right text-[13px] text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>{row.value}</Text>
                            </View>
                            <View className="h-1.5 overflow-hidden rounded-full bg-sm-surface-control">
                                {/* it grows from its start as the stats open (m-grow) */}
                                <Animated.View entering={barGrow(isTablet, index)} style={{ width: `${Math.max(0, Math.min(1, row.ratio)) * 100}%`, transformOrigin: "left" }}
                                    className={cn("h-full rounded-full", max ? "bg-sm-accent-strong" : "bg-sm-text-subtle")} />
                            </View>
                            {!!row.meta && <Text className="-mt-0.5 text-xs leading-[17px] text-sm-text-subtle" style={{ fontVariant: ["tabular-nums"] }}>{row.meta}</Text>}
                        </View>
                    )
                    return all && index >= BARS_SHOWN
                        ? <Animated.View key={row.key} entering={swapIn(isTablet)}>{content}</Animated.View>
                        : <View key={row.key}>{content}</View>
                })}
            </View>
            {cut && (
                <Pressable accessibilityRole="button" onPress={() => setAll(true)}
                    className="-mt-1 min-h-12 flex-row items-center justify-center rounded-surface-sm px-4 active:bg-sm-surface-control">
                    <Text className="text-sm text-sm-text-muted">{t(`Show all ${bars.length}`, `Alle ${bars.length} zeigen`)}</Text>
                </Pressable>
            )}
        </PhoneSection>
    )
}
