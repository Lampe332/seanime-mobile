import { Facts, FORMAT_LABELS } from "@/components/shared/phone-kit"
import { PhoneSection } from "@/components/shared/phone-cards"
import { barGrow } from "@/components/ui/core/animations"
import { useImageFade } from "@/components/ui/core/image-fade"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { getAppLanguage, plural, type Translate } from "@/lib/app-language"
import { formatDate, formatNumber } from "@/lib/i18n/format"
import { useRouter } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { accentGlow } from "@/lib/theme/palette"
import { usePalette } from "@/lib/theme/appearance"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { mediaEntryHref } from "@/main/_features/media/_lib/media-card"
import type { WrappedCount, WrappedTitle, WrappedView } from "@/main/lists/_lib/wrapped"
import { formatScore } from "@/main/lists/_lib/lists-phone"
import { monthRatios, parseDay, shareRatios, watchTime } from "@/main/wrapped/_lib/wrapped-phone"
import { Image } from "expo-image"
import React from "react"
import { Pressable, View } from "react-native"
import Animated, { Easing, Keyframe, ReduceMotion } from "react-native-reanimated"

const TABULAR = { fontVariant: ["tabular-nums" as const] }
/** The accent glow down the overview, the page glow's language in a card */
const HERO_GLOW = [[0.2, 0], [0.07, 150]] as const

/** Numbers and counted words in the app language */
export function wrappedFormats(t: Translate) {
    const language = getAppLanguage()
    const number = (value: number, digits = 0) => formatNumber(value, language, digits)
    const amount = (value: number, en: [string, string], de: [string, string], digits = 0) => plural(t, value, en, de, number(value, digits))
    return {
        number,
        titles: (value: number) => amount(value, ["1 title", "{0} titles"], ["1 Titel", "{0} Titel"]),
        episodes: (value: number) => amount(value, ["1 episode", "{0} episodes"], ["1 Folge", "{0} Folgen"]),
        days: (value: number) => amount(value, ["about 1 day", "about {0} days"], ["etwa 1 Tag", "etwa {0} Tage"], 1),
        score: (score: number) => formatScore(t, score / 10),
        day: (iso: string | undefined) => {
            const date = parseDay(iso)
            return date ? formatDate(date, language, "dayShortMonth") : ""
        },
        month: (index: number) => formatDate(new Date(2024, index, 1), language, "month"),
    }
}

/**
 * The heart of the page: how many titles the year closed, with episodes, estimated time and the mean score under it.
 * Episodes and time also count the running titles started in the year (getWrappedView), so they say "watched", not "finished".
 */
export function WrappedOverview({ t, view }: { t: Translate, view: WrappedView }) {
    const f = wrappedFormats(t)
    const glow = accentGlow(HERO_GLOW, 320, usePalette())
    const time = watchTime(view.minutes)
    const stats = [
        view.episodes > 0 && { key: "episodes", value: f.number(view.episodes), label: plural(t, view.episodes, ["episode watched", "episodes watched"], ["Folge gesehen", "Folgen gesehen"]) },
        time.hours > 0 && {
            key: "hours", value: f.number(time.hours), label: plural(t, time.hours, ["hour", "hours"], ["Stunde", "Stunden"]),
            note: time.days !== null ? f.days(time.days) : undefined,
        },
        view.meanScore !== null && { key: "score", value: f.score(view.meanScore), label: t("mean score", "Ø-Bewertung") },
    ].filter(Boolean) as { key: string, value: string, label: string, note?: string }[]

    return (
        <View className="overflow-hidden rounded-surface bg-sm-surface-raised px-5 pb-5 pt-6" style={glow ? { backgroundImage: glow } : undefined}>
            <View accessible accessibilityLabel={t(`${view.year}: ${f.titles(view.titles)} finished`, `${view.year}: ${f.titles(view.titles)} abgeschlossen`)}>
                <Text className="text-sm font-semibold text-sm-accent" style={TABULAR}>{view.year}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit className="mt-1 text-[64px] font-bold leading-[68px] tracking-[-1.9px]" style={TABULAR}>
                    {f.number(view.titles)}
                </Text>
                <Text className="text-[17px] font-semibold leading-[23px]">
                    {plural(t, view.titles, ["anime finished", "anime finished"], ["Anime abgeschlossen", "Anime abgeschlossen"])}
                </Text>
            </View>
            {stats.length > 0 && (
                <View className="mt-5 flex-row flex-wrap gap-x-6 gap-y-4 border-t border-sm-line pt-4">
                    {stats.map(stat => (
                        <View key={stat.key} accessible accessibilityLabel={[stat.value, stat.label, stat.note].filter(Boolean).join(" ")} className="min-w-[88px] flex-1">
                            <Text className="text-[26px] font-bold leading-[31px] tracking-[-0.5px]" style={TABULAR}>{stat.value}</Text>
                            <Text className="text-[13px] leading-[18px] text-sm-text-muted">{stat.label}</Text>
                            {!!stat.note && <Text className="text-xs leading-[17px] text-sm-text-subtle" style={TABULAR}>{stat.note}</Text>}
                        </View>
                    ))}
                </View>
            )}
            {time.hours > 0 && (
                <Text className="mt-4 text-xs leading-[17px] text-sm-text-subtle">
                    {t("The time is estimated from each title's episodes and episode length.", "Die Zeit ist geschätzt: Folgen mal Folgenlänge.")}
                </Text>
            )}
        </View>
    )
}

