// geschrieben nach: docs/EIGENER-KERN.md §4q (Phase 6b-2: Ausgang und Prüf-Link) und §4b (Wächter), RFC 7233 (Range, 206, 416, Content-Range), Doku von expo/fetch (Körper als Strom, AbortSignal), expo-crypto (digest) und expo-file-system/legacy (deleteAsync); kein Server-Quelltext
import { buildSeaQuery } from "@/api/client/requests"
import { LONGEST_PIECE_MS, coreAnswerFor, createBlockingWatch, runningTorrentStream } from "@/core"
import { logger } from "@/lib/helpers/debug"
import { CryptoDigestAlgorithm, digest } from "expo-crypto"
import { cacheDirectory, deleteAsync, documentDirectory } from "expo-file-system/legacy"
import { fetch as streamFetch } from "expo/fetch"
import { type TorrentClient, type TorrentSettings, base64UrlBytes, deviceTorrent, isOutletAddress, plainPath } from "./core-torrent"

export type TorrentStreamPart = { first: number, last: number, sha256: string }

export type TorrentStreamCheck = {
    /** The `.torrent` file of the test's own file, base64url */
    file: string
    peerHost: string
    peerPort: number
    /** The size of the one file */
    size: number
    /** Four parts of the file with the SHA-256 each must have: the start, a jump, the end, another one */
    parts: TorrentStreamPart[]
    /** The anime the area's part of the check names (0: left out) */
    mediaId: number
}

const log = (text: string) => logger("CoreTorrent").info(text)
const clean = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "<address>").replace(/\/?\d{1,3}(\.\d{1,3}){3}(:\d+)?/g, "<host>").slice(0, 200)
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("")

type Step = <Result>(name: string, work: () => Promise<Result>) => Promise<Result>
type Answer = { status: number, contentRange: string, length: number, bytes: Uint8Array, firstByteMs: number, allMs: number }

/** One request to the outlet, its body read as it comes; `cutAfterFirst` ends the request after the first bytes */
async function ask(step: Step, address: string, range: string | null, cutAfterFirst = false, method = "GET"): Promise<Answer> {
    const started = performance.now()
    const control = new AbortController()
    const response = await step("request", () => streamFetch(address, { method, headers: range ? { Range: range } : {}, signal: control.signal }))
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let got = 0
    let firstByteMs = -1
    while (reader) {
        const { done, value } = await step("body", () => reader.read())
        if (done) break
        if (value && value.length > 0) {
            if (firstByteMs < 0) firstByteMs = performance.now() - started
            chunks.push(value)
            got += value.length
            if (cutAfterFirst) {
                control.abort()
                break
            }
        }
    }
    const bytes = new Uint8Array(got)
    let at = 0
    for (const chunk of chunks) {
        bytes.set(chunk, at)
        at += chunk.length
    }
    return { status: response.status, contentRange: response.headers.get("content-range") ?? "", length: Number(response.headers.get("content-length") ?? -1), bytes, firstByteMs, allMs: performance.now() - started }
}

let running = false

/*
 * Test and scratch app only (link `core?torrent=stream-check&file=<.torrent as base64url>&peer=<ip>:<port>&size=<bytes>
 * &parts=<first>-<last>.<sha256>,… (four)[&media=<AniList id>]`): the module's outlet on this device. With every way of
 * finding peers off, the test's own `.torrent` file is added and its file served; while it loads from the one peer the
 * link names, the app itself asks the outlet: HEAD, a wrong token, the start, a jump ahead of the download (time to its
 * first byte), two readers at once (the end and another part), a reader that is cut off, a range beyond the file. Every
 * part is compared by its SHA-256. With the area `torrent` on, the area then starts a stream of the same torrent
 * without the player (`playbackType: "none"`), and stops it. Nothing is played. Numbers only in the log ([CoreTorrent]).
 */
