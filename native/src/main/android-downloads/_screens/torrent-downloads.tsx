import type { TorrentClient_Torrent } from "@/api/generated/types"
import { useGetActiveTorrentList, useTorrentClientAction } from "@/api/hooks/torrent_client.hooks"
import { PhoneEmpty, PhoneSection } from "@/components/shared/phone-cards"
import { ActionRow, Facts, Notice, RowGroup } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { type TorrentGroupKey, torrentGroups } from "@/main/android-downloads/_lib/torrent-groups"
import { peopleText, removeNote, torrentStateOf, torrentStateText } from "@/main/android-downloads/_lib/torrent-state"
import Pause from "lucide-react-native/icons/pause"
import Play from "lucide-react-native/icons/play"
import React from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import { ProgressLine } from "./downloads-parts"

/*
 * Torrents tab of Downloads (web android-downloads/torrent-downloads.tsx): the app's own torrent client with progress,
 * pause and resume, and removing a torrent with or without its files. Opened from the torrent sheet after "Download".
 */

const stateText = (torrent: TorrentClient_Torrent, t: Translate) => torrentStateText(torrentStateOf(torrent), t)

/** The server's English "3 hours left" / "1 minutes left" / "No ETA" as a short phrase in the app language. */
export function etaLabel(eta: string, t: Translate, withLeft = true) {
    const m = eta.match(/^(\d+) (hour|minute|second)s? left$/)
    if (!m) return ""
    const n = Number(m[1])
    const unit = m[2] as "hour" | "minute" | "second"
    const en = { hour: n === 1 ? "1 hour" : `${n} hours`, minute: n === 1 ? "1 minute" : `${n} minutes`, second: `${n} s` }[unit]
    const de = { hour: `${n} Std.`, minute: `${n} Min.`, second: `${n} s` }[unit]
    return withLeft ? t(`${en} left`, `noch ${de}`) : t(en, de)
}

function rowMeta(torrent: TorrentClient_Torrent, t: Translate) {
    const state = torrentStateOf(torrent)
    if (state === "seeding" || state === "done") return [torrentStateText(state, t).short, torrent.size].join(" · ")
    if (state === "downloading") {
        return [`${Math.round(torrent.progress * 100)} %`, torrent.size, `↓ ${torrent.downSpeed}`, etaLabel(torrent.eta, t)].filter(Boolean).join(" · ")
    }
    return [torrentStateText(state, t).short, `${Math.round(torrent.progress * 100)} %`, torrent.size].join(" · ")
}

/** Who the torrent is connected to: only while it loads or seeds, a paused or waiting one has nobody */
function peopleFacts(torrent: TorrentClient_Torrent, t: Translate) {
    const state = torrentStateOf(torrent)
    if (state === "seeding") return [
        { label: t("Sharing with", "Geteilt mit"), value: peopleText(torrent.peers, t) },
        { label: t("Upload speed", "Upload-Tempo"), value: `↑ ${torrent.upSpeed}` },
    ]
    if (state !== "downloading" && state !== "preparing") return []
    return [
        { label: t("Speed", "Tempo"), value: `↓ ${torrent.downSpeed} · ↑ ${torrent.upSpeed}` },
        ...(etaLabel(torrent.eta, t) ? [{ label: t("Time left", "Restzeit"), value: etaLabel(torrent.eta, t, false) }] : []),
        {
            label: t("Connected to", "Verbunden mit"), value: peopleText(torrent.peers, t),
            note: torrent.seeds === 1 ? t("1 of them has the whole file", "1 davon hat die ganze Datei")
                : t(`${torrent.seeds} of them have the whole file`, `${torrent.seeds} davon haben die ganze Datei`),
        },
    ]
}

/**
 * `active`: the Downloads tab is in front. The list is asked for every 1.5 s, and a visited tab stays mounted behind the
 * others (page-transition.tsx), so without it the app kept asking for as long as it ran once this tab had been opened.
 */
