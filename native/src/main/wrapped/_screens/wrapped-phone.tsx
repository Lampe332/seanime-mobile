import { useGetRawAnimeCollection } from "@/api/hooks/anilist.hooks"
import { useGetRawAnilistMangaCollection } from "@/api/hooks/manga.hooks"
import { ChipRow, PhoneEmpty, useOfflineAware } from "@/components/shared/phone-cards"
import { LoadingRows, Notice, TextAction } from "@/components/shared/phone-kit"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Heading, Muted } from "@/components/ui/text/text"
import { plural, type Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { useThemeColors } from "@/lib/theme/appearance"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { getWrappedView, type WrappedView, wrappedUndated, wrappedYears } from "@/main/lists/_lib/wrapped"
import {
    formatLabel,
    WrappedBars,
    WrappedFirstLast,
    WrappedLongest,
    WrappedManga,
    WrappedMonths,
    WrappedOverview,
    WrappedTopRated,
} from "@/main/wrapped/_components/wrapped-cards"
import { WrappedShareSection } from "@/main/wrapped/_components/wrapped-share-section"
import { intoColumns, pickYear } from "@/main/wrapped/_lib/wrapped-phone"
import { useFocusEffect } from "expo-router"
import ArrowLeft from "lucide-react-native/icons/arrow-left"
import React from "react"
import { BackHandler, View } from "react-native"

/**
 * "Your year" (Lists › the sparkles button, or the card on the stats): what the user finished in one year, counted from their
 * own AniList lists by lists/_lib/wrapped.ts. Every card shows only with data; the shareable image follows at the end.
 */
export function WrappedPhone() {
    const t = useTr()
    const router = useRouter()
    const offlineAware = useOfflineAware()
    const serverStatus = useServerStatus()
    const hasUser = !!serverStatus?.user
    const enableManga = !!serverStatus?.settings?.library?.enableManga
    const showAdult = !!serverStatus?.settings?.anilist?.enableAdultContent
    const animeQuery = useGetRawAnimeCollection()
    const mangaQuery = useGetRawAnilistMangaCollection()
    const animeLists = animeQuery.data?.MediaListCollection?.lists
    const mangaLists = enableManga ? mangaQuery.data?.MediaListCollection?.lists : undefined

    const years = React.useMemo(() => wrappedYears(animeLists, mangaLists, { showAdult }), [animeLists, mangaLists, showAdult])
    const [chosen, setChosen] = React.useState<number | null>(null)
    const year = pickYear(years, chosen)
    const view = React.useMemo(() => year === null ? null : getWrappedView(animeLists, mangaLists, year, { showAdult }),
        [animeLists, mangaLists, year, showAdult])
    const undated = React.useMemo(() => wrappedUndated(animeLists, { showAdult }), [animeLists, showAdult])

    // back to where the page was opened from (the lists or their stats); opened from outside, to the lists
    const goBack = React.useCallback(() => {
        if (router.canGoBack()) router.back()
        else router.replace("/lists")
    }, [router])
    useFocusEffect(React.useCallback(() => {
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            goBack()
            return true
        })
        return () => sub.remove()
    }, [goBack]))
    // the route stays mounted behind the hidden tab bar; leaving it builds the page anew at the top (PhoneScreen has no
    // scroll handle), so it opens at its start again, not at the share image. A year picked on a chip keeps the position.
    const [visit, setVisit] = React.useState(0)
    useFocusEffect(React.useCallback(() => () => setVisit(value => value + 1), []))

    const loading = hasUser && animeQuery.isPending
    const failed = hasUser && animeQuery.isError && !animeQuery.data
    const refresh = () => Promise.all([animeQuery.refetch(), enableManga ? mangaQuery.refetch() : null])

    return (
        <PhoneScreen key={visit} onRefresh={hasUser ? refresh : undefined}>
            <View className="gap-1">
                <BackRow label={t("Back", "Zurück")} onPress={goBack} />
                <Heading>{t("Your year", "Dein Jahr")}</Heading>
                <Muted>{view && !view.empty
                    ? t(`What you finished in ${view.year}, counted from your lists.`, `Was du ${view.year} abgeschlossen hast, gezählt aus deinen Listen.`)
                    : t("What you finished in a year, counted from your lists.", "Was du in einem Jahr abgeschlossen hast, gezählt aus deinen Listen.")}</Muted>
            </View>
            {!hasUser ? <PhoneEmpty title={t("No account connected", "Kein Konto verbunden")}
                    text={t("Your year is counted from your AniList lists. Connect an account to see it.",
                        "Dein Jahr wird aus deinen AniList-Listen gezählt. Verbinde ein Konto, um es zu sehen.")} />
                : failed ? <Notice text={offlineAware(["Your lists could not be loaded.", "Deine Listen konnten nicht geladen werden."],
                        ["No internet connection, so your lists could not be loaded.", "Keine Internetverbindung, deshalb konnten deine Listen nicht geladen werden."])}>
                        <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => void animeQuery.refetch()} />
                    </Notice>
                    : loading ? <View className="gap-6"><LoadingRows label={t("Loading your year", "Dein Jahr wird geladen")} count={3} />
                            <View className="h-[216px] rounded-surface bg-sm-surface-raised" /></View>
                        : (!view || view.empty) && undated > 0 ? <PhoneEmpty title={t("No completion dates yet", "Noch keine Abschluss-Daten")}
                                text={`${undatedText(t, undated)} ${t("Your year counts a title once its completion date is set in the list entry.",
                                    "Dein Jahr zählt einen Titel, sobald im Listeneintrag sein Abschluss-Datum steht.")}`} />
                        : !view || view.empty ? <PhoneEmpty title={t("Nothing finished yet", "Noch nichts abgeschlossen")}
                                text={t("Your year appears once an anime on your list is marked as completed.",
                                    "Dein Jahr erscheint, sobald ein Anime auf deiner Liste als abgeschlossen markiert ist.")} />
                            : <>
                                {view.years.length > 1 && <ChipRow label={t("Year", "Jahr")} selected={[String(view.year)]}
                                    chips={view.years.map(value => ({ value: String(value), label: String(value) }))}
                                    onSelect={value => setChosen(Number(value))} />}
                                <WrappedContent key={view.year} t={t} view={view} />
                            </>}
        </PhoneScreen>
    )
}

