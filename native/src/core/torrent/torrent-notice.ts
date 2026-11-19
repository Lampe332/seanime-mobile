// geschrieben nach: Plan Seanime_Chamok_Plan_420.md Abschnitt B (Benachrichtigung des Torrent-Clients), App-Code torrent-downloads.tsx (Zeile der Liste „45 % · ↓ 3.1 MB/s · …“), Muster LoaderNotice.build (modules/core-download, LoaderWays.kt); keine Vorlage

import { amount, type TorrentDeviceStatus } from "./torrent"

/*
 * The notice of the torrent client (client.ts) while it downloads: the held process' notice (TorrentKeepService of the
 * download module) shows what the Torrents tab shows, at most once a second, and a notice of its own tells a torrent's
 * end. Pure: what to show from the statuses, when to send it again, which torrent just ended; client.ts sends it.
 */

export type Translate = (en: string, de: string) => string

/** What the notice shows: title, line, bar (`done` of `total`; `total` 0: a bar without end) */
export type OngoingNotice = { title: string, text: string, done: number, total: number }

/** What the device gives the torrent client's notices (api/client/core-torrent.ts); missing: none are shown */
export type TorrentNotices = {
    /** The app's language */
    t: Translate
    /** Rewrites the held process' notice; never starts the service. false: not shown (the service does not run) */
    update: (notice: OngoingNotice) => Promise<boolean>
    /** A notice of its own at a torrent's end; tapping opens Downloads */
    end: (hash: string, title: string, text: string) => Promise<boolean>
    /** Asks for the permission to show notices while it is still open (Android 13 and later) */
    ask: () => Promise<void>
}

/** The device of the torrent client with its notices (core/torrent/torrent.ts `TorrentDevice` knows nothing of them) */
export type TorrentNoticeHost = { notices?: TorrentNotices }

export type NoticeTorrent = { hash: string, name: string, status: TorrentDeviceStatus }

/** Loading: the process is held and the notice shows it */
export const isLoading = (status: TorrentDeviceStatus) => !status.error && (status.state === "downloading" || status.state === "metadata" || status.state === "checking")

const hasFileList = (status: TorrentDeviceStatus) => status.hasMetadata && status.state !== "metadata"
const percentOf = (progress: number) => Math.round(Math.min(1, Math.max(0, progress)) * 100)

/** Seconds until the wanted bytes are there; null: not known (not loading, nothing comes in), 0: nothing left */
function secondsLeft(status: TorrentDeviceStatus): number | null {
    const left = Math.max(0, status.bytesWanted - status.bytesDone)
    if (left === 0) return 0
    if (status.state !== "downloading" || status.downRate <= 0) return null
    return Math.ceil(left / status.downRate)
}

function leftText(seconds: number, t: Translate): string {
    if (seconds < 60) return t(`${seconds} s left`, `noch ${seconds} s`)
    if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60)
        return t(`${minutes} min left`, `noch ${minutes} Min.`)
    }
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return minutes === 0 ? t(`${hours} h left`, `noch ${hours} Std.`) : t(`${hours} h ${minutes} min left`, `noch ${hours} Std. ${minutes} Min.`)
}

/** "45 % · ↓ 3.1 MB/s · 12 min left", the line of the Torrents tab */
function progressLine(percent: number, rate: number, seconds: number | null, t: Translate): string {
    return [`${percent} %`, `↓ ${amount(rate)}/s`, seconds ? leftText(seconds, t) : ""].filter(Boolean).join(" · ")
}

/**
 * The notice for the client's torrents: one that loads with its name and line, several as "Downloading 3 torrents" with
 * the share of all their bytes, the speed of all and the longest time left. Without a file list yet a bar without end
 * and "Getting file list…". Paused, failed and finished ones are not in it; null: none loads.
 */