/** Ranked counts (genres, studios, formats) as bars; the largest in the accent, like the stats page */
export function WrappedBars({ t, title, rows, label }: { t: Translate, title: string, rows: WrappedCount[], label?: (name: string) => string }) {
    const { isTablet } = useTabletLayout()
    const f = wrappedFormats(t)
    if (!rows.length) return null
    const ratios = shareRatios(rows.map(row => row.share))
    return (
        <PhoneSection title={title}>
            <View className="gap-3 rounded-surface bg-sm-surface-raised p-4">
                {rows.map((row, index) => {
                    const name = label ? label(row.name) : row.name
                    const value = f.titles(row.count)
                    return (
                        <View key={row.name} accessible accessibilityLabel={`${name}, ${value}`} className="gap-1.5">
                            <View className="flex-row items-baseline justify-between gap-3">
                                <Text numberOfLines={1} className="min-w-0 flex-1 text-sm">{name}</Text>
                                <Text className="text-right text-[13px] text-sm-text-muted" style={TABULAR}>{value}</Text>
                            </View>
                            <View className="h-1.5 overflow-hidden rounded-full bg-sm-surface-control">
                                <Animated.View entering={barGrow(isTablet, index)} style={{ width: `${ratios[index] * 100}%`, transformOrigin: "left" }}
                                    className={cn("h-full rounded-full", index === 0 ? "bg-sm-accent-strong" : "bg-sm-text-subtle")} />
                            </View>
                        </View>
                    )
                })}
            </View>
        </PhoneSection>
    )
}

export function formatLabel(t: Translate) {
    return (format: string) => t(...(FORMAT_LABELS[format] ?? [format, format]))
}

/** One title: cover, name on one line, a detail line and an optional value at the end; a tap opens its anime page */
function TitleRow({ item, meta, rank, trailing, label }: { item: WrappedTitle, meta?: string, rank?: number, trailing?: string, label?: string }) {
    const router = useRouter()
    const fade = useImageFade()
    const cover = item.cover ? getImageUrl(item.cover) : ""
    return (
        <Pressable accessibilityRole="link" accessibilityLabel={[label, item.title, meta, trailing].filter(Boolean).join(", ")}
            onPress={() => router.push(mediaEntryHref("anime", item.id))}
            className="min-h-[76px] flex-row items-center gap-3 px-4 py-2 active:bg-sm-surface-control">
            {rank !== undefined && <Text className="w-5 text-center text-[15px] font-semibold text-sm-text-subtle" style={TABULAR}>{rank}</Text>}
            <View className="h-[60px] w-10 overflow-hidden rounded-surface-sm bg-sm-surface-control" style={item.color ? { backgroundColor: item.color } : undefined}>
                {!!cover && <Image source={cover} recyclingKey={String(item.id)} cachePolicy="memory-disk" contentFit="cover" transition={fade}
                    style={{ position: "absolute", inset: 0 }} accessibilityIgnoresInvertColors />}
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                {!!label && <Text numberOfLines={1} className="text-xs font-semibold text-sm-accent">{label}</Text>}
                <Text numberOfLines={1} className="text-[15px] font-medium">{item.title}</Text>
                {!!meta && <Text numberOfLines={1} className="text-[13px] text-sm-text-muted" style={TABULAR}>{meta}</Text>}
            </View>
            {!!trailing && <Text className="text-[17px] font-bold" style={TABULAR}>{trailing}</Text>}
        </Pressable>
    )
}

function Rows({ children }: { children: React.ReactNode }) {
    return <View className="overflow-hidden rounded-surface bg-sm-surface-raised py-1">{children}</View>
}

