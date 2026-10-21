import { useGetAniListStats } from "@/api/hooks/anilist.hooks"
import {
    FORMAT_LABELS,
    offlineAware,
    PhoneEmpty,
    PhoneHeader,
    PhoneLoading,
    PhoneNotice,
    PhoneSection,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import { formatScore, getStatsView, ListType, StatRow, statusLabel, StatsView } from "@/app/(main)/lists/_lib/lists-phone"
import { Translate } from "@/lib/app-language"
import React from "react"

type Bar = { key: string, label: string, value: string, ratio: number, meta?: string }

/** Rows a long section shows before "Show all". */
const BARS_SHOWN = 5

/**
 * The AniList stats of the chosen type (Anime | Manga above switches it): key facts, highlights and ranked bars, with the
 * desktop stats' data and math.
 */
export function ListsStats({ t, type, typeSwitch, actions }: { t: Translate, type: ListType, typeSwitch: React.ReactNode, actions: React.ReactNode }) {
    const query = useGetAniListStats(true)
    const stats = type === "anime" ? query.data?.animeStats : query.data?.mangaStats
    const thisYear = new Date().getFullYear()
    const view = React.useMemo(() => stats ? getStatsView(type, stats, thisYear) : null, [type, stats, thisYear])
    // A finished request without stats shows the empty state, not an endless load.
    const loading = query.isPending
    const failed = query.isError && !query.data
    const f = formats(t)

    const total = view ? t(`${f.number(view.count)} ${type}`, `${f.number(view.count)} ${type === "anime" ? "Anime" : "Manga"}`) : ""
    const facts = loading ? t("Loading your stats…", "Deine Statistik wird geladen …")
        : failed ? t("Not loaded", "Nicht geladen")
            : !view?.count ? total
                : type === "anime" ? `${total} · ${t(`${f.days(view.minutes / 1440)} watched`, `${f.days(view.minutes / 1440)} geschaut`)}`
                    : `${total} · ${t(`${f.chapters(view.chapters)} read`, `${f.chapters(view.chapters)} gelesen`)}`

    return <>
        <PhoneHeader title={t("My lists", "Meine Listen")} facts={facts}>{actions}</PhoneHeader>
        {!!typeSwitch && <div className="pl-controls">{typeSwitch}</div>}
        <div className="pl-stats" data-lists-stats={type}>
            {failed ? <PhoneNotice data-lists-error text={offlineAware(t, ["Your stats could not be loaded.", "Deine Statistik konnte nicht geladen werden."],
                    ["No internet connection, so your stats could not be loaded.", "Keine Internetverbindung, deshalb konnte deine Statistik nicht geladen werden."])}>
                    <button type="button" className="ps-text-action" onClick={() => void query.refetch()}>{t("Try again", "Erneut versuchen")}</button>
                </PhoneNotice>
                : loading ? <PhoneLoading label={t("Loading your stats", "Deine Statistik wird geladen")} layout={["head", "row", "row", "row", "head", "feature"]} />
                    : !view?.count ? <PhoneEmpty data-lists-empty="stats"
                            title={type === "anime" ? t("No anime stats yet", "Noch keine Anime-Statistik") : t("No manga stats yet", "Noch keine Manga-Statistik")}
                            text={t("Stats appear once titles are on your AniList list.", "Die Statistik erscheint, sobald Titel auf deiner AniList-Liste stehen.")} />
                        : <StatsContent key={type} t={t} type={type} view={view} thisYear={thisYear} />}
        </div>
    </>
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
    const started = (value: number | null, year: number) => <dd>{f.number(value ?? 0)}<small>{value != null ? year : t("No activity", "Keine Aktivität")}</small></dd>
    const meta = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" · ")
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

    return <>
        {/* How fresh the numbers are, up front: the server keeps AniList's stats for an hour. */}
        <PhoneSection id="pl-stats-overview" title={type === "anime" ? t("Anime stats", "Anime-Statistik") : t("Manga stats", "Manga-Statistik")}
            note={t("From AniList, up to an hour old.", "Von AniList, bis zu einer Stunde alt.")} data-lists-stats-overview>
            <dl className="ps-facts" data-lists-stats-hero>
                <div><dt>{type === "anime" ? t("Total anime", "Anime insgesamt") : t("Total manga", "Manga insgesamt")}</dt><dd>{f.number(view.count)}</dd></div>
                {type === "anime" ? <>
                    <div><dt>{t("Episodes", "Folgen")}</dt><dd>{f.number(view.episodes)}</dd></div>
                    <div><dt>{t("Watch time", "Geschaute Zeit")}</dt><dd>{f.days(hours / 24, 1)}<small>{f.hours(hours)}</small></dd></div>
                </> : <div><dt>{t("Chapters", "Kapitel")}</dt><dd>{f.number(view.chapters)}</dd></div>}
                <div><dt>{t("Mean score", "Durchschnittsbewertung")}</dt><dd>{f.mean(view.meanScore)}</dd></div>
                <div><dt>{t("Started this year", "Dieses Jahr begonnen")}</dt>{started(view.thisYear, thisYear)}</div>
                <div><dt>{t("Started last year", "Letztes Jahr begonnen")}</dt>{started(view.lastYear, thisYear - 1)}</div>
            </dl>
        </PhoneSection>

        {(view.modeScore || view.completion || view.topGenre || view.peakYear) && <PhoneSection id="pl-stats-highlights" title={t("Highlights", "Highlights")}>
            <dl className="ps-facts" data-lists-stats-highlights>
                {view.modeScore && <div><dt>{t("Most used score", "Häufigste Bewertung")}</dt>
                    <dd>{formatScore(t, view.modeScore.score)}<small>{f.titles(view.modeScore.count)}</small></dd></div>}
                {view.completion && <div><dt>{t("Completion", "Abschlussquote")}</dt>
                    <dd>{t(`${view.completion.rate}%`, `${view.completion.rate} %`)}<small>{t(`${f.number(view.completion.completed)} of ${f.number(view.completion.started)} started titles`,
                        `${f.number(view.completion.completed)} von ${f.number(view.completion.started)} begonnenen Titeln`)}</small></dd></div>}
                {view.topGenre && <div><dt>{t("Top genre", "Top-Genre")}</dt>
                    <dd>{view.topGenre.genre}<small>{meta(f.titles(view.topGenre.count), f.avg(view.topGenre.meanScore))}</small></dd></div>}
                {view.peakYear && <div><dt>{t("Peak start year", "Stärkstes Startjahr")}</dt>
                    <dd>{view.peakYear.year}<small>{f.started(view.peakYear.count)}</small></dd></div>}
            </dl>
        </PhoneSection>}

        <BarSection t={t} id="scores" title={t("Score distribution", "Bewertungsverteilung")} bars={bars.scores} />
        <BarSection t={t} id="statuses" title={t("List status", "Listenstatus")} bars={bars.statuses} />
        <BarSection t={t} id="formats" title={t("Formats", "Formate")} bars={bars.formats} />
        <BarSection t={t} id="genres" title={t("Top genres", "Top-Genres")} bars={bars.genres} />
        <BarSection t={t} id="start-years" title={t("Started by year", "Begonnen pro Jahr")} bars={bars.startYears} />
        <BarSection t={t} id="release-years" title={t("Release years", "Erscheinungsjahre")} bars={bars.releaseYears} />
        <BarSection t={t} id="studios" title={t("Top studios", "Top-Studios")} bars={bars.studios} />
    </>
}

