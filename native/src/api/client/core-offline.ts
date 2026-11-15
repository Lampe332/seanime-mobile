// geschrieben nach: docs/EIGENER-KERN.md §4o (Phase 4b-B: Geräte-Seite der Downloads, Prüf-Link; Phase 4b-C1: Wartezeiten, während die App nicht vorn ist; Korrektur 4b-C1K: Hinweise vom Gerät, Datei-Abfrage im Modul; Phase 4c: Liste und Ordner der alten Downloads des Servers, nur lesend; Phase 4c-2: Ordner der alten Manga-Kapitel, nur lesend), Muster core-download.ts und core-manga-check.ts, Texte wie download-notifications.ts, Doku von expo-file-system (Directory, File, Paths) und @react-native-community/netinfo (fetch, addEventListener); kein Server-Quelltext
import { deviceLoader } from "@/api/client/core-download"
import { takeLongestPieces } from "@/api/client/core-switch"
import { buildSeaQuery } from "@/api/client/requests"
import { type BlockingWatch, OLD_MANGA_FOLDER, OLD_OFFLINE_FOLDER, type OfflineDevice, type OfflineNetwork } from "@/core"
import type { MobileOffline_Item, MobileOffline_Snapshot } from "@/api/generated/types"
import { type NetworkLike, networkReport, offlineFailureText } from "@/api/hooks/mobile_offline.helpers"
import { tr } from "@/lib/app-language"
import { shortcutLink } from "@/lib/app-links"
import { logger } from "@/lib/helpers/debug"
import { noticeName } from "@/main/android-downloads/_lib/offline-library"
import NetInfo from "@react-native-community/netinfo"
import { Directory, File, Paths } from "expo-file-system"
import { AppState } from "react-native"

/*
 * What the device gives the core's downloads (core/offline/offline.ts, area `offline`): the loader of
 * modules/core-download, a folder of its own in the app's storage, the state of the network read from the device
 * itself, and what the queue needs while the app is not in front, where the app's timers stand still: a wait that comes
 * back by itself and the notice at an episode's end, shown by the device. Below it the check for the test app's link.
 */

/** The folder of the offline files inside the app's own data; an episode lies in `episodes/<id>/`, its pictures in `artwork/` */
const FOLDER = "core-offline"

function networkOf(state: NetworkLike): OfflineNetwork {
    return { known: state.isConnected !== null, ...networkReport(state) }
}

type EndedItem = Parameters<NonNullable<OfflineDevice["notify"]>>[0]

/** Title and text as the app's JavaScript posted them (download-notifications.ts), in the app's language */
export function endNoticeOf(item: EndedItem, outcome: "finished" | "failed"): { title: string, text: string } {
    const name = noticeName(item as unknown as MobileOffline_Item, tr)
    if (outcome === "finished") return { title: tr("Download finished", "Download fertig"), text: name }
    return { title: tr("Download failed", "Download fehlgeschlagen"), text: `${name}
${offlineFailureText(item.failure, tr)}` }
}

let device: Promise<OfflineDevice> | null = null

/** One for the app: the core's download service keeps it. The loader's calls are waits for the watch of the app's thread. */
export function offlineDeviceFor(watch: BlockingWatch): Promise<OfflineDevice> {
    device ??= (async (): Promise<OfflineDevice> => {
        const loader = await deviceLoader()
        return {
            loader: {
                enqueue: watch.waiting(loader.enqueue, "loader enqueue"),
                cancel: watch.waiting(loader.cancel, "loader cancel"),
                status: watch.waiting(loader.status, "loader status"),
                forget: watch.waiting(loader.forget, "loader forget"),
                listen: loader.listen,
            },
            root: new Directory(Paths.document, FOLDER).uri.replace(/\/+$/, ""),
            // the saved manga chapters (core/manga/downloads.ts): `<provider>/<mediaId>/<chapter>/`
            mangaRoot: new Directory(Paths.document, "core-manga").uri.replace(/\/+$/, ""),
            // by the module, off the app's thread: removing a saved episode of 702 MB here held it for 50.6 ms
            removeFolder: watch.waiting(loader.removeFolder, "folder remove"),
            network: watch.waiting(async () => networkOf(await NetInfo.fetch()), "network state"),
            onNetwork: listener => NetInfo.addEventListener(state => listener(networkOf(state))),
            // by the module: three synchronous checks here were part of the 15.6 to 33.4 ms piece of an episode's end (4b-C1)
            has: watch.waiting(loader.has, "file check"),
            notify: (item, outcome) => {
                const { title, text } = endNoticeOf(item, outcome)
                void loader.notice(item.id, title, text, tr("Episode downloads", "Folgen-Downloads"), shortcutLink("/android-downloads")).catch(() => undefined)
            },
            wakeIn: ms => void loader.wakeIn(ms ?? -1).catch(() => undefined),
            onWake: loader.onWake,
            // the server's saved episodes (phase 4c): played where they lie, its list only read
            oldRoot: new Directory(Paths.document, OLD_OFFLINE_FOLDER).uri.replace(/\/+$/, ""),
            oldQueue: watch.waiting(async () => {
                const file = new File(Paths.document, OLD_OFFLINE_FOLDER, "queue.json")
                return file.exists ? file.text() : null
            }, "server list of saved episodes"),
            // the server's saved manga chapters (phase 4c-2): read where they lie, its folders only listed
            oldMangaRoot: new Directory(Paths.document, OLD_MANGA_FOLDER).uri.replace(/\/+$/, ""),
            oldManga: watch.waiting(async () => {
                const root = new Directory(Paths.document, OLD_MANGA_FOLDER)
                if (!root.exists) return []
                return root.list().filter(entry => entry instanceof Directory).map(folder => {
                    const files = folder.list().filter(entry => entry instanceof File).map(file => file.name)
                    const registry = new File(folder, "registry.json")
                    return { folder: folder.name, files, registry: registry.exists ? registry.textSync() : null }
                })
            }, "server folder of saved manga"),
            told: line => logger("Core").info(line),
            // the internal storage's free bytes (expo-file-system, a quick synchronous read, as the downloads tab shows it)
            freeBytes: async () => {
                try {
                    return Paths.availableDiskSpace
                }
                catch {
                    return null
                }
            },
        }
    })().catch(error => {
        device = null
        throw error
    })
    return device
}