/** Finished titles without a completion date belong to no year; the page says how many it leaves out */
function undatedText(t: Translate, count: number) {
    return plural(t, count,
        ["1 finished title has no completion date and is not counted.", "{0} finished titles have no completion date and are not counted."],
        ["1 abgeschlossener Titel hat kein Abschluss-Datum und wird nicht gezählt.", "{0} abgeschlossene Titel haben kein Abschluss-Datum und werden nicht gezählt."])
}

function BackRow({ label, onPress }: { label: string, onPress: () => void }) {
    const colors = useThemeColors()
    return <View className="-ml-2 min-h-14 flex-row items-center">
        <Button intent="icon" accessibilityLabel={label} onPress={onPress}><ArrowLeft size={22} color={colors.smText} /></Button>
    </View>
}

/** The overview across the width, the other cards under it: one column on the phone, two side by side on a wide tablet */
function WrappedContent({ t, view }: { t: Translate, view: WrappedView }) {
    const { isTablet, twoPanes } = useTabletLayout()
    const columns = twoPanes ? 2 : 1
    const cards = [
        view.genres.length > 0 && <WrappedBars key="genres" t={t} title={t("Top genres", "Top-Genres")} rows={view.genres} />,
        view.studios.length > 0 && <WrappedBars key="studios" t={t} title={t("Top studios", "Top-Studios")} rows={view.studios} />,
        view.topRated.length > 0 && <WrappedTopRated key="rated" t={t} items={view.topRated} />,
        !!view.first && !!view.last && <WrappedFirstLast key="first-last" t={t} first={view.first} last={view.last} />,
        view.busiestMonth !== null && <WrappedMonths key="months" t={t} months={view.months} busiest={view.busiestMonth} />,
        view.formats.length > 0 && <WrappedBars key="formats" t={t} title={t("Formats", "Formate")} rows={view.formats} label={formatLabel(t)} />,
        // with a single title the longest is that title again
        !!view.longest && view.titles > 1 && view.longest.episodes > 1 && <WrappedLongest key="longest" t={t} item={view.longest} />,
        !!view.manga && <WrappedManga key="manga" t={t} manga={view.manga} />,
    ].filter(Boolean) as React.ReactElement[]

    return (
        <View className={cn("w-full gap-6 self-center", columns > 1 ? "max-w-[1040px]" : isTablet && "max-w-[640px]")}>
            <View className="gap-2">
                <WrappedOverview t={t} view={view} />
                {view.undated > 0 && <Muted>{undatedText(t, view.undated)}</Muted>}
            </View>
            {columns > 1
                ? <View className="flex-row items-start gap-6">
                    {intoColumns(cards, columns).map((column, index) => <View key={index} className="min-w-0 flex-1 gap-6">{column}</View>)}
                </View>
                : cards}
            <WrappedShareSection view={view} />
        </View>
    )
}
