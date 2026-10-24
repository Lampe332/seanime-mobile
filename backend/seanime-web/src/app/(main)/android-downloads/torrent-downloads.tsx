import { TorrentClient_Torrent } from "@/api/generated/types"
import { useGetActiveTorrentList, useTorrentClientAction } from "@/api/hooks/torrent_client.hooks"
import { PhoneSheet } from "@/app/(main)/_features/phone-screen/phone-screen"
import { Translate, useTr } from "@/lib/app-language"
import React from "react"
import { LuPause, LuPlay } from "react-icons/lu"

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

/** Torrents of the app's own client: progress, pause and resume, and removing them with or without their files. */
export function TorrentDownloads() {
    const t = useTr()
    const { data, isLoading, isError, refetch } = useGetActiveTorrentList(true, "", "")
    const { mutate: act, isPending } = useTorrentClientAction()
    const [openHash, setOpenHash] = React.useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = React.useState(false)
    const torrents = data ?? []
    const open = torrents.find(torrent => torrent.hash === openHash) ?? null

    // The sheet follows the live row; it closes when its torrent is gone
    React.useEffect(() => { if (openHash && data && !open) { setOpenHash(null); setConfirmDelete(false) } }, [openHash, data, open])

    const run = (torrent: TorrentClient_Torrent, action: "pause" | "resume" | "remove" | "remove-keep-files") => {
        act({ hash: torrent.hash, action }, {
            onSuccess: () => { if (action === "remove" || action === "remove-keep-files") { setOpenHash(null); setConfirmDelete(false) } },
        })
    }

    if (isError) return <div role="alert" className="mdl-notice" data-torrent-downloads-error>
        {t("The torrent list could not be loaded.", "Die Torrent-Liste konnte nicht geladen werden.")}
        <button type="button" onClick={() => void refetch()}>{t("Try again", "Erneut versuchen")}</button>
    </div>
    if (isLoading) return <p className="mdl-loading">{t("Loading your torrents …", "Deine Torrents werden geladen …")}</p>

    const active = torrents.filter(torrent => torrent.status !== "seeding")
    const done = torrents.filter(torrent => torrent.status === "seeding")

    return <div className="mdl-torrents" data-torrent-downloads>
        {torrents.length === 0 && <div className="mdl-empty" data-torrent-downloads-empty>
            <p>{t("No torrents", "Keine Torrents")}</p>
            <p>{t("Open an anime and choose Download → a torrent. It is saved to your library folder and shows up here while it loads.",
                "Öffne einen Anime und wähle Herunterladen → einen Torrent. Er landet in deinem Bibliotheksordner und erscheint hier, solange er lädt.")}</p>
        </div>}
        {[{ key: "active", rows: active, en: "Downloading", de: "Wird geladen" }, { key: "done", rows: done, en: "Done", de: "Fertig" }]
            .filter(group => group.rows.length > 0)
            .map(group => <section key={group.key} className="mdl-section" aria-labelledby={`mdl-torrents-${group.key}`} data-torrent-group={group.key}>
                <div className="mdl-section-head"><h2 id={`mdl-torrents-${group.key}`}>{t(group.en, group.de)}</h2><span>{group.rows.length}</span></div>
                <ul className="mdl-rows">
                    {group.rows.map(torrent => <li key={torrent.hash} className="mdl-row" data-torrent-hash={torrent.hash}>
                        <button type="button" className="mdl-row-main" onClick={() => setOpenHash(torrent.hash)}>
                            <span className="mdl-row-text">
                                <span className="mdl-row-title mdl-torrent-name">{torrent.name}</span>
                                {group.key === "active" && <span className="mdl-progress" role="progressbar" aria-label={t(`${torrent.name} download`, `Download ${torrent.name}`)}
                                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(torrent.progress * 100)}>
                                    <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, torrent.progress))})` }} />
                                </span>}
                                <span className="mdl-row-meta" data-state={torrent.status}>{rowMeta(torrent, t)}</span>
                            </span>
                        </button>
                        {group.key === "active" && <button type="button" className="mdl-icon-button" disabled={isPending} onClick={() => run(torrent, canResume(torrent) ? "resume" : "pause")}
                            aria-label={canResume(torrent) ? t(`Resume ${torrent.name}`, `${torrent.name} fortsetzen`) : t(`Pause ${torrent.name}`, `${torrent.name} pausieren`)}
                            data-torrent-toggle>
                            {canResume(torrent) ? <LuPlay aria-hidden /> : <LuPause aria-hidden />}
                        </button>}
                    </li>)}
                </ul>
            </section>)}

        <PhoneSheet title={open?.name ?? ""} open={!!open} onOpenChange={value => { if (!value) { setOpenHash(null); setConfirmDelete(false) } }} data-torrent-sheet
            footer={open && (confirmDelete
                ? <>
                    <button type="button" className="ps-secondary" onClick={() => setConfirmDelete(false)}>{t("Keep", "Behalten")}</button>
                    <button type="button" className="ps-primary" data-tone="danger" disabled={isPending} onClick={() => run(open, "remove")} data-torrent-delete-confirm>
                        {t("Delete files", "Dateien löschen")}
                    </button>
                </>
                : <>
                    <button type="button" className="ps-secondary" disabled={isPending} onClick={() => run(open, canResume(open) ? "resume" : "pause")} data-torrent-sheet-toggle>
                        {canResume(open) ? t("Resume", "Fortsetzen") : t("Pause", "Pausieren")}
                    </button>
                </>)}>
            {open && <>
                <dl className="ps-facts" data-torrent-facts>
                    <div><dt>{t("State", "Status")}</dt><dd>{statusLabel(open, t)}</dd></div>
                    <div><dt>{t("Progress", "Fortschritt")}</dt><dd>{Math.round(open.progress * 100)} % · {open.size}</dd></div>
                    {open.status === "downloading" && <div><dt>{t("Speed", "Tempo")}</dt><dd>↓ {open.downSpeed} · ↑ {open.upSpeed}</dd></div>}
                    {open.status === "downloading" && !!etaLabel(open.eta, t) && <div><dt>{t("Time left", "Restzeit")}</dt><dd>{etaLabel(open.eta, t, false)}</dd></div>}
                    <div><dt>{t("Peers", "Peers")}</dt><dd>{open.peers} · {t(`${open.seeds} seeders`, `${open.seeds} Seeder`)}</dd></div>
                    {!!open.contentPath && <div><dt>{t("Saved to", "Speicherort")}</dt><dd className="mdl-torrent-path">{open.contentPath}</dd></div>}
                    {!!open.error && <div><dt>{t("Error", "Fehler")}</dt><dd>{open.error}</dd></div>}
                </dl>
                {confirmDelete
                    ? <p className="ps-sheet-note" role="alert">{t("The torrent is removed and everything it downloaded is deleted from your phone.",
                        "Der Torrent wird entfernt und alles, was er geladen hat, wird vom Handy gelöscht.")}</p>
                    : <div className="ps-rows mdl-torrent-actions">
                        <button type="button" className="ps-action" disabled={isPending} onClick={() => run(open, "remove-keep-files")} data-torrent-remove>
                            <span className="ps-action-text"><span>{t("Remove from the list", "Aus der Liste entfernen")}</span>
                                <small>{t("Stops sharing; the files stay in your library.", "Beendet das Teilen; die Dateien bleiben in deiner Bibliothek.")}</small></span>
                        </button>
                        <button type="button" className="ps-action" data-tone="danger" disabled={isPending} onClick={() => setConfirmDelete(true)} data-torrent-delete>
                            <span className="ps-action-text"><span>{t("Delete torrent and files", "Torrent und Dateien löschen")}</span></span>
                        </button>
                    </div>}
            </>}
        </PhoneSheet>
    </div>
}

/** The server's English "3 hours left" / "1 minutes left" / "No ETA" as a short phrase in the app language. */
function etaLabel(eta: string, t: Translate, withLeft = true) {
    const m = eta.match(/^(\d+) (hour|minute|second)s? left$/)
    if (!m) return ""
    const n = Number(m[1])
    const en = { hour: n === 1 ? "1 hour" : `${n} hours`, minute: n === 1 ? "1 minute" : `${n} minutes`, second: `${n} s` }[m[2] as "hour" | "minute" | "second"]
    const de = { hour: `${n} Std.`, minute: `${n} Min.`, second: `${n} s` }[m[2] as "hour" | "minute" | "second"]
    return withLeft ? t(`${en} left`, `noch ${de}`) : t(en, de)
}

function rowMeta(torrent: TorrentClient_Torrent, t: Translate) {
    if (torrent.status === "seeding") return [statusLabel(torrent, t), torrent.size].join(" · ")
    if (torrent.status === "downloading") {
        return [`${Math.round(torrent.progress * 100)} %`, torrent.size, `↓ ${torrent.downSpeed}`, etaLabel(torrent.eta, t)].filter(Boolean).join(" · ")
    }
    return [statusLabel(torrent, t), `${Math.round(torrent.progress * 100)} %`, torrent.size].join(" · ")
}