export function TorrentDownloads({ active }: { active: boolean }) {
    const t = useTr()
    const { data, isLoading, isError, refetch } = useGetActiveTorrentList(active, "", "")
    const { mutate: act, isPending } = useTorrentClientAction()
    const [openHash, setOpenHash] = React.useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = React.useState(false)
    const torrents = data ?? []
    const open = torrents.find(torrent => torrent.hash === openHash) ?? null

    const close = () => {
        setOpenHash(null)
        setConfirmDelete(false)
    }
    const run = (torrent: TorrentClient_Torrent, action: "pause" | "resume" | "remove" | "remove-keep-files") => {
        act({ hash: torrent.hash, action }, { onSuccess: () => { if (action === "remove" || action === "remove-keep-files") close() } })
    }

    if (isError) return <Notice text={t("The torrent list could not be loaded.", "Die Torrent-Liste konnte nicht geladen werden.")}>
        <Button intent="text" onPress={() => void refetch()}>{t("Try again", "Erneut versuchen")}</Button>
    </Notice>
    if (isLoading) return <View className="items-center py-12"><ActivityIndicator color={colors.smTextMuted} accessibilityLabel={t("Loading your torrents …", "Deine Torrents werden geladen …")} /></View>

    // only the torrents that load count as downloading (4.2.0 E: five paused ones at 100 % said "Downloading 5")
    const titles: Record<TorrentGroupKey, string> = {
        downloading: t("Downloading", "Wird geladen"),
        waiting: t("Waiting", "Wartet"),
        stopped: t("Stopped", "Angehalten"),
        done: t("Done", "Fertig"),
    }
    const groups = torrentGroups(torrents).map(group => ({ ...group, title: titles[group.key] }))

    return <View className="gap-6">
        {torrents.length === 0 && <PhoneEmpty title={t("No torrents", "Keine Torrents")}
            text={t("Open an anime and tap ⋮ → Download a torrent. It is saved to your library folder and shows up here while it loads.",
                "Öffne einen Anime und tippe auf ⋮ → „Torrent herunterladen“. Er landet in deinem Bibliotheksordner und erscheint hier, solange er lädt.")} />}
        {groups.map(group => <PhoneSection key={group.key} title={group.title} count={group.rows.length}>
            <RowGroup>
                {group.rows.map(torrent => <View key={torrent.hash} className="flex-row items-center bg-sm-surface-raised pr-1">
                    <Pressable accessibilityRole="button" onPress={() => setOpenHash(torrent.hash)} className="min-h-[72px] min-w-0 flex-1 justify-center gap-0.5 px-3 py-2.5 active:bg-sm-surface-control">
                        <Text className="text-[15px] font-semibold leading-5" numberOfLines={2}>{torrent.name}</Text>
                        {group.key !== "done" && <ProgressLine value={torrent.progress * 100} label={t(`${torrent.name} download`, `Download ${torrent.name}`)} />}
                        <Muted className="text-[13px]" style={{ fontVariant: ["tabular-nums"] }}>{rowMeta(torrent, t)}</Muted>
                    </Pressable>
                    {group.key !== "done" && (stateText(torrent, t).action === "resume"
                        ? <Button intent="icon" disabled={isPending} onPress={() => run(torrent, "resume")} accessibilityLabel={t(`Resume ${torrent.name}`, `${torrent.name} fortsetzen`)}>
                            <Play size={20} color={colors.smTextMuted} />
                        </Button>
                        : <Button intent="icon" disabled={isPending} onPress={() => run(torrent, "pause")} accessibilityLabel={t(`Pause ${torrent.name}`, `${torrent.name} pausieren`)}>
                            <Pause size={20} color={colors.smTextMuted} />
                        </Button>)}
                </View>)}
            </RowGroup>
        </PhoneSection>)}

        <Sheet title={open?.name ?? ""} open={!!open} onOpenChange={value => { if (!value) close() }}
            footer={open && (confirmDelete
                ? <>
                    <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setConfirmDelete(false)}>{t("Keep", "Behalten")}</Button>
                    <Button intent="danger" wrapperClassName="flex-1" disabled={isPending} onPress={() => run(open, "remove")}>{t("Delete files", "Dateien löschen")}</Button>
                </>
                : <Button intent="secondary" wrapperClassName="flex-1" disabled={isPending} onPress={() => run(open, stateText(open, t).action)}>
                    {stateText(open, t).actionLabel}
                </Button>)}>
            {open && <View className="gap-4">
                <View accessibilityRole="summary" className="gap-1 rounded-surface bg-sm-surface-raised px-4 py-3.5">
                    <Text className="text-[17px] font-semibold leading-6">{stateText(open, t).title}</Text>
                    <Text className="text-[15px] leading-[22px] text-sm-text-muted">{stateText(open, t).note}</Text>
                </View>
                <Facts items={[
                    { label: t("Progress", "Fortschritt"), value: `${Math.round(open.progress * 100)} % · ${open.size}` },
                    ...peopleFacts(open, t),
                    ...(open.contentPath ? [{ label: t("Saved to", "Speicherort"), value: open.contentPath }] : []),
                    ...(open.error ? [{ label: t("Error", "Fehler"), value: open.error }] : []),
                ]} />
                {confirmDelete
                    ? <Text accessibilityRole="alert" className="text-sm-text-muted">{t("The torrent is removed and everything it downloaded is deleted from this device.",
                        "Der Torrent wird entfernt und alles, was er geladen hat, wird von diesem Gerät gelöscht.")}</Text>
                    : <RowGroup>
                        <ActionRow label={t("Remove from the list", "Aus der Liste entfernen")} disabled={isPending}
                            note={removeNote(torrentStateOf(open), t)}
                            onPress={() => run(open, "remove-keep-files")} />
                        <ActionRow label={t("Delete torrent and files", "Torrent und Dateien löschen")} tone="danger" disabled={isPending} onPress={() => setConfirmDelete(true)} />
                    </RowGroup>}
            </View>}
        </Sheet>
    </View>
}
