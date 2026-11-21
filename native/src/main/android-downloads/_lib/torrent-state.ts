import type { TorrentClient_Torrent } from "@/api/generated/types"
import type { Translate } from "@/lib/app-language"

/*
 * What a torrent of the Torrents tab (torrent-downloads.tsx) is doing, in plain words. 4.2.0: "Done · sharing" left people
 * asking whether they were seeding. A finished torrent seeds only while it is not paused, and only while the app runs:
 * the process is held in the background (core/torrent/client.ts `hold`) for loading and queued torrents, not for seeding.
 */

export type TorrentState = "downloading" | "preparing" | "waiting" | "paused" | "seeding" | "done" | "failed"

export function torrentStateOf(torrent: Pick<TorrentClient_Torrent, "status" | "progress">): TorrentState {
    if (torrent.status === "error") return "failed"
    if (torrent.status === "seeding") return "seeding"
    if (torrent.status === "downloading") return "downloading"
    if (torrent.status === "queued") return "waiting"
    if (torrent.status === "paused" || torrent.status === "stopped") return torrent.progress >= 1 ? "done" : "paused"
    return "preparing"
}

export type TorrentStateText = {
    /** Head of the sheet */
    title: string
    /** One sentence under the head: what happens now */
    note: string
    /** Short word for the list row */
    short: string
    /** What the sheet's button does, and its label */
    action: "pause" | "resume"
    actionLabel: string
}

export function torrentStateText(state: TorrentState, t: Translate): TorrentStateText {
    const pauseDownload = t("Pause download", "Download pausieren")
    switch (state) {
        case "downloading":
            return {
                title: t("Downloading", "Wird geladen"), short: t("Downloading", "Wird geladen"),
                note: t("Keeps going when you leave the app. Parts you already have are shared with others.",
                    "Läuft weiter, wenn du die App verlässt. Teile, die du schon hast, werden mit anderen geteilt."),
                action: "pause", actionLabel: pauseDownload,
            }
        case "preparing":
            return {
                title: t("Preparing", "Wird vorbereitet"), short: t("Preparing", "Wird vorbereitet"),
                note: t("Looking for people who share it and checking the files.", "Sucht Leute, die ihn teilen, und prüft die Dateien."),
                action: "pause", actionLabel: pauseDownload,
            }
        case "waiting":
            return {
                title: t("Waiting", "Wartet"), short: t("Waiting", "Wartet"),
                note: t("Starts when another download is finished.", "Startet, sobald ein anderer Download fertig ist."),
                action: "pause", actionLabel: pauseDownload,
            }
        case "paused":
            return {
                title: t("Paused", "Pausiert"), short: t("Paused", "Pausiert"),
                note: t("Nothing is loaded or shared until you resume.", "Bis du fortsetzt, wird nichts geladen oder geteilt."),
                action: "resume", actionLabel: t("Resume download", "Download fortsetzen"),
            }
        case "seeding":
            return {
                title: t("Done · Seeding", "Fertig · Seeding"), short: t("Seeding", "Seeding"),
                note: t("Downloaded. While the app is open, your phone uploads it to others who want it. You can stop anytime.",
                    "Geladen. Solange die App offen ist, lädt dein Handy ihn für andere hoch. Du kannst das jederzeit stoppen."),
                action: "pause", actionLabel: t("Stop seeding", "Seeding stoppen"),
            }
        case "done":
            return {
                title: t("Done · Not seeding", "Fertig · Kein Seeding"), short: t("Not seeding", "Kein Seeding"),
                note: t("Downloaded. Nothing is uploaded to others. The files are in your library.",
                    "Geladen. Es wird nichts an andere hochgeladen. Die Dateien sind in deiner Bibliothek."),
                action: "resume", actionLabel: t("Start seeding", "Seeding starten"),
            }
        case "failed":
            return {
                title: t("Failed", "Fehlgeschlagen"), short: t("Failed", "Fehlgeschlagen"),
                note: t("The download stopped because of an error. Try again, or delete it.",
                    "Der Download wurde wegen eines Fehlers gestoppt. Versuch es erneut oder lösch ihn."),
                action: "resume", actionLabel: t("Try again", "Erneut versuchen"),
            }
    }
}

/** How many people the torrent is connected to right now */
export function peopleText(n: number, t: Translate) {
    return n === 1 ? t("1 person right now", "1 Person gerade") : t(`${n} people right now`, `${n} Personen gerade`)
}

/** The note of "Remove from the list": a finished torrent stops seeding, an unfinished one stops loading */
export function removeNote(state: TorrentState, t: Translate) {
    return state === "seeding" || state === "done"
        ? t("Stops seeding. The files stay in your library.", "Beendet das Seeding. Die Dateien bleiben in deiner Bibliothek.")
        : t("Stops the download. What is already loaded stays.", "Stoppt den Download. Was schon geladen ist, bleibt.")
}