function bar(row: StatRow, label: string, value: string, meta?: string): Bar {
    return { key: row.key, label, value, ratio: row.ratio, meta }
}

/**
 * A ranked list: label and value over a thin bar, an optional detail line under it. The accent marks the largest bar, which in
 * lists ordered by score or year is not the first. Long lists show the first five until "Show all".
 */
function BarSection({ t, id, title, bars }: { t: Translate, id: string, title: string, bars: Bar[] }) {
    const [all, setAll] = React.useState(false)
    if (!bars.length) return null
    const cut = !all && bars.length > BARS_SHOWN + 1
    return <PhoneSection id={`pl-stats-${id}`} title={title} data-lists-stats-section={id}>
        <ol className="ps-bars pl-bars">
            {(cut ? bars.slice(0, BARS_SHOWN) : bars).map(row => <li key={row.key} data-max={row.ratio === 1 || undefined}>
                <span className="ps-bars-label">{row.label}</span>
                <span className="ps-bars-value">{row.value}</span>
                <span className="ps-bars-track" aria-hidden><span style={{ transform: `scaleX(${row.ratio})` }} /></span>
                {!!row.meta && <span className="pl-bars-meta">{row.meta}</span>}
            </li>)}
        </ol>
        {cut && <button type="button" className="ps-more" onClick={() => setAll(true)} data-lists-stats-more={id}>
            {t(`Show all ${bars.length}`, `Alle ${bars.length} zeigen`)}
        </button>}
    </PhoneSection>
}
