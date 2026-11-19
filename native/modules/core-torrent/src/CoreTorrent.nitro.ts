// geschrieben nach: Plan „Eigener Kern" Stufe 6b-1, docs/EIGENER-KERN.md §4q (Skizze der Schnittstelle), der öffentlichen Doku von libtorrent 2.1 (session, torrent_handle, torrent_status) und von Nitro Modules (HybridObject, Promise, Callback, ArrayBuffer); keine Vorlage
import type { HybridObject } from "react-native-nitro-modules"

/** How the session starts. Plain paths, not `file://` addresses. */
export interface CoreTorrentSettings {
    /** The session's own folder inside the app's storage: its state and the resume data of every torrent */
    folder: string
    /** The port to listen on; 0: any free one */
    listenPort: number
    /** The most peer connections at once */
    connections: number
    /** Find peers through the DHT */
    dht: boolean
    /** Find peers in the local network (local service discovery) */
    lsd: boolean
    /** Ask the trackers a torrent names; off: they are dropped when a torrent is added */
    trackers: boolean
    /** Learn peers from peers (peer exchange) */
    pex: boolean
    /** Ask the router for an open port (UPnP, NAT-PMP) */
    portMapping: boolean
    /** Speak uTP (BitTorrent over UDP) besides TCP; off: TCP only, and a peer is not tried over uTP first */
    utp: boolean
}

/** What the session may use (4.2.0). They hold for the torrents the app downloads; a torrent that is streamed stays outside. */
export interface CoreTorrentLimits {
    /** Bytes per second for all downloads together; 0: no limit. Lifted for a torrent that is served to the player. */
    downloadLimit: number
    /** Bytes per second for all uploads together; 0: no limit */
    uploadLimit: number
    /** How many queued torrents (`setQueued`) download at once; the others wait in their order */
    activeDownloads: number
    /** A torrent that has everything it wants is paused instead of shared on; not one that is served */
    stopWhenFinished: boolean
}

/** One file of a torrent. Pieces count from 0; `pieceEnd` is the last piece that holds bytes of the file. */
export interface CoreTorrentFile {
    index: number
    /** The path below the folder the torrent is saved to */
    path: string
    size: number
    /** Where the file starts in the torrent's bytes */
    offset: number
    pieceStart: number
    pieceEnd: number
}

export interface CoreTorrentStatus {
    /** 40 hex digits, lower case */
    infoHash: string
    name: string
    /** "checking" | "metadata" | "downloading" | "finished" | "seeding" | "paused" | "queued" (waits for its turn) */
    state: string
    /** Why the torrent stands still; "" for no error */
    error: string
    /** False while a magnet link has not got its file list yet */
    hasMetadata: boolean
    /** 0–1, of the files that are wanted */
    progress: number
    /** Bytes per second, payload only */
    downRate: number
    upRate: number
    /** Connected peers, and how many of them have the whole torrent */
    peers: number
    seeds: number
    /** Pieces that are complete, and all pieces (0 without metadata) */
    piecesHave: number
    pieces: number
    bytesDone: number
    bytesWanted: number
    /** Peers the torrent knows of, connected or not */
    peersKnown: number
    /** Nodes in the DHT's routing table (the whole session) */
    dhtNodes: number
    /** Announces to trackers since the torrent was added: answered, failed, and the last failure's text ("" for none) */
    trackersOk: number
    trackersFailed: number
    trackerError: string
    /** Web seed addresses the torrent has (BEP 19) */
    webSeeds: number
    /** Where a queued torrent (`setQueued`) stands among the torrents still downloading, from 0; -1: not in the queue */
    queuePosition: number
}

/**
 * The app's one BitTorrent session. Every method only hands work to the module's own thread and answers from there; a
 * failure rejects with a text that starts with `ERR_TORRENT: `. Apart from `start`, every method needs a running
 * session.
 */