export function ongoingNoticeOf(torrents: NoticeTorrent[], t: Translate): OngoingNotice | null {
    const loading = torrents.filter(torrent => isLoading(torrent.status))
    if (loading.length === 0) return null
    const waiting = t("Getting file list…", "Dateiliste wird geholt…")
    if (loading.length === 1) {
        const { name, status } = loading[0]
        if (!hasFileList(status)) return { title: name, text: waiting, done: 0, total: 0 }
        const percent = percentOf(status.progress)
        if (status.state === "checking") return { title: name, text: `${percent} % · ${t("Checking files…", "Dateien werden geprüft…")}`, done: percent, total: 100 }
        return { title: name, text: progressLine(percent, status.downRate, secondsLeft(status), t), done: percent, total: 100 }
    }
    const title = t(`Downloading ${loading.length} torrents`, `${loading.length} Torrents werden geladen`)
    const listed = loading.filter(torrent => hasFileList(torrent.status))
    if (listed.length === 0) return { title, text: waiting, done: 0, total: 0 }
    const wanted = listed.reduce((sum, torrent) => sum + Math.max(0, torrent.status.bytesWanted), 0)
    const done = listed.reduce((sum, torrent) => sum + Math.max(0, Math.min(torrent.status.bytesDone, torrent.status.bytesWanted)), 0)
    const percent = wanted > 0
        ? percentOf(done / wanted)
        : percentOf(listed.reduce((sum, torrent) => sum + torrent.status.progress, 0) / listed.length)
    const rate = loading.reduce((sum, torrent) => sum + Math.max(0, torrent.status.downRate), 0)
    // the longest time left; one that loads without an end in sight (nothing comes in) leaves it open
    const lefts = listed.filter(torrent => torrent.status.state === "downloading").map(torrent => secondsLeft(torrent.status))
    const longest = lefts.length > 0 && !lefts.includes(null) ? Math.max(...(lefts as number[])) : null
    return { title, text: progressLine(percent, rate, longest, t), done: percent, total: 100 }
}

/**
 * At most one notice per `gapMs` (the session tells every second anyway), and one that looks as the last one sent is
 * not sent again. A notice the device did not show (its service not running yet) is sent again with the next offer.
 */
export function noticeThrottle(send: (notice: OngoingNotice) => Promise<boolean>, now: () => number, gapMs = 1000) {
    let last = ""
    let sentAt = Number.NEGATIVE_INFINITY
    return {
        /** Whether it went out */
        offer(notice: OngoingNotice | null): boolean {
            if (!notice) return false
            const key = JSON.stringify(notice)
            const time = now()
            if (key === last || time - sentAt < gapMs) return false
            last = key
            sentAt = time
            void send(notice).then(shown => {
                if (!shown && last === key) last = ""
            }, () => {
                if (last === key) last = ""
            })
            return true
        },
        /** The notice was started or ended: the next offer goes out */
        reset() {
            last = ""
            sentAt = Number.NEGATIVE_INFINITY
        },
    }
}

export type TorrentEnd = { hash: string, name: string, kind: "finished" | "failed", error: string }

type Phase = "open" | "finished" | "failed"

const phaseOf = (status: TorrentDeviceStatus): Phase => status.error ? "failed" : status.state === "finished" || status.state === "seeding" ? "finished" : "open"

/**
 * Which torrents just ended: finished once per torrent (also when it is checked again and finishes a second time),
 * failed each time it falls into an error. What is seen first counts as before: a torrent already done when the app
 * starts tells nothing.
 */
export function endWatch() {
    const seen = new Map<string, Phase>()
    const finished = new Set<string>()
    return {
        ends(torrents: NoticeTorrent[]): TorrentEnd[] {
            const ends: TorrentEnd[] = []
            for (const { hash, name, status } of torrents) {
                const phase = phaseOf(status)
                const before = seen.get(hash)
                seen.set(hash, phase)
                if (before === undefined || before === phase) continue
                if (phase === "finished" && !finished.has(hash)) {
                    finished.add(hash)
                    ends.push({ hash, name, kind: "finished", error: "" })
                }
                if (phase === "failed") ends.push({ hash, name, kind: "failed", error: status.error })
            }
            return ends
        },
        /** A removed torrent; added again it is new */
        forget(hash: string) {
            seen.delete(hash)
            finished.delete(hash)
        },
    }
}

/** The end notice's title and line */
export function endNoticeOf(end: TorrentEnd, t: Translate): { title: string, text: string } {
    if (end.kind === "finished") return { title: t(`Download finished: ${end.name}`, `Download fertig: ${end.name}`), text: t("Saved to your library folder", "In deinem Bibliotheksordner gespeichert") }
    return { title: t(`Download failed: ${end.name}`, `Download fehlgeschlagen: ${end.name}`), text: end.error }
}

/** The refusal before a download that does not fit: needed and free bytes in numbers */
export function spaceText(needed: number, free: number, t: Translate): string {
    return t(`Not enough free space: the download needs ${amount(needed)}, ${amount(free)} are free.`,
        `Nicht genug freier Speicher: Der Download braucht ${amount(needed)}, frei sind ${amount(free)}.`)
}
