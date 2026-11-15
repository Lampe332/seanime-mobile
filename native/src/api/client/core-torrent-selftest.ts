// geschrieben nach: docs/EIGENER-KERN.md §4q (Phase 6b-1) und §4b (Wächter für den Faden der Oberfläche), Doku von expo-file-system (Directory, File, Paths); kein Server-Quelltext
import { LONGEST_PIECE_MS, createBlockingWatch } from "@/core"
import { logger } from "@/lib/helpers/debug"
import { Directory, Paths } from "expo-file-system"
import { deleteAsync, getInfoAsync } from "expo-file-system/legacy"
import { type TorrentClient, type TorrentSettings, type TorrentStatus, base64UrlBytes, deviceTorrent, plainPath } from "./core-torrent"

export type TorrentSelfTest = {
    /** The `.torrent` file of the test's own file, base64url */
    file: string
    /** The one peer to load from: an IP address and a port */
    peerHost: string
    peerPort: number
    /** Expected SHA-256 of the loaded file, lower-case hex */
    sha256: string
    /** Expected size; null: only logged */
    size: number | null
}

const log = (text: string) => logger("CoreTorrent").info(text)

const clean = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "<address>").replace(/\/?\d{1,3}(\.\d{1,3}){3}(:\d+)?/g, "<host>").slice(0, 200)

/** No end of the download for this long ends the self test */
const PATIENCE_MS = 5 * 60_000
/** The torrent must be back from its resume data within this time after a restart */
const RESUME_PATIENCE_MS = 30_000

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1)

/** How late a timer of 2 ms fires, at most: the app's whole thread, whoever holds it */
function lateTimer(): () => number {
    let longest = 0
    let last = performance.now()
    let on = true
    const turn = () => {
        if (!on) return
        const now = performance.now()
        longest = Math.max(longest, now - last - 2)
        last = now
        setTimeout(turn, 2)
    }
    setTimeout(turn, 2)
    return () => {
        on = false
        return longest
    }
}

let running = false

/*
 * Test and scratch app only (link `core?torrent=selftest&file=<.torrent as base64url>&peer=<ip>:<port>&sha256=<hex>
 * [&size=<bytes>]`): the torrent module on this device, with every way of finding peers off (no DHT, no local
 * discovery, no trackers, no peer exchange, no port mapping, TCP only). Adds the test's own `.torrent` file, connects the one
 * peer the link names (a seeder on the PC behind `adb reverse`), loads in order, compares size and SHA-256, stops and
 * starts the session (the torrent must come back complete from its resume data), removes the torrent with its files,
 * adds and removes its magnet link and stops the session. Numbers only in the log ([CoreTorrent]); no address.
 */