export type OfflineCheck = {
    /** The address of a file or playlist to save as the player would; "": the provider is asked (media, provider, episode) */
    url: string
    type: "m3u8" | "mp4"
    /** Sent as Referer when not empty */
    referer: string
    /** The address of one subtitle file to save along; "": none */
    subtitle: string
    /** Expected hash of the picture's file, lower-case hex; "": only logged */
    sha256: string
    /** Expected size of the picture's file; null: only logged */
    size: number | null
    mediaId: number
    provider: string
    episode: number
    title: string
    /** The episode stays after the check (for playing it); else it is removed */
    keep: boolean
    /** The addresses of the anime's pictures and the episode's texts as the screens send them along; "": none */
    cover: string
    banner: string
    image: string
    episodeTitle: string
    description: string
}

const log = (text: string) => logger("CoreOffline").info(text)

const clean = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "<address>").replace(/\/?\d{1,3}(\.\d{1,3}){3}(:\d+)?/g, "<host>").slice(0, 160)

const snapshot = () => buildSeaQuery<MobileOffline_Snapshot>({ endpoint: "/api/v1/mobile-offline/snapshot", method: "GET" })

const act = (id: string, action: string) => buildSeaQuery<boolean, { id: string, action: string }>({ endpoint: "/api/v1/mobile-offline/action", method: "POST", data: { id, action } })

const folderOf = (id: string) => new Directory(Paths.document, FOLDER, "episodes", id)

const pictureOf = (asset: string | undefined) => asset ? new File(new Directory(Paths.document, FOLDER, "artwork"), asset) : null

/** No end of the download for this long ends the check */
const PATIENCE_MS = 30 * 60_000

/*
 * Test and scratch app only (link `core?offline=check…`, lib/app-links.ts): queues one episode through the same door
 * the screens use, follows the snapshot until it is ready or has failed, looks at its files (size and SHA-256 of the
 * picture's file against what the link names) and removes it again unless `keep=1`. Several links one after the other
 * make a queue. Numbers and file names only in the log `[CoreOffline]`; no address, no title. Every line of a state
 * names whether the app was in front ("active") or not ("background") at that moment.
 */