export async function runCoreTorrentStreamCheck(check: TorrentStreamCheck): Promise<void> {
    if (running) return
    running = true
    const pieces: number[] = []
    const over: string[] = []
    const watch = createBlockingWatch({
        now: () => performance.now(),
        onPiece: (milliseconds, _what, where) => {
            pieces.push(milliseconds)
            if (milliseconds > LONGEST_PIECE_MS) over.push(`${milliseconds.toFixed(1)} ms ${where.from} → ${where.until}`)
        },
        free: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
    })
    const step: Step = (name, work) => watch.waiting(work, name)()
    const folder = `${cacheDirectory}core-torrent-stream-check`
    const failed: string[] = []
    const expect = (ok: boolean, what: string) => {
        if (!ok) failed.push(what)
        return ok ? "ok" : "WRONG"
    }
    let client: TorrentClient | null = null
    let infoHash = ""
    log("stream check started")
    watch.enter("torrent stream check")
    try {
        const [start, jump, end, other] = check.parts
        const file = base64UrlBytes(check.file)
        if (!file || file.length === 0 || !start || !jump || !end || !other) throw new Error("the link cannot be read")
        const settings: TorrentSettings = { folder: plainPath(`${documentDirectory}core-torrent`), dht: false, lsd: false, trackers: false, pex: false, portMapping: false, utp: false }
        await step("folder", () => deleteAsync(folder, { idempotent: true }))
        const torrent = await step("module", deviceTorrent)
        client = torrent
        await step("stop", () => torrent.stop())
        await step("start", () => torrent.start(settings))
        const hash = await step("add", () => torrent.addTorrentFile(file, plainPath(folder)))
        infoHash = hash
        const first = (await step("files", () => torrent.files(hash)))[0]
        if (!first || first.size !== check.size) throw new Error("the torrent's file is not the one the link describes")
        await step("priority", () => torrent.setFilePriority(hash, first.index, 7))
        await step("sequential", () => torrent.setSequential(hash, true))
        const address = await step("serve", () => torrent.serve(hash, first.index))
        const have = async () => {
            const status = await step("status", () => torrent.status(hash))
            return `${status.piecesHave}/${status.pieces}`
        }

        // before any peer: the head of the answer needs no piece
        const head = await ask(step, address, null, false, "HEAD")
        const wrongToken = await ask(step, address.replace(/\/[0-9a-f]{32}\//, `/${"0".repeat(32)}/`), null)
        log(`outlet: address ${expect(isOutletAddress(address), "address")} (loopback, token of 32 hex digits); HEAD ${head.status}, length ${expect(head.status === 200 && head.length === check.size && head.bytes.length === 0, "HEAD")}; wrong token ${wrongToken.status} ${expect(wrongToken.status === 404, "wrong token")}`)

        const part = async (name: string, wanted: TorrentStreamPart, header = `bytes=${wanted.first}-${wanted.last}`) => {
            const before = await have()
            const answer = await ask(step, address, header)
            const sha256 = hex(await step("hash", () => digest(CryptoDigestAlgorithm.SHA256, answer.bytes as BufferSource)))
            const size = wanted.last - wanted.first + 1
            const ok = answer.status === 206 && answer.contentRange === `bytes ${wanted.first}-${wanted.last}/${check.size}` && answer.length === size && answer.bytes.length === size && sha256 === wanted.sha256
            log(`${name}: ${answer.status}, Content-Range ${answer.contentRange === `bytes ${wanted.first}-${wanted.last}/${check.size}` ? "as expected" : "WRONG"}, ${answer.bytes.length} of ${size} bytes, SHA-256 ${sha256 === wanted.sha256 ? "equal" : "DIFFERENT"}, first byte after ${answer.firstByteMs.toFixed(0)} ms, all after ${answer.allMs.toFixed(0)} ms, pieces before ${before} → ${expect(ok, name)}`)
        }

        await step("peer", () => torrent.connectPeer(hash, check.peerHost, check.peerPort))
        await part("start", start)
        await part("jump", jump)
        // two readers at once: the end of the file (asked for as "the last n bytes") and another part
        await Promise.all([part("end, reader 1 of 2", end, `bytes=-${end.last - end.first + 1}`), part("other, reader 2 of 2", other)])

        // a reader that goes away in the middle of an answer without an end, then the outlet must still serve
        const cut = await ask(step, address, `bytes=${jump.first}-`, true)
        log(`cut off: ${cut.status}, ${cut.bytes.length} bytes read, then closed → ${expect(cut.status === 206 && cut.bytes.length > 0, "cut off")}`)
        await part("after the cut", start)
        const beyond = await ask(step, address, `bytes=${check.size}-`)
        log(`beyond the file: ${beyond.status}, Content-Range ${beyond.contentRange === `bytes */${check.size}` ? "as expected" : "WRONG"} → ${expect(beyond.status === 416 && beyond.contentRange === `bytes */${check.size}`, "beyond the file")}`)

        // the area: the same torrent by its info hash, prepared without the player, its address asked once, stopped
        if (check.mediaId > 0) {
            const byCore = ["start", "stop", "batch-history"].every(name => coreAnswerFor("POST", `/api/v1/torrentstream/${name}`) !== null)
            const started = await step("area start", () => buildSeaQuery<boolean>({
                endpoint: "/api/v1/torrentstream/start", method: "POST",
                data: { mediaId: check.mediaId, episodeNumber: 1, aniDBEpisode: "1", autoSelect: false, torrent: { name: first.path, infoHash: hash }, playbackType: "none", clientId: "" },
            }))
            const stream = runningTorrentStream()
            // the area asked the outlet for the same file: its address is the one from above
            const streamHead = stream ? await ask(step, address, "bytes=0-0") : null
            const history = await step("area history", () => buildSeaQuery<Record<string, unknown>>({ endpoint: "/api/v1/torrentstream/batch-history", method: "POST", data: { mediaId: check.mediaId } }))
            const stopped = await step("area stop", () => buildSeaQuery<boolean>({ endpoint: "/api/v1/torrentstream/stop", method: "POST" }))
            const ok = byCore && started === true && stream?.index === first.index && streamHead?.status === 206 && history?.torrent === null && stopped === true && runningTorrentStream() === null
            log(`area torrent: answered by the core ${byCore ? "yes" : "NO"}; start ${started === true ? "ok" : "FAILED"}, stream of file ${stream?.index ?? "?"} prepared for the player (address of the outlet ${streamHead ? `answers ${streamHead.status}` : "MISSING"}; not handed over: nothing is played here), batch history ${history?.torrent === null ? "empty (one file)" : "UNEXPECTED"}, stop ${stopped === true ? "ok" : "FAILED"}, running after: ${runningTorrentStream() ? "STILL" : "none"} → ${expect(ok, "area")}`)
            // the area's stop removed the torrent and ended the session
            infoHash = ""
        }
        else {
            log("area torrent: no anime named, not asked")
        }
    }
    catch (error) {
        failed.push("an error")
        log(`stream check failed: ${clean(error)}`)
    }
    finally {
        watch.leave()
        try {
            if (infoHash) await client?.remove(infoHash, true)
            await client?.stop()
        }
        catch {
            // the failure above is the one that counts
        }
        await deleteAsync(folder, { idempotent: true }).catch(() => {})
        const longest = pieces.length > 0 ? Math.max(...pieces) : 0
        log(`stream check ${failed.length === 0 ? "ok" : `FAILED (${failed.join(", ")})`}: longest piece on the app's thread ${longest.toFixed(1)} ms of ${pieces.length} (limit ${LONGEST_PIECE_MS} ms, ${over.length} over${over.length > 0 ? `: ${over.join(", ")}` : ""})`)
        running = false
    }
}
