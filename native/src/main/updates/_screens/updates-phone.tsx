// geschrieben nach: Plan „Updates-Seite + Benachrichtigung neue Manga-Kapitel“ (Vorbild Mihon/Kotatsu-Updates) und dem Stil von scan-summaries-phone.tsx (PhoneScreen, PhoneSection, Zeilen mit Cover); eigene Regel

import { PhoneEmpty, PhoneSection } from "@/components/shared/phone-cards"
import { LoadingRows, TextAction } from "@/components/shared/phone-kit"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { Text } from "@/components/ui/text/text"
import { appLanguageAtom, type Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { checkNewChapters, PAGE_MAX, PAGE_MIN_AGE_MS } from "@/lib/updates/chapter-check"
import { updatesLastVisitAtom, useUpdateItems } from "@/lib/updates/use-updates"
import { dayLabel, groupByDay, newCount, sinceOf, type UpdateItem } from "@/lib/updates/updates-policy"
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
                {!!item.image && <Image source={{ uri: item.image }} style={{ width: 44, height: 60 }} contentFit="cover" />}
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
    const german = useAtomValue(appLanguageAtom) === "de"
    const router = useRouter()
    const mangaEnabled = !!useServerStatus()?.settings?.library?.enableManga
    const { items, loading, now } = useUpdateItems()
    const [lastVisit, setLastVisit] = useAtom(updatesLastVisitAtom)
    // the dots compare with the visit before this one; opening the page is the new visit
    const [since, setSince] = React.useState(() => sinceOf(lastVisit, Date.now()))
    React.useEffect(() => {
        setLastVisit(Date.now())
        // only on opening
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    // the check of this visit runs from the start; without manga it never shows
    const [checking, setChecking] = React.useState(true)
    React.useEffect(() => {
        if (!mangaEnabled) return
        let alive = true
        void checkNewChapters({ max: PAGE_MAX, minAgeMs: PAGE_MIN_AGE_MS, notify: false })
            .catch(() => 0)
            .finally(() => {
                if (alive) setChecking(false)
            })
        return () => {
            alive = false
        }
    }, [mangaEnabled])

    const fresh = newCount(items, since)
    const groups = React.useMemo(() => groupByDay(items), [items])
    const markSeen = () => {
        const at = Date.now()
        setSince(at)
        setLastVisit(at)
    }
    const subtitle = checking && mangaEnabled ? t("Looking for new chapters…", "Suche nach neuen Kapiteln…")
        : fresh > 0 ? t(`${fresh} new since your last visit`, `${fresh} neu seit deinem letzten Besuch`)
            : t("Nothing new since your last visit", "Nichts Neues seit deinem letzten Besuch")
    const open = (item: UpdateItem) => router.push(item.kind === "episode" ? `/entry?id=${item.mediaId}` : `/manga/entry?id=${item.mediaId}`)

    return (
        <PhoneScreen title={t("Updates", "Updates")} subtitle={subtitle}
            actions={<TextAction label={t("Mark all as seen", "Alle als gesehen markieren")} onPress={markSeen} disabled={fresh === 0} />}>
            {loading && items.length === 0 ? <LoadingRows label={t("Loading updates", "Updates werden geladen")} count={4} />
                : items.length === 0 ? (
                    <PhoneEmpty title={t("No new episodes or chapters this week", "Diese Woche keine neuen Folgen oder Kapitel")}
                        text={t("New episodes of anime you watch or plan to watch and new chapters of manga you read show up here.",
                            "Hier erscheinen neue Folgen der Anime, die du schaust oder planst, und neue Kapitel der Manga, die du liest.")} />
                ) : groups.map(group => (
                    <PhoneSection key={group.day} title={dayLabel(group.day, now, german)} count={group.items.length}>
                        <View className="gap-0.5 overflow-hidden rounded-surface">
                            {group.items.map(item => <UpdateRow key={item.key} t={t} item={item} fresh={item.at > since} onPress={() => open(item)} />)}
                        </View>
                    </PhoneSection>
                ))}
        </PhoneScreen>
    )
}
