// geschrieben nach: Plan „Updates-Seite + Benachrichtigung neue Manga-Kapitel“ (Vorbild Mihon/Kotatsu-Updates) und dem Stil von scan-summaries-phone.tsx (PhoneScreen, PhoneSection, Zeilen mit Cover); eigene Regel

import { PhoneEmpty, PhoneSection, useOfflineAware } from "@/components/shared/phone-cards"
import { LoadingRows, Notice, TextAction } from "@/components/shared/phone-kit"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { Text } from "@/components/ui/text/text"
import { appLanguageAtom, type Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { checkNewChapters, PAGE_MAX, PAGE_MIN_AGE_MS } from "@/lib/updates/chapter-check"
import { updatesLastVisitAtom, useUpdateItems } from "@/lib/updates/use-updates"
import { dayLabel, groupByDay, newCount, sinceOf, type UpdateItem, updatesView } from "@/lib/updates/updates-policy"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { Image } from "expo-image"
import { useAtom, useAtomValue } from "jotai"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * Updates: new episodes of anime on Watching/Planning and new chapters of manga on Reading, by day, newest first; what
 * came since the last visit carries a dot. Opening the page counts as a visit (the Menu's count goes to 0, the dots stay
 * until "Mark all as seen" or the next visit). Opening it also checks the manga that were not checked for an hour.
 * Everything here is local; nothing changes on AniList.
 */

function UpdateRow({ t, item, fresh, onPress }: { t: Translate, item: UpdateItem, fresh: boolean, onPress: () => void }) {
    const what = item.kind === "episode" ? t(`Episode ${item.number}`, `Folge ${item.number}`) : t(`Chapter ${item.number}`, `Kapitel ${item.number}`)
    const kind = item.kind === "episode" ? t("Anime", "Anime") : t("Manga", "Manga")
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={[item.title, what, fresh ? t("new", "neu") : ""].filter(Boolean).join(", ")} onPress={onPress}
            className="min-h-[76px] flex-row items-center gap-3.5 bg-sm-surface-raised py-2.5 pl-2.5 pr-4 active:bg-sm-surface-control">
            <View className="h-[60px] w-11 overflow-hidden rounded-[6px] bg-sm-surface-control">
                {!!item.image && <Image cachePolicy="memory-disk" source={{ uri: item.image }} style={{ width: 44, height: 60 }} contentFit="cover" />}
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={2} className="font-semibold">{item.title}</Text>
                <Text className="text-[13px] text-sm-text-muted">{`${what} · ${kind}`}</Text>
            </View>
            {fresh && <View accessibilityElementsHidden className="h-2 w-2 rounded-full bg-sm-accent" />}
        </Pressable>
    )
}

export function UpdatesPhone() {
    const t = useTr()
    const language = useAtomValue(appLanguageAtom)
    const router = useRouter()
    const mangaEnabled = !!useServerStatus()?.settings?.library?.enableManga
    const offlineAware = useOfflineAware()
    const { items, loading, failed, now, refetch } = useUpdateItems()
    const [lastVisit, setLastVisit] = useAtom(updatesLastVisitAtom)
    // the dots compare with the visit before this one; opening the page is the new visit
    const [since, setSince] = React.useState(() => sinceOf(lastVisit, Date.now()))
    React.useEffect(() => {
        setLastVisit(Date.now())
        // only on opening
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    // the check of this visit runs from the start; without manga it never shows. A check that could not start (the
    // manga list did not load) counts as a failed part of the page; one source that fails is only skipped.
    const [checking, setChecking] = React.useState(true)
    const [checkFailed, setCheckFailed] = React.useState(false)
    const check = React.useCallback(() => !mangaEnabled ? Promise.resolve()
        : checkNewChapters({ max: PAGE_MAX, minAgeMs: PAGE_MIN_AGE_MS, notify: false })
            .then(() => setCheckFailed(false), () => setCheckFailed(true))
            .finally(() => setChecking(false)), [mangaEnabled])
    React.useEffect(() => {
        void check()
    }, [check])
    // pull to refresh and "Try again": the schedule and the list again (read only) and the chapter check
    const reload = React.useCallback(() => {
        setChecking(true)
        return Promise.all([refetch(), check()])
    }, [refetch, check])
    const [retrying, setRetrying] = React.useState(false)
    const retry = () => {
        setRetrying(true)
        void reload().finally(() => setRetrying(false))
    }
    const view = updatesView({ count: items.length, loading: loading || retrying, failed: failed || checkFailed })

    const fresh = newCount(items, since)
    const groups = React.useMemo(() => groupByDay(items), [items])
    const markSeen = () => {
        const at = Date.now()
        setSince(at)
        setLastVisit(at)
    }
    const subtitle = checking && mangaEnabled ? t("Looking for new chapters…", "Suche nach neuen Kapiteln…")
        : fresh > 0 ? t(`${fresh} new since your last visit`, `${fresh} neu seit deinem letzten Besuch`)
            : view.body === "failed" ? undefined
                : t("Nothing new since your last visit", "Nichts Neues seit deinem letzten Besuch")
    const open = (item: UpdateItem) => router.push(item.kind === "episode" ? `/entry?id=${item.mediaId}` : `/manga/entry?id=${item.mediaId}`)
    const tryAgain = <TextAction label={t("Try again", "Erneut versuchen")} onPress={retry} />

    return (
        <PhoneScreen title={t("Updates", "Updates")} subtitle={subtitle} onRefresh={reload}
            actions={<TextAction label={t("Mark all as seen", "Alle als gesehen markieren")} onPress={markSeen} disabled={fresh === 0} />}>
            {view.notice && <Notice text={offlineAware(["Some updates could not be loaded.", "Einige Updates konnten nicht geladen werden."],
                ["No internet connection, so some updates could not be loaded.", "Keine Internetverbindung, deshalb konnten einige Updates nicht geladen werden."])}>
                {tryAgain}
            </Notice>}
            {view.body === "loading" ? <LoadingRows label={t("Loading updates", "Updates werden geladen")} count={4} />
                : view.body === "failed" ? (
                    <Notice text={offlineAware(["Updates could not be loaded.", "Updates konnten nicht geladen werden."],
                        ["No internet connection, so updates could not be loaded.", "Keine Internetverbindung, deshalb konnten die Updates nicht geladen werden."])}>
                        {tryAgain}
                    </Notice>
                ) : view.body === "empty" ? (
                    <PhoneEmpty title={t("No new episodes or chapters this week", "Diese Woche keine neuen Folgen oder Kapitel")}
                        text={t("New episodes of anime you watch or plan to watch and new chapters of manga you read show up here.",
                            "Hier erscheinen neue Folgen der Anime, die du schaust oder planst, und neue Kapitel der Manga, die du liest.")} />
                ) : groups.map(group => (
                    <PhoneSection key={group.day} title={dayLabel(group.day, now, language)} count={group.items.length}>
                        <View className="gap-0.5 overflow-hidden rounded-surface">
                            {group.items.map(item => <UpdateRow key={item.key} t={t} item={item} fresh={item.at > since} onPress={() => open(item)} />)}
                        </View>
                    </PhoneSection>
                ))}
        </PhoneScreen>
    )
}