export async function runCoreOfflineCheck(check: OfflineCheck): Promise<void> {
    const started = Date.now()
    takeLongestPieces(0)
    try {
        const settings = await buildSeaQuery<boolean, { wifiOnly: boolean }>({ endpoint: "/api/v1/mobile-offline/settings", method: "POST", data: { wifiOnly: false } })
        const first = await snapshot()
        log(`check start: settings ${settings ? "set" : "not set"}, ${first?.items?.length ?? 0} episodes before, network known ${first?.network.known}, connected ${first?.network.connected}, metered ${first?.network.metered}`)
        let id = ""
        if (check.url !== "") {
            const item = await buildSeaQuery<MobileOffline_Item>({
                endpoint: "/api/v1/mobile-offline/download",
                method: "POST",
                data: {
                    key: "", url: check.url, type: check.type, headers: check.referer ? { Referer: check.referer } : {},
                    subtitles: check.subtitle ? [{ url: check.subtitle, language: "English", isDefault: true }] : [],
                    mediaId: check.mediaId, episode: String(check.episode), dubbed: false, quality: "Auto", title: check.title,
                    coverUrl: check.cover, bannerUrl: check.banner, episodeTitle: check.episodeTitle, episodeImageUrl: check.image, episodeDescription: check.description,
                },
            })
            id = item?.id ?? ""
        }
        else {
            const added = await buildSeaQuery<number>({
                endpoint: "/api/v1/mobile-offline/batch",
                method: "POST",
                data: {
                    mediaId: check.mediaId, provider: check.provider, dubbed: false, quality: "Auto", server: "", title: check.title, coverUrl: check.cover, bannerUrl: check.banner,
                    episodes: [{ number: check.episode, title: check.episodeTitle, image: check.image, description: check.description }],
                },
            })
            id = (await snapshot())?.items?.find(item => item.mediaId === check.mediaId && item.episode === String(check.episode) && !item.dubbed)?.id ?? ""
            log(`batch: ${added} added`)
        }
        if (id === "") return log("check: the episode is not in the queue")
        log(`queued as ${id}`)

        let last = ""
        let item: MobileOffline_Item | undefined
        while (Date.now() - started < PATIENCE_MS) {
            item = (await snapshot())?.items?.find(entry => entry.id === id)
            const line = item ? `${item.status}${item.status === "downloading" ? ` ${Math.floor(item.progress * 10) * 10} %` : ""}` : "gone"
            if (line !== last) log(`state of ${id}: ${line} (${Date.now() - started} ms, app ${AppState.currentState})`)
            last = line
            if (!item || item.status === "ready" || item.status === "failed") break
            await new Promise(resolve => setTimeout(resolve, 1_000))
        }
        if (item?.status === "failed") log(`check failed for ${id}: ${item.failure ?? "no class"} ${clean(item.error ?? "")}`)
        if (item?.status === "ready") {
            const folder = folderOf(id)
            const video = new File(folder, item.files.video ?? "")
            const hash = video.exists ? await (await deviceLoader()).sha256(video.uri) : ""
            const size = check.size === null ? "not given" : video.size === check.size ? "equal" : "DIFFERENT"
            const same = check.sha256 === "" ? "not given" : hash === check.sha256 ? "equal" : "DIFFERENT"
            const subtitles = (item.files.subtitles ?? []).map(subtitle => `${subtitle.file} ${new File(folder, subtitle.file).size ?? 0}`).join(", ")
            const pictures = [item.coverAsset, item.bannerAsset, item.episodeImageAsset].map(pictureOf).filter(picture => picture?.exists).map(picture => `${picture!.name} ${picture!.size ?? 0}`).join(", ")
            log(`check done for ${id}: ${item.files.video} ${video.size ?? 0} bytes (size ${size}), sha256 ${hash.slice(0, 16)} (hash ${same}), audio ${item.files.audio ? `${item.files.audio} ${new File(folder, item.files.audio).size ?? 0}` : "none"}, subtitles ${subtitles || "none"}, pictures ${pictures || "none"}, metadataSaved ${item.metadataSaved}, audioLanguage "${item.audioLanguage}", item bytes ${item.bytes}, ${Date.now() - started} ms, app ${AppState.currentState}`)
        }
        log(`longest pieces: ${takeLongestPieces(3).join("; ") || "none"}`)
        if (item && !check.keep) await removeOfflineEpisode(id)
    }
    catch (error) {
        log(`check broke: ${clean(error)}`)
    }
}

/** Test and scratch app only (link `core?offline=remove&id=<id>`): removes one episode of the core's downloads and looks whether its folder is gone */
export async function removeOfflineEpisode(id: string): Promise<void> {
    try {
        const pictures = [`${id}-cover`, `${id}-banner`, `${id}-episode`]
        await act(id, "remove")
        const left = (await snapshot())?.items?.some(item => item.id === id)
        const artwork = new Directory(Paths.document, FOLDER, "artwork")
        const picturesLeft = artwork.exists ? artwork.list().filter(entry => pictures.some(start => entry.name.startsWith(`${start}.`))).length : 0
        log(`removed ${id}: in the snapshot ${left ? "yes" : "no"}, folder ${folderOf(id).exists ? "still there" : "gone"}, pictures left ${picturesLeft}`)
    }
    catch (error) {
        log(`remove broke: ${clean(error)}`)
    }
}

/** Test and scratch app only (link `core?offline=list`): the core's downloads as ids, states and file names */
export async function listOfflineEpisodes(): Promise<void> {
    try {
        const now = await snapshot()
        log(`list: ${now?.items?.length ?? 0} episodes, wifiOnly ${now?.wifiOnly}, waiting "${now?.waiting}"`)
        for (const item of now?.items ?? []) log(`  ${item.id}: ${item.status}, ${Math.round(item.progress * 100)} %, ${item.bytes} bytes, video ${item.files.video ?? "-"}, audio ${item.files.audio ?? "-"}, subtitles ${item.files.subtitles?.length ?? 0}, cover ${item.coverAsset ?? "-"}, metadataSaved ${item.metadataSaved}`)
    }
    catch (error) {
        log(`list broke: ${clean(error)}`)
    }
}
