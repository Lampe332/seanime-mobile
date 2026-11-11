import type { TorrentClient_Torrent } from "@/api/generated/types"
import { useGetActiveTorrentList, useTorrentClientAction } from "@/api/hooks/torrent_client.hooks"
import { PhoneEmpty, PhoneSection } from "@/components/shared/phone-cards"
import { ActionRow, Facts, Notice, RowGroup } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import Pause from "lucide-react-native/icons/pause"
import Play from "lucide-react-native/icons/play"
import React from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import { ProgressLine } from "./downloads-parts"

/*
 * Torrents tab of Downloads (web android-downloads/torrent-downloads.tsx): the app's own torrent client with progress,
 * pause and resume, and removing a torrent with or without its files. Opened from the torrent sheet after "Download".
 */

const STATUS: Record<string, [string, string]> = {
    downloading: ["Downloading", "Wird geladen"],
    seeding: ["Done · sharing", "Fertig · wird geteilt"],
    paused: ["Paused", "Pausiert"],
    queued: ["Waiting", "Wartet"],
    stopped: ["Stopped", "Gestoppt"],
    error: ["Failed", "Fehlgeschlagen"],
    other: ["Preparing", "Wird vorbereitet"],
}

function statusLabel(torrent: TorrentClient_Torrent, t: Translate) {
    const label = STATUS[torrent.status] ?? STATUS.other
    return t(label[0], label[1])
}

const canResume = (torrent: TorrentClient_Torrent) => torrent.status === "paused" || torrent.status === "stopped" || torrent.status === "error"

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
    if (torrent.status === "seeding") return [statusLabel(torrent, t), torrent.size].join(" · ")
    if (torrent.status === "downloading") {
        return [`${Math.round(torrent.progress * 100)} %`, torrent.size, `↓ ${torrent.downSpeed}`, etaLabel(torrent.eta, t)].filter(Boolean).join(" · ")
    }
    return [statusLabel(torrent, t), `${Math.round(torrent.progress * 100)} %`, torrent.size].join(" · ")
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

    const groups = [
        { key: "active", rows: torrents.filter(torrent => torrent.status !== "seeding"), title: t("Downloading", "Wird geladen") },
        { key: "done", rows: torrents.filter(torrent => torrent.status === "seeding"), title: t("Done", "Fertig") },
    ].filter(group => group.rows.length > 0)

    return <View className="gap-6">
        {torrents.length === 0 && <PhoneEmpty title={t("No torrents", "Keine Torrents")}
            text={t("Open an anime and choose Download → a torrent. It is saved to your library folder and shows up here while it loads.",
                "Öffne einen Anime und wähle Herunterladen → einen Torrent. Er landet in deinem Bibliotheksordner und erscheint hier, solange er lädt.")} />}
        {groups.map(group => <PhoneSection key={group.key} title={group.title} count={group.rows.length}>
            <RowGroup>
                {group.rows.map(torrent => <View key={torrent.hash} className="flex-row items-center bg-sm-surface-raised pr-1">
                    <Pressable accessibilityRole="button" onPress={() => setOpenHash(torrent.hash)} className="min-h-[72px] min-w-0 flex-1 justify-center gap-0.5 px-3 py-2.5 active:bg-sm-surface-control">
                        <Text className="text-[15px] font-semibold leading-5" numberOfLines={2}>{torrent.name}</Text>
                        {group.key === "active" && <ProgressLine value={torrent.progress * 100} label={t(`${torrent.name} download`, `Download ${torrent.name}`)} />}
                        <Muted className="text-[13px]" style={{ fontVariant: ["tabular-nums"] }}>{rowMeta(torrent, t)}</Muted>
                    </Pressable>
                    {group.key === "active" && <Button intent="icon" disabled={isPending} onPress={() => run(torrent, canResume(torrent) ? "resume" : "pause")}
                        accessibilityLabel={canResume(torrent) ? t(`Resume ${torrent.name}`, `${torrent.name} fortsetzen`) : t(`Pause ${torrent.name}`, `${torrent.name} pausieren`)}>
                        {canResume(torrent) ? <Play size={20} color={colors.smTextMuted} /> : <Pause size={20} color={colors.smTextMuted} />}
                    </Button>}
                </View>)}
            </RowGroup>
        </PhoneSection>)}

        <Sheet title={open?.name ?? ""} open={!!open} onOpenChange={value => { if (!value) close() }}
            footer={open && (confirmDelete
                ? <>
                    <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setConfirmDelete(false)}>{t("Keep", "Behalten")}</Button>
                    <Button intent="danger" wrapperClassName="flex-1" disabled={isPending} onPress={() => run(open, "remove")}>{t("Delete files", "Dateien löschen")}</Button>
                </>
                : <Button intent="secondary" wrapperClassName="flex-1" disabled={isPending} onPress={() => run(open, canResume(open) ? "resume" : "pause")}>
                    {canResume(open) ? t("Resume", "Fortsetzen") : t("Pause", "Pausieren")}
                </Button>)}>
            {open && <View className="gap-4">
                <Facts items={[
                    { label: t("State", "Status"), value: statusLabel(open, t) },
                    { label: t("Progress", "Fortschritt"), value: `${Math.round(open.progress * 100)} % · ${open.size}` },
                    ...(open.status === "downloading" ? [{ label: t("Speed", "Tempo"), value: `↓ ${open.downSpeed} · ↑ ${open.upSpeed}` }] : []),
                    ...(open.status === "downloading" && etaLabel(open.eta, t) ? [{ label: t("Time left", "Restzeit"), value: etaLabel(open.eta, t, false) }] : []),
                    { label: t("Peers", "Peers"), value: `${open.peers} · ${t(`${open.seeds} seeders`, `${open.seeds} Seeder`)}` },
                    ...(open.contentPath ? [{ label: t("Saved to", "Speicherort"), value: open.contentPath }] : []),
                    ...(open.error ? [{ label: t("Error", "Fehler"), value: open.error }] : []),
                ]} />
                {confirmDelete
                    ? <Text accessibilityRole="alert" className="text-sm-text-muted">{t("The torrent is removed and everything it downloaded is deleted from your phone.",
                        "Der Torrent wird entfernt und alles, was er geladen hat, wird vom Handy gelöscht.")}</Text>
                    : <RowGroup>
                        <ActionRow label={t("Remove from the list", "Aus der Liste entfernen")} disabled={isPending}
                            note={t("Stops sharing; the files stay in your library.", "Beendet das Teilen; die Dateien bleiben in deiner Bibliothek.")}
                            onPress={() => run(open, "remove-keep-files")} />
                        <ActionRow label={t("Delete torrent and files", "Torrent und Dateien löschen")} tone="danger" disabled={isPending} onPress={() => setConfirmDelete(true)} />
                    </RowGroup>}
            </View>}
        </Sheet>
    </View>
}