export interface CoreTorrent extends HybridObject<{ ios: "c++", android: "c++" }> {
    /**
     * Starts the session and brings back the torrents of the last one from their resume data. `onStatus` is called
     * once per second with every torrent of the session, while there is one.
     */
    start(settings: CoreTorrentSettings, onStatus: (statuses: CoreTorrentStatus[]) => void): Promise<void>
    /** Saves the resume data and the session's state and ends the session; nothing happens without one */
    stop(): Promise<void>
    /** Adds a magnet link; the answer is the info hash. A torrent the session has already is answered with its hash. */
    addMagnet(uri: string, savePath: string): Promise<string>
    /** Adds the bytes of a `.torrent` file, like `addMagnet` */
    addTorrentFile(bytes: ArrayBuffer, savePath: string): Promise<string>
    /** Takes a torrent out of the session; with `deleteFiles` the answer comes when its files are gone */
    remove(infoHash: string, deleteFiles: boolean): Promise<void>
    /** The files of a torrent, without padding files; fails while a magnet link has no file list yet */
    files(infoHash: string): Promise<CoreTorrentFile[]>
    /** 0: not loaded, 1–7: loaded, 7 first */
    setFilePriority(infoHash: string, index: number, priority: number): Promise<void>
    /** Pieces in their order instead of the rarest first */
    setSequential(infoHash: string, on: boolean): Promise<void>
    /** Pauses or resumes one torrent (phase 6f); kept in its resume data, so a paused torrent stays paused after a restart */
    setPaused(infoHash: string, paused: boolean): Promise<void>
    /**
     * 4.2.0: takes a torrent into the download queue (or out of it). Of the queued torrents only `activeDownloads`
     * (`setLimits`) download at once, the rest wait as "queued"; kept in the resume data. A torrent that is served
     * (`serve`, `shareTorrent`) leaves the queue and runs.
     */
    setQueued(infoHash: string, queued: boolean): Promise<void>
    /** 4.2.0: the limits of the running session, from now on; they are kept with the session's state */
    setLimits(limits: CoreTorrentLimits): Promise<void>
    /**
     * 4.2.0: moves the files of a torrent to another folder (a plain path) and goes on from there; files of the same
     * name there are replaced. The answer comes when they are moved.
     */
    moveStorage(infoHash: string, savePath: string): Promise<void>
    /** Piece `firstPiece + n` is wanted within `firstMs + n * stepMs` milliseconds, for `count` pieces */
    setPieceDeadlines(infoHash: string, firstPiece: number, count: number, firstMs: number, stepMs: number): Promise<void>
    clearDeadlines(infoHash: string): Promise<void>
    status(infoHash: string): Promise<CoreTorrentStatus>
    /** Connects one peer by its IP address, past every way of finding peers (plain TCP, no encryption asked for) */
    connectPeer(infoHash: string, host: string, port: number): Promise<void>
    /**
     * The address one file of a torrent is served at for the app's player: `http://127.0.0.1:<port>/<token>/…`, GET and
     * HEAD with `Range`. A reader that asks for bytes the torrent does not have yet waits for them, and the download is
     * pulled to where it reads. The outlet starts with the first call and ends with the session.
     */
    serve(infoHash: string, index: number): Promise<string>
    /**
     * Phase 7b: shares a plain file of the app's storage (a path, not `file://`) into the local network for a TV, on a
     * second port of the outlet at the device's address toward `toward` (the TV's IPv4 address; "" for the Wi-Fi's):
     * `http://<address>:<port>/<token>/<name>`, a token of its own per share, GET and HEAD with `Range`. Needs no session.
     * The port closes with `unshare`, or by itself after 10 minutes without a reader.
     */
    shareFile(path: string, toward: string): Promise<string>
    /** Like `shareFile` for one file of a torrent of the session; a reader waits for pieces as on `serve` */
    shareTorrent(infoHash: string, index: number, toward: string): Promise<string>
    /** Every share into the network ends and its port closes; nothing happens without one */
    unshare(): Promise<void>
}