export function WrappedTopRated({ t, items }: { t: Translate, items: WrappedTitle[] }) {
    const f = wrappedFormats(t)
    if (!items.length) return null
    return (
        <PhoneSection title={t("Rated highest", "Am besten bewertet")}>
            <Rows>
                {items.map((item, index) => <TitleRow key={item.id} item={item} rank={index + 1} trailing={f.score(item.score)}
                    meta={item.format ? formatLabel(t)(item.format) : undefined} />)}
            </Rows>
        </PhoneSection>
    )
}

export function WrappedFirstLast({ t, first, last }: { t: Translate, first?: WrappedTitle, last?: WrappedTitle }) {
    const f = wrappedFormats(t)
    if (!first || !last) return null
    const same = first.id === last.id
    return (
        <PhoneSection title={t("First and last", "Erster und letzter Titel")}>
            <Rows>
                {same
                    ? <TitleRow item={first} label={t("First and last", "Erster und letzter")} meta={t(`Finished on ${f.day(first.completed)}`, `Abgeschlossen am ${f.day(first.completed)}`)} />
                    : <>
                        <TitleRow item={first} label={t("First", "Erster")} meta={t(`Finished on ${f.day(first.completed)}`, `Abgeschlossen am ${f.day(first.completed)}`)} />
                        <TitleRow item={last} label={t("Last", "Letzter")} meta={t(`Finished on ${f.day(last.completed)}`, `Abgeschlossen am ${f.day(last.completed)}`)} />
                    </>}
            </Rows>
        </PhoneSection>
    )
}

export function WrappedLongest({ t, item }: { t: Translate, item: WrappedTitle }) {
    const f = wrappedFormats(t)
    return (
        <PhoneSection title={t("Longest title", "Längster Titel")}>
            <Rows><TitleRow item={item} meta={f.episodes(item.episodes)} /></Rows>
        </PhoneSection>
    )
}

/** A month bar rises from the baseline, 20 ms after its left neighbour */
function monthGrow(index: number) {
    return new Keyframe({
        0: { transform: [{ scaleY: 0 }] },
        100: { transform: [{ scaleY: 1 }], easing: Easing.bezier(0.22, 1, 0.36, 1) },
    }).duration(480).delay(index * 20).reduceMotion(ReduceMotion.System)
}

export function WrappedMonths({ t, months, busiest }: { t: Translate, months: number[], busiest: number }) {
    const f = wrappedFormats(t)
    const ratios = monthRatios(months)
    const name = f.month(busiest)
    return (
        <PhoneSection title={t("Busiest month", "Stärkster Monat")}>
            <View className="gap-4 rounded-surface bg-sm-surface-raised p-4">
                <Text className="text-[15px] leading-[22px]">
                    {t(`${name} was your busiest month: ${f.titles(months[busiest])} finished.`,
                        `Im ${name} hast du am meisten abgeschlossen: ${f.titles(months[busiest])}.`)}
                </Text>
                <View className="flex-row gap-1.5">
                    {months.map((count, index) => {
                        const top = index === busiest
                        return (
                            <View key={index} accessible accessibilityLabel={`${f.month(index)}: ${f.titles(count)}`} className="min-w-0 flex-1 items-center gap-1.5">
                                <View className="h-16 w-full justify-end">
                                    {count > 0
                                        ? <Animated.View entering={monthGrow(index)} style={{ height: `${Math.max(8, ratios[index] * 100)}%`, transformOrigin: "bottom" }}
                                            className={cn("w-full rounded-[3px]", top ? "bg-sm-accent-strong" : "bg-sm-text-subtle")} />
                                        : <View className="h-0.5 w-full rounded-full bg-sm-surface-control" />}
                                </View>
                                <Text className={cn("text-[11px]", top ? "font-semibold text-sm-accent" : "text-sm-text-subtle")}>
                                    {f.month(index).charAt(0).toUpperCase()}
                                </Text>
                            </View>
                        )
                    })}
                </View>
            </View>
        </PhoneSection>
    )
}

export function WrappedManga({ t, manga }: { t: Translate, manga: { titles: number, chapters: number } }) {
    const f = wrappedFormats(t)
    return (
        <PhoneSection title="Manga">
            <Facts items={[
                { label: t("Manga finished", "Abgeschlossene Manga"), value: f.number(manga.titles) },
                ...(manga.chapters > 0 ? [{ label: t("Chapters read", "Gelesene Kapitel"), value: f.number(manga.chapters) }] : []),
            ]} />
        </PhoneSection>
    )
}
