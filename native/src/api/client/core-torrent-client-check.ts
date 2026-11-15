// geschrieben nach: Muster core-torrent-stream-check.ts (Prüf-Link nur Test- und scratch-App), docs/EIGENER-KERN.md §4q Phase 6f; kein Server-Quelltext
import { buildSeaQuery } from "@/api/client/requests"
import { logger } from "@/lib/helpers/debug"
import { documentDirectory, getInfoAsync } from "expo-file-system/legacy"
import { type TorrentSettings, TorrentError, base64UrlBytes, deviceTorrent, plainPath } from "./core-torrent"

/*
 * Test link of phase 6f (only test and scratch app): `core?torrent=client-check&do=<step>…`, one step per link, so the
 * app can be restarted between them. Every step goes through the core's routes of the torrent client (area `torrent`
 * on); the session is started first with every way of finding peers off (DHT, LSD, trackers, PEX, port mapping, uTP),
 * the one peer is named in the link. Numbers and short hashes only in the log ([CoreTorrent]).
 *
 * Steps: `start` (the session only) · `add&file=<.torrent base64url>&peer=<IP>:<port>&folder=<name>` (the bytes to the
 * session in `<documents>/client-check/<name>`, then the core's download route for the same torrent – it answers with
 * the torrent the session has – and the peer) · `peer&hash=…&peer=…` · `list` · `pause|resume|remove|remove-keep-files
 * &hash=…` · `hash&hash=…` (SHA-256 and size of the loaded file, by the download module).
 */

export type TorrentClientCheck = {
    step: "start" | "add" | "peer" | "list" | "pause" | "resume" | "remove" | "remove-keep-files" | "hash"
    hash: string
    file: string
    peerHost: string
    peerPort: number
    folder: string
}

const log = (text: string) => logger("CoreTorrent").info(text)
const short = (hash: string) => `${hash.slice(0, 8)}…`

type Listed = { hash: string, name: string, status: string, progress: number, size: string, contentPath: string, error: string }

const list = () => buildSeaQuery<Listed[] | null>({ endpoint: "/api/v1/torrent-client/list", method: "GET" })

export async function runCoreTorrentClientCheck(check: TorrentClientCheck): Promise<void> {
    const since = Date.now()
    try {
        const torrent = await deviceTorrent()
        const settings: TorrentSettings = { folder: plainPath(`${documentDirectory}core-torrent`), dht: false, lsd: false, trackers: false, pex: false, portMapping: false, utp: false }
        try {
            await torrent.start(settings)
            log("client check: session started, every way of finding peers off")
        }
        catch (error) {
            if (!(error instanceof TorrentError) || !error.message.includes("running already")) throw error
        }
        if (check.step === "start") {
            log(`client check start ok (${Date.now() - since} ms)`)
            return
        }
        let hash = check.hash
        if (check.step === "add") {
            const bytes = base64UrlBytes(check.file)
            if (!bytes) throw new Error("the link cannot be read")
            const folder = plainPath(`${documentDirectory}client-check/${check.folder}`)
            hash = await torrent.addTorrentFile(bytes, folder)
            const answered = await buildSeaQuery<boolean>({
                endpoint: "/api/v1/torrent-client/download",
                method: "POST",
                data: { torrents: [{ name: "client check", infoHash: hash, provider: "" }], destination: folder, smartSelect: { enabled: false, missingEpisodeNumbers: [] } },
            })
            log(`client check: ${short(hash)} added, download route answered ${answered}`)
        }
        if ((check.step === "add" || check.step === "peer") && check.peerPort > 0) {
            await torrent.connectPeer(hash, check.peerHost, check.peerPort)
            log(`client check: peer connected to ${short(hash)}`)
        }
        // where the file of a torrent to remove lies, to see it gone afterwards
        const before = check.step === "remove" ? ((await list()) ?? []).find(one => one.hash === hash)?.contentPath ?? "" : ""
        if (["pause", "resume", "remove", "remove-keep-files"].includes(check.step)) {
            const answered = await buildSeaQuery<boolean>({ endpoint: "/api/v1/torrent-client/action", method: "POST", data: { hash, action: check.step } })
            log(`client check: ${check.step} ${short(hash)} answered ${answered}`)
        }
        const listed = (await list()) ?? []
        for (const one of listed) log(`client check: list ${short(one.hash)} ${one.status} ${Math.round(one.progress * 1000) / 10} % ${one.size}${one.error ? ` error ${one.error}` : ""}`)
        if (listed.length === 0) log("client check: list empty (null)")
        if (check.step === "hash") {
            const path = listed.find(one => one.hash === hash)?.contentPath ?? ""
            if (!path) throw new Error("the torrent is not in the list")
            const info = await getInfoAsync(`file://${encodeURI(path)}`)
            const module = (await import("../../../modules/core-download")).default
            log(`client check: ${short(hash)} file ${info.exists ? `${info.size} bytes, SHA-256 ${await module.sha256(path)}` : "missing"}`)
        }
        if (check.step === "remove") {
            if (!before) throw new Error("the torrent was not in the list")
            log(`client check: after removing with its files, the file ${(await getInfoAsync(`file://${encodeURI(before)}`)).exists ? "is still there" : "is gone"}`)
        }
        log(`client check ${check.step} ok (${Date.now() - since} ms)`)
    }
    catch (error) {
        log(`client check ${check.step} FAILED: ${error instanceof Error ? error.message : String(error)}`)
    }
}