export async function runCoreTorrentSelfTest(test: TorrentSelfTest): Promise<void> {
    if (running) return
    running = true
    const what = "torrent self test"
    const pieces: number[] = []
    /** Where each piece over the limit ran: the wait it began after and the one it ended at (§4q, 6b-2) */
    const over: string[] = []
    const watch = createBlockingWatch({
        now: () => performance.now(),
        onPiece: (milliseconds, _what, where) => {
            pieces.push(milliseconds)
            if (milliseconds > LONGEST_PIECE_MS) over.push(`${milliseconds.toFixed(1)} ms ${where.from} → ${where.until}`)
        },
        free: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
    })
    // every wait of the test is one the watch sees, so a piece is only the test's own work on the app's thread
    const step = <Result>(name: string, work: () => Promise<Result>): Promise<Result> => watch.waiting(work, name)()

    // first the app alone for 2 s: how late the timer is anyway
    const idleStop = lateTimer()
    await new Promise(resolve => setTimeout(resolve, 2000))
    const idleLate = idleStop()
    const stopTimer = lateTimer()

    const data = new Directory(Paths.cache, "core-torrent-selftest")
    let client: TorrentClient | null = null
    let unlisten = () => {}
    let result = "FAILED"
    log("self test started")
    watch.enter(what)
    try {
        const settings: TorrentSettings = {
            folder: plainPath(new Directory(Paths.document, "core-torrent").uri),
            dht: false, lsd: false, trackers: false, pex: false, portMapping: false,
            // the test's seeder speaks TCP only: without this, libtorrent tries uTP first and only then TCP
            utp: false,
        }
        const saveFolder = plainPath(data.uri)
        const bytes = base64UrlBytes(test.file)
        if (!bytes || bytes.length === 0) throw new Error("the torrent file of the link cannot be read")
        await step("folder", () => deleteAsync(data.uri, { idempotent: true }))

        const torrent = await step("module", deviceTorrent)
        client = torrent
        // a session an earlier run left behind
        await step("stop", () => torrent.stop())
        await step("start", () => torrent.start(settings))

        let infoHash = ""
        const eventTimes: number[] = []
        let peakRate = 0
        let onEvent: (status: TorrentStatus) => void = () => {}
        unlisten = torrent.onStatus(statuses => {
            const mine = statuses.find(status => status.infoHash === infoHash)
            if (!mine) return
            eventTimes.push(performance.now())
            peakRate = Math.max(peakRate, mine.downRate)
            onEvent(mine)
        })

        infoHash = await step("add", () => torrent.addTorrentFile(bytes, saveFolder))
        const files = await step("files", () => torrent.files(infoHash))
        const first = files[0]
        if (!first) throw new Error("the torrent has no file")
        log(`added: ${files.length} file(s), ${first.size} bytes, pieces ${first.pieceStart}–${first.pieceEnd}`)
        await step("priority", () => torrent.setFilePriority(infoHash, first.index, 7))
        await step("sequential", () => torrent.setSequential(infoHash, true))
        await step("deadlines", () => torrent.setPieceDeadlines(infoHash, first.pieceStart, 4, 1000, 500))

        const started = performance.now()
        const download = new Promise<TorrentStatus | null>(resolve => {
            const timer = setTimeout(() => resolve(null), PATIENCE_MS)
            onEvent = status => {
                if (eventTimes.length % 5 === 0) log(`progress ${(status.progress * 100).toFixed(0)} %, ${megabytes(status.downRate)} MB/s, ${status.peers} peer(s), pieces ${status.piecesHave}/${status.pieces}, ${status.state}`)
                if (status.error === "" && status.state !== "finished" && status.state !== "seeding") return
                clearTimeout(timer)
                resolve(status)
            }
        })
        await step("peer", () => torrent.connectPeer(infoHash, test.peerHost, test.peerPort))
        const done = await step("download", () => download)
        onEvent = () => {}
        const seconds = (performance.now() - started) / 1000
        if (!done) throw new Error(`not finished after ${PATIENCE_MS / 1000} s`)
        if (done.error !== "") throw new Error(`the torrent stopped: ${done.error}`)
        const downloadEvents = eventTimes.length
        const gaps = eventTimes.slice(1).map((time, index) => time - (eventTimes[index] ?? time))
        const gapText = gaps.length > 0 ? `${Math.min(...gaps).toFixed(0)}–${Math.max(...gaps).toFixed(0)} ms apart` : "one only"

        // The file is asked for through the module's async functions, which are waits of the watch. The File object's
        // `exists` and `size` ran on the app's thread: that was the piece of 10–16 ms right after the download (§4q, 6b-2).
        const fileAddress = `${data.uri.replace(/\/+$/, "")}/${first.path.split("/").map(encodeURIComponent).join("/")}`
        const fileInfo = () => step("file", () => getInfoAsync(fileAddress))
        const found = await fileInfo()
        const size = found.exists ? found.size : -1
        const sha256 = (await step("hash", async () => (await import("../../../modules/core-download")).default.sha256(fileAddress))).toLowerCase()
        const sizeOk = test.size === null ? size === first.size : size === test.size
        const hashOk = sha256 === test.sha256
        log(`loaded: ${size} bytes in ${seconds.toFixed(1)} s (${megabytes(size / seconds)} MB/s on average, ${megabytes(peakRate)} MB/s at most), size ${sizeOk ? "as expected" : "WRONG"}, SHA-256 ${hashOk ? "equal" : "DIFFERENT"}; ${downloadEvents} status events, ${gapText}`)

        // stop and start: the torrent comes back from its resume data, complete, without loading again
        await step("stop", () => torrent.stop())
        const restarted = performance.now()
        const back = new Promise<TorrentStatus | null>(resolve => {
            const timer = setTimeout(() => resolve(null), RESUME_PATIENCE_MS)
            onEvent = status => {
                if (status.state === "checking") return
                clearTimeout(timer)
                resolve(status)
            }
        })
        await step("start", () => torrent.start(settings))
        const resumed = await step("resume", () => back)
        onEvent = () => {}
        const resumeOk = resumed !== null && resumed.progress === 1 && resumed.piecesHave === resumed.pieces && (resumed.state === "finished" || resumed.state === "seeding")
        log(`restart: ${resumed ? `${resumed.state}, pieces ${resumed.piecesHave}/${resumed.pieces} after ${(performance.now() - restarted).toFixed(0)} ms` : "no status"} → ${resumeOk ? "back from resume data" : "NOT BACK"}`)

        await step("remove", () => torrent.remove(infoHash, true))
        const gone = !(await fileInfo()).exists
        log(`removed with files: file ${gone ? "gone" : "STILL THERE"}`)

        // the magnet link of the same torrent: read, added without a file list, removed
        const magnetHash = await step("magnet", () => torrent.addMagnet(`magnet:?xt=urn:btih:${infoHash.toUpperCase()}`, saveFolder))
        const magnetStatus = await step("status", () => torrent.status(magnetHash))
        await step("remove", () => torrent.remove(magnetHash, false))
        const magnetOk = magnetHash === infoHash && !magnetStatus.hasMetadata
        log(`magnet link: hash ${magnetHash === infoHash ? "equal" : "DIFFERENT"}, state ${magnetStatus.state}, metadata ${magnetStatus.hasMetadata ? "THERE" : "not yet"}`)

        await step("stop", () => torrent.stop())
        client = null
        if (sizeOk && hashOk && resumeOk && gone && magnetOk) result = "ok"
    }
    catch (error) {
        log(`self test failed: ${clean(error)}`)
    }
    finally {
        unlisten()
        watch.leave()
        const late = stopTimer()
        try {
            await client?.stop()
        }
        catch {
            // the failure above is the one that counts
        }
        try {
            await step("folder", () => deleteAsync(data.uri, { idempotent: true }))
        }
        catch {
            // left for the system's cache cleaning
        }
        const longest = pieces.length > 0 ? Math.max(...pieces) : 0
        log(`self test ${result}: longest piece on the app's thread ${longest.toFixed(1)} ms of ${pieces.length} (limit ${LONGEST_PIECE_MS} ms, ${over.length} over${over.length > 0 ? `: ${over.join(", ")}` : ""}); a 2 ms timer was late by ${late.toFixed(1)} ms at most (idle before: ${idleLate.toFixed(1)} ms)`)
        running = false
    }
}
