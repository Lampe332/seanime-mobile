import type { AL_BaseAnime, Onlinestream_Episode } from "@/api/generated/types"
import { useGetMobileOfflineSnapshot, useMobileOfflineBatch } from "@/api/hooks/mobile_offline.hooks"
import { PickRow, RowGroup } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { successFeedback } from "@/lib/feedback"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { askForDownloadNotices } from "@/main/android-downloads/_lib/download-notifications"
import { batchRequest, downloadPresets, episodeWord, storedEpisodes } from "@/main/android-downloads/_lib/offline-library"
import { Image } from "expo-image"
import Download from "lucide-react-native/icons/download"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * "Download" on the online stream page (web onlinestream/_containers/episode-download-picker.tsx): a button and a sheet
 * to save one episode, the season or the missing ones on the phone. Quick selections Season / From ep. N / This episode,
 * every episode as a check row, saved or queued ones are skipped (shown as "Saved"). Queued in the Go server
 * (POST /mobile-offline/batch), which resolves each source only once a slot is free and keeps running in the background.
 * Mounted by the online stream screen (E2 2.15) with the provider, server, quality and audio it plays with.
 */

const sameSet = (a: Set<number>, b: number[]) => a.size === b.length && b.every(n => a.has(n))

export function EpisodeDownloadButton({ media, episodes, provider, server, quality, dubbed, currentEpisode }: {
    media: AL_BaseAnime
    episodes?: Onlinestream_Episode[]
    provider?: string | null
    server?: string | null
    quality?: string | null
    dubbed: boolean
    currentEpisode: number | null
}) {
    const t = useTr()
    const router = useRouter()
    const [open, setOpen] = React.useState(false)
    const [selected, setSelected] = React.useState<Set<number>>(new Set())
    const [existing, setExisting] = React.useState<Set<number>>(new Set())
    const { data: snapshot } = useGetMobileOfflineSnapshot()
    const { mutate: queue, isPending: busy } = useMobileOfflineBatch()
    const all = React.useMemo(() => [...(episodes ?? [])].sort((a, b) => a.number - b.number), [episodes])
    const available = all.filter(episode => !existing.has(episode.number)).map(episode => episode.number)
    const presets = downloadPresets(available, currentEpisode)

    const show = () => {
        // what is saved or queued when the sheet opens; the server deduplicates submissions anyway
        const stored = storedEpisodes(snapshot?.items, media.id, dubbed)
        setExisting(stored)
        setSelected(new Set(all.filter(episode => !stored.has(episode.number)).map(episode => episode.number)))
        setOpen(true)
    }

    const submit = () => {
        if (!provider || !selected.size) return
        queue(batchRequest(media, all, selected, { provider, server: server ?? null, quality: quality ?? null, dubbed }), {
            onSuccess: added => {
                if (added) successFeedback()
                toast.success(added
                    ? t(`${added} ${added === 1 ? "episode" : "episodes"} queued`, `${added} ${added === 1 ? "Folge" : "Folgen"} eingeplant`)
                    : t("All selected episodes are already queued or saved", "Alle gewählten Folgen sind bereits eingeplant oder gespeichert"),
                { action: { label: "Downloads", onClick: () => router.push("/android-downloads") } })
                setOpen(false)
                // "finished" / "failed" notices need the permission (Android 13+); asked when episodes are queued
                void askForDownloadNotices().catch(() => undefined)
            },
        })
    }

    const toggle = (number: number) => setSelected(previous => {
        const next = new Set(previous)
        if (next.has(number)) next.delete(number)
        else next.add(number)
        return next
    })
    const from = currentEpisode || 1
    const chips = [
        { id: "season", label: t("Season", "Staffel"), numbers: presets.season },
        { id: "from", label: t(`From ep. ${from}`, `Ab Folge ${from}`), numbers: presets.from },
        ...(currentEpisode !== null ? [{ id: "this", label: t("This episode", "Diese Folge"), numbers: presets.this }] : []),
    ]
    const cover = media.coverImage?.large || media.coverImage?.medium

    return <>
        {/* `.mobile-source-line [data-download-season]`: a raised 48dp block with --sm-radius-sm, 1rem to the sides, .875rem semibold;
            the UI Button's icon is 1em (14dp) */}
        <Button intent="secondary" disabled={!provider || !all.length} onPress={show} leftIcon={<Download size={14} color={colors.smText} />}
            className="rounded-[0.75rem] bg-sm-surface-raised px-4 active:bg-sm-surface-control" labelClassName="text-sm"
            accessibilityLabel={t("Download season / episodes", "Staffel / Folgen herunterladen")}>
            {t("Download", "Download")}
        </Button>
        <Sheet compact title={t("Download episodes", "Folgen herunterladen")} open={open} onOpenChange={setOpen}
            footer={<Button wrapperClassName="flex-1" disabled={!selected.size || busy} loading={busy} onPress={submit}>
                {busy ? t("Queuing …", "Wird eingeplant …")
                    : t(`Download ${selected.size} ${selected.size === 1 ? "episode" : "episodes"}`, `${selected.size} ${selected.size === 1 ? "Folge" : "Folgen"} herunterladen`)}
            </Button>}>
            <View className="gap-4">
                <View className="flex-row items-center gap-3">
                    {!!cover && <Image source={cover} contentFit="cover" style={{ width: 48, height: 68, borderRadius: 8 }} accessibilityIgnoresInvertColors />}
                    <View className="min-w-0 flex-1 gap-0.5">
                        <Text numberOfLines={2} className="text-[15px] font-semibold">{media.title?.userPreferred || media.title?.romaji}</Text>
                        <Muted className="text-[13px]">{[`${all.length} ${episodeWord(all.length, t)}`, dubbed ? "Dub" : t("Original audio", "Originalton"), provider, quality || "Auto"].filter(Boolean).join(" · ")}</Muted>
                    </View>
                </View>
                <View className="flex-row flex-wrap gap-2" accessibilityLabel={t("Quick selection", "Schnellauswahl")}>
                    {chips.map(chip => {
                        const on = sameSet(selected, chip.numbers)
                        return <Pressable key={chip.id} accessibilityRole="togglebutton" accessibilityState={{ checked: on, disabled: busy || !chip.numbers.length }}
                            disabled={busy || !chip.numbers.length} onPress={() => setSelected(new Set(chip.numbers))}
                            className={cn("min-h-12 justify-center rounded-full px-4", on ? "bg-sm-accent-soft" : "bg-sm-surface-raised active:bg-sm-surface-control", !chip.numbers.length && "opacity-45")}>
                            <Text className={cn("text-sm", on ? "font-semibold text-sm-accent" : "font-medium text-sm-text-muted")}>{chip.label}</Text>
                        </Pressable>
                    })}
                </View>
                <View className="flex-row items-center justify-between">
                    <Text className="text-[15px] font-semibold">{t("Episodes", "Folgen")}</Text>
                    <Button intent="text" disabled={busy || !selected.size} onPress={() => setSelected(new Set())}>{t("Clear selection", "Auswahl leeren")}</Button>
                </View>
                <RowGroup>
                    {all.map(episode => existing.has(episode.number)
                        ? <View key={episode.number} className="min-h-[52px] flex-row items-center gap-3.5 bg-sm-surface-raised px-4 py-2.5 opacity-70">
                            <Text className="w-[22px] text-center text-sm text-sm-text-subtle" style={{ fontVariant: ["tabular-nums"] }}>{episode.number}</Text>
                            <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-sm-text-muted">{episode.title || episode.metadata?.episodeTitle || `${t("Episode", "Folge")} ${episode.number}`}</Text>
                            <Text className="text-[13px] text-sm-accent">{t("Saved", "Gespeichert")}</Text>
                        </View>
                        : <PickRow key={episode.number} checked={selected.has(episode.number)} onPress={() => toggle(episode.number)}
                            label={`${episode.number} · ${episode.title || episode.metadata?.episodeTitle || `${t("Episode", "Folge")} ${episode.number}`}`} />)}
                </RowGroup>
                <Muted accessibilityLiveRegion="polite" className="text-[13px]">
                    {selected.size} {t("selected", "ausgewählt")} · {t("Saved episodes are skipped, the queue keeps running in the background.", "Gespeicherte Folgen werden übersprungen, die Warteschlange läuft im Hintergrund weiter.")}
                </Muted>
            </View>
        </Sheet>
    </>
}
