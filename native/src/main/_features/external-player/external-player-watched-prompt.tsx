import { useGetAnimeEntry, useUpdateAnimeEntryProgress } from "@/api/hooks/anime_entries.hooks"
import { useIncognito } from "@/api/hooks/app-switches.hooks"
import { Button } from "@/components/ui/button/button"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { type FinishedTrip, shouldAskWatched, tripOnAppState } from "@/lib/external-player-link/watched-after-player"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import React from "react"
import { AppState } from "react-native"

/*
 * The question after another player app (lib/external-player-link/watched-after-player.ts): back in the app, "Mark
 * episode N as watched?" with the anime's title; "Mark as watched" sets the list progress the way the episode menu's
 * "Mark as watched" does. Mounted once in the main layout, so it shows over the page or the in-app player.
 */
export function ExternalPlayerWatchedPrompt() {
    const t = useTr()
    const serverStatus = useServerStatus()
    const incognito = useIncognito()
    // `asked`: the question is up (decided once per trip); `sending`: answered, the trip ends when the progress is saved
    const [trip, setTrip] = React.useState<(FinishedTrip & { asked?: boolean }) | null>(null)
    const [sending, setSending] = React.useState(false)

    React.useEffect(() => {
        const listener = AppState.addEventListener("change", state => {
            const finished = tripOnAppState(state, Date.now())
            if (finished) setTrip(finished)
        })
        return () => listener.remove()
    }, [])

    const { data: entry, isFetching } = useGetAnimeEntry(trip ? trip.mediaId : undefined)
    const { mutate: updateProgress, isPending } = useUpdateAnimeEntryProgress(trip?.mediaId, trip?.episodeNumber ?? 0, false)

    // the entry as it is now (the list may have moved meanwhile) decides, once per trip; nothing to ask lets the trip go
    if (trip && !trip.asked && !isFetching) {
        const ask = !!entry && entry.mediaId === trip.mediaId && shouldAskWatched({
            episodeNumber: trip.episodeNumber,
            progress: entry.listData?.progress ?? 0,
            awayMs: trip.awayMs,
            autoProgress: serverStatus?.settings?.library?.autoUpdateProgress === true,
            incognito,
        })
        setTrip(ask ? { ...trip, asked: true } : null)
    }

    const close = () => setTrip(null)

    const media = entry?.media
    return (
        <Sheet title={t(`Mark episode ${trip?.episodeNumber ?? ""} as watched?`, `Folge ${trip?.episodeNumber ?? ""} als gesehen markieren?`)}
            open={!!trip?.asked && !sending} onOpenChange={next => !next && close()}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={close}>{t("Not now", "Jetzt nicht")}</Button>
                <Button intent="primary" wrapperClassName="flex-1" disabled={isPending} onPress={() => {
                    if (!trip) return
                    setSending(true)
                    updateProgress({ episodeNumber: trip.episodeNumber, mediaId: trip.mediaId, totalEpisodes: media?.episodes || 0, malId: media?.idMal || undefined }, {
                        onSuccess: () => toast.success(t("Marked as watched", "Als gesehen markiert")),
                        onSettled: () => {
                            setSending(false)
                            close()
                        },
                    })
                }}>{t("Mark as watched", "Als gesehen markieren")}</Button>
            </>}>
            <Text className="text-[15px] leading-[23px] text-sm-text-muted">
                {media?.title?.userPreferred
                    ? t(`${media.title.userPreferred} played in another app, so its progress was not saved.`, `${media.title.userPreferred} lief in einer anderen App, darum wurde der Fortschritt nicht gespeichert.`)
                    : t("The episode played in another app, so its progress was not saved.", "Die Folge lief in einer anderen App, darum wurde der Fortschritt nicht gespeichert.")}
            </Text>
        </Sheet>
    )
}
