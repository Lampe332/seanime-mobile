import { APP_VARIANT, APP_VARIANT_NAME } from "@/lib/app-variant"

/**
 * Where a link from outside (widget, launcher shortcut, notification, AniList/MyAnimeList page, shared text) opens in the
 * app (AppLinks.kt). Pure, so it can be unit tested; app-links-handler.tsx does the navigation.
 */
export type AppLinkTarget =
/** A page of the app: a path with its query. */
    | { kind: "page", path: string }
    /** A MyAnimeList anime; the app works with AniList ids, so it is looked up first. */
    | { kind: "mal", malId: number }
    /** Test and scratch app only: run the move of the server's data into the core again (docs/EIGENER-KERN.md §4c). */
    | { kind: "core-move" }
    /** Test and scratch app only: the one AniList account the core may change, null for none (docs/EIGENER-KERN.md §4f). */
    | { kind: "core-write-account", account: number | null }
    /** Test and scratch app only: cut the core off from AniList as without a network, or connect it again (§4f). */
    | { kind: "core-anilist", reachable: boolean }
    /** Test and scratch app only: the sandbox for extensions proves its limits on this device (docs/EIGENER-KERN.md §4h). */
    | { kind: "core-sandbox-selftest" }
    /** Test and scratch app only: the account's test vectors with the device's libsodium (lib/account-sodium-selftest.ts) */
    | { kind: "core-sodium-selftest" }
    /** Test and scratch app only: logs what the app holds in memory (Hermes, read answers, sandboxes, torrent), §4p 5c-3 */
    | { kind: "core-memory" }
    /** Test and scratch app only: runs extension code brought to the device for this one test, with the real network (§4k). */
    | { kind: "core-sandbox-practice" }
    /** Test and scratch app only: the torrent module loads the test's own file from one direct peer and checks it (docs/EIGENER-KERN.md §4q) */
    | { kind: "core-torrent-selftest", file: string, peerHost: string, peerPort: number, sha256: string, size: number | null }
    /** Test and scratch app only: the torrent module's outlet serves the test's own file in parts while it loads, each compared by its hash; with the area `torrent` on, the area prepares and stops a stream of it without the player (§4q, 6b-2) */
    | { kind: "core-torrent-search-check", mediaId: number, episodeNumber: number, provider: string }
    /** Test and scratch app only: searches TVs over DLNA and asks them, reading only, for transport state and volume (§4r 7c-1) */
    | { kind: "core-cast-check" }
    | { kind: "core-cast-outlet-check" }
    | { kind: "core-torrent-stream-check", file: string, peerHost: string, peerPort: number, size: number, parts: { first: number, last: number, sha256: string }[], mediaId: number }
    | { kind: "core-torrent-client-check", step: "start" | "add" | "peer" | "list" | "pause" | "resume" | "remove" | "remove-keep-files" | "hash", hash: string, file: string, peerHost: string, peerPort: number, folder: string }
    /** Test and scratch app only: a check link that cannot be read, said in the log with the reason instead of dropped (4.2.0 E) */
    | { kind: "core-check-refused", check: string, reason: string }
    /** Test and scratch app only: reads the online streams of these anime, as the hooks would, and logs a summary (§4m). Nothing is changed. */
    | { kind: "core-streams-check", mediaIds: number[], query: string, searchOnly: string[] }
    /** Test and scratch app only: installs one extension through the screens' door and logs time and longest piece (§4m 3f-3) */
    | { kind: "core-install-check", url: string }
    /** Test and scratch app only: sets, reads and removes a provider's mapping, then empties the cache, and logs each step (§4m 3f-3) */
    | { kind: "core-mapping-check", mediaId: number, provider: string, query: string, entry: string }
    /** Test and scratch app only: reads one manga as the hooks would and logs numbers (§4n). Nothing is changed. */
    | { kind: "core-manga-check", mediaId: number, provider: string, query: string }
    /** Test and scratch app only: writes mapping, cache and filters of one manga and puts them back at once, logs numbers (§4n) */
    | { kind: "core-manga-write", mediaId: number, provider: string }
    /** Test and scratch app only: saves the first chapters of one manga through the core's downloads, or removes them again (§4o) */
    | { kind: "core-manga-download", mediaId: number, provider: string, count: number, remove: boolean }
    /** Test and scratch app only: the device's loader loads one file, is cancelled once, continues, and logs size and hash (§4o) */
    | { kind: "core-download-selftest", url: string, referer: string, sha256: string, size: number | null, stopAt: number, way: "" | "work" }
    /** Test and scratch app only: queues one episode in the core's downloads, follows it, checks its files and removes it (§4o, 4b-B) */
    | { kind: "core-offline-check", url: string, type: "m3u8" | "mp4", referer: string, subtitle: string, sha256: string, size: number | null, mediaId: number, provider: string, episode: number, title: string, keep: boolean, cover: string, banner: string, image: string, episodeTitle: string, description: string }
    /** Test and scratch app only: removes one episode of the core's downloads (§4o, 4b-B) */
    | { kind: "core-offline-remove", id: string }
    /** Test and scratch app only: logs the core's downloads (§4o, 4b-B) */
    | { kind: "core-offline-list" }
    /** Test and scratch app only: shows the first start again as a preview; account and settings stay as they are */
    | { kind: "dev-intro" }
    /** Test and scratch app only: sets the known manga chapters one back and checks them with notifications (lib/updates/chapter-check.ts) */
    | { kind: "dev-check-updates" }

export const page = (path: string): AppLinkTarget => ({ kind: "page", path })
export const malAnime = (malId: number): AppLinkTarget => ({ kind: "mal", malId })

const SHORTCUT_PAGES = new Set(["/", "/search", "/android-downloads", "/schedule"])

/**
 * The app's own link schemes: `seanime` (the old app's links, widgets and shortcuts, and the release's scheme) and
 * `seanime-native` (the test package) and `seanime-scratch` (the throw-away app, docs/EIGENER-KERN.md §6).
 */
export const APP_LINK_SCHEMES = new Set(["seanime", "seanime-native", "seanime-scratch"])

/**
 * The scheme this build registers (app-variants.json `scheme`, set by app.config.js) and puts into its own links, so a
 * widget or notification of the test package never opens the real app's `seanime://` handler. Release: `seanime`.
 */
export const APP_SCHEME = APP_VARIANT.scheme

function positiveId(value: string | null | undefined): number | null {
    if (!value || !/^\d+$/.test(value)) return null
    const id = Number(value)
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** The value of key in a raw query string, decoded (null when missing or without "="). */
function query(rawQuery: string, key: string): string | null {
    for (const part of rawQuery.split("&")) {
        const index = part.indexOf("=")
        if (index < 0 || part.slice(0, index) !== key) continue
        try {
            return decodeURIComponent(part.slice(index + 1).replace(/\+/g, " "))
        }
        catch {
            return null
        }
    }
    return null
}

type ParsedLink = { scheme: string, host: string, path: string, query: string }

/** A minimal URI split like java.net.URI: scheme://host/path?query (URL() cannot be trusted with custom schemes on Hermes). */
function parse(link: string): ParsedLink | null {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/.exec(link)
    if (!match) return null
    const authority = match[2]
    // user info and port do not belong to the host
    const host = authority.replace(/^[^@]*@/, "").replace(/:\d*$/, "").toLowerCase()
    if (/\s/.test(link)) return null
    return { scheme: match[1].toLowerCase(), host, path: match[3] ?? "", query: match[4] ?? "" }
}

/**
 * `variant` is the build (app-variants.json): only the test app, which sits next to the real one for trying things out,
 * and the throw-away scratch app take the link that switches an area to the app's own core. The release has no way to
 * switch one on.
 */
export function appLinkTarget(link: string | null | undefined, variant: string = APP_VARIANT_NAME): AppLinkTarget | null {
    const uri = parse(link?.trim() ?? "")
    if (!uri) return null
    const segments = uri.path.split("/").filter(Boolean)
    const host = uri.host.replace(/^www\./, "")
    if (APP_LINK_SCHEMES.has(uri.scheme)) {
        if (host === "core" && (variant === "test" || variant === "scratch")) {
            const memory = query(uri.query, "memory")
            if (memory !== null) return memory === "report" ? { kind: "core-memory" } : null
            const move = query(uri.query, "move")
            if (move !== null) return move === "again" ? { kind: "core-move" } : null
            const writeAccount = query(uri.query, "write-account")
            if (writeAccount !== null) {
                const account = positiveId(writeAccount)
                return account || writeAccount === "none" ? { kind: "core-write-account", account } : null
            }
            const anilist = query(uri.query, "anilist")
            if (anilist !== null) return anilist === "down" || anilist === "up" ? { kind: "core-anilist", reachable: anilist === "up" } : null
            const sandbox = query(uri.query, "sandbox")
            if (sandbox !== null) return sandbox === "selftest" ? { kind: "core-sandbox-selftest" } : sandbox === "practice" ? { kind: "core-sandbox-practice" } : null
            const sodium = query(uri.query, "sodium")
            if (sodium !== null) return sodium === "selftest" ? { kind: "core-sodium-selftest" } : null
            const cast = query(uri.query, "cast")
            if (cast !== null) return cast === "discover" ? { kind: "core-cast-check" } : cast === "outlet-check" ? { kind: "core-cast-outlet-check" } : null
            const torrent = query(uri.query, "torrent")
            if (torrent !== null) {
                if (torrent === "search-check") {
                    // read only: the torrent search of one anime's episode, core against server (numbers only in the log)
                    const mediaId = positiveId(query(uri.query, "media"))
                    const provider = query(uri.query, "provider") ?? ""
                    if (mediaId === null || !/^[A-Za-z0-9._-]*$/.test(provider)) return null
                    return { kind: "core-torrent-search-check", mediaId, episodeNumber: positiveId(query(uri.query, "episode")) ?? 1, provider }
                }
                // the .torrent file itself (base64url), one peer by its IP address, and the hash the loaded file must have
                const file = query(uri.query, "file") ?? ""
                const peer = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(query(uri.query, "peer") ?? "")
                const peerPort = Number(peer?.[2] ?? 0)
                if (torrent === "stream-check") {
                    // the file's size and four parts of it, each `<first byte>-<last byte>.<SHA-256>`: the start, a jump, the end, another one
                    const size = positiveId(query(uri.query, "size"))
                    const parts = (query(uri.query, "parts") ?? "").toLowerCase().split(",").flatMap(part => {
                        const found = /^(\d{1,15})-(\d{1,15})\.([0-9a-f]{64})$/.exec(part)
                        return found ? [{ first: Number(found[1]), last: Number(found[2]), sha256: found[3] ?? "" }] : []
                    })
                    if (!/^[A-Za-z0-9_-]{20,}$/.test(file) || !peer?.[1] || peerPort < 1 || peerPort > 65535 || size === null || parts.length !== 4 || parts.some(part => part.last < part.first || part.last >= size)) return null
                    return { kind: "core-torrent-stream-check", file, peerHost: peer[1], peerPort, size, parts, mediaId: positiveId(query(uri.query, "media")) ?? 0 }
                }
                if (torrent === "client-check") {
                    // phase 6f: one step of the torrent client per link (core-torrent-client-check.ts)
                    const step = query(uri.query, "do") ?? ""
                    const hash = (query(uri.query, "hash") ?? "").toLowerCase()
                    const folder = query(uri.query, "folder") ?? "check"
                    // a link that cannot be read is said in the log (4.2.0 E): dropped, it looked like a step that ran
                    const refused = (reason: string): AppLinkTarget => ({ kind: "core-check-refused", check: "torrent client-check", reason })
                    if (!["start", "add", "peer", "list", "pause", "resume", "remove", "remove-keep-files", "hash"].includes(step)) return refused(`unknown step "${step}"`)
                    if (!/^[a-z0-9-]{1,20}$/.test(folder)) return refused("folder must be 1 to 20 of a-z, 0-9, -")
                    if (step === "add" && (!/^[A-Za-z0-9_-]{20,}$/.test(file) || !peer?.[1] || peerPort < 1 || peerPort > 65535)) return refused("add needs file=<.torrent base64url> and peer=<IP>:<port>")
                    if (!["start", "add", "list"].includes(step) && !/^[0-9a-f]{40}$/.test(hash)) return refused(`${step} needs hash=<40 hex>`)
                    return { kind: "core-torrent-client-check", step: step as "start", hash, file, peerHost: peer?.[1] ?? "", peerPort: peer?.[1] ? peerPort : 0, folder }
                }
                const sha256 = (query(uri.query, "sha256") ?? "").toLowerCase()
                if (torrent !== "selftest" || !/^[A-Za-z0-9_-]{20,}$/.test(file) || !peer?.[1] || peerPort < 1 || peerPort > 65535 || !/^[0-9a-f]{64}$/.test(sha256)) return null
                return { kind: "core-torrent-selftest", file, peerHost: peer[1], peerPort, sha256, size: positiveId(query(uri.query, "size")) }
            }
            const download = query(uri.query, "download")
            if (download !== null) {
                const url = query(uri.query, "url") ?? ""
                if (download !== "selftest" || !/^https?:\/\//i.test(url)) return null
                const sha256 = (query(uri.query, "sha256") ?? "").toLowerCase()
                const stop = query(uri.query, "stop") ?? ""
                return {
                    kind: "core-download-selftest", url, referer: query(uri.query, "referer") ?? "",
                    sha256: /^[0-9a-f]{64}$/.test(sha256) ? sha256 : "", size: positiveId(query(uri.query, "size")),
                    stopAt: /^\d{1,2}$/.test(stop) ? Number(stop) : 25, way: query(uri.query, "way") === "work" ? "work" : "",
                }
            }
            const offline = query(uri.query, "offline")
            if (offline !== null) {
                if (offline === "list") return { kind: "core-offline-list" }
                if (offline === "remove") {
                    const id = query(uri.query, "id") ?? ""
                    return /^[A-Za-z0-9._-]+$/.test(id) ? { kind: "core-offline-remove", id } : null
                }
                if (offline !== "check") return null
                const web = (address: string) => /^https?:\/\//i.test(address)
                const url = query(uri.query, "url") ?? ""
                const provider = query(uri.query, "provider") ?? ""
                const mediaId = positiveId(query(uri.query, "media"))
                // an address to save as the player would, or an episode of a provider
                if (url === "" ? mediaId === null || provider === "" : !web(url)) return null
                const sha256 = (query(uri.query, "sha256") ?? "").toLowerCase()
                const subtitle = query(uri.query, "subtitle") ?? ""
                return {
                    kind: "core-offline-check", url, type: query(uri.query, "type") === "mp4" ? "mp4" : "m3u8", referer: query(uri.query, "referer") ?? "",
                    subtitle: web(subtitle) ? subtitle : "", sha256: /^[0-9a-f]{64}$/.test(sha256) ? sha256 : "", size: positiveId(query(uri.query, "size")),
                    mediaId: mediaId ?? 1, provider, episode: positiveId(query(uri.query, "episode")) ?? 1, title: query(uri.query, "title") ?? "Download check",
                    keep: query(uri.query, "keep") === "1",
                    // what the screens send along with an episode: its pictures and texts (saved with it, phase 4b-C1)
                    cover: [query(uri.query, "cover") ?? ""].filter(web)[0] ?? "", banner: [query(uri.query, "banner") ?? ""].filter(web)[0] ?? "",
                    image: [query(uri.query, "image") ?? ""].filter(web)[0] ?? "", episodeTitle: query(uri.query, "etitle") ?? "", description: query(uri.query, "text") ?? "",
                }
            }
            const manga = query(uri.query, "manga")
            if (manga !== null) {
                const mediaId = positiveId(query(uri.query, "media") ?? "")
                const provider = query(uri.query, "provider") ?? ""
                if (mediaId === null || provider === "") return null
                if (manga === "write") return { kind: "core-manga-write", mediaId, provider }
                if (manga === "download" || manga === "remove") return { kind: "core-manga-download", mediaId, provider, count: Math.min(5, positiveId(query(uri.query, "count") ?? "") ?? 1), remove: manga === "remove" }
                return manga === "check" ? { kind: "core-manga-check", mediaId, provider, query: query(uri.query, "query") ?? "" } : null
            }
            const streams = query(uri.query, "streams")
            if (streams === "mapping") {
                const mediaId = positiveId(query(uri.query, "media") ?? "")
                const provider = query(uri.query, "provider") ?? ""
                return mediaId !== null && provider !== "" ? { kind: "core-mapping-check", mediaId, provider, query: query(uri.query, "query") ?? "", entry: query(uri.query, "entry") ?? "" } : null
            }
            if (query(uri.query, "extensions") === "install") {
                const url = query(uri.query, "url") ?? ""
                return /^https?:\/\//i.test(url) ? { kind: "core-install-check", url } : null
            }
            if (streams !== null) {
                const mediaIds = (query(uri.query, "media") ?? "").split(",").map(positiveId).filter((id): id is number => id !== null)
                return streams === "check" && mediaIds.length > 0 ? {
                    kind: "core-streams-check", mediaIds, query: query(uri.query, "query") ?? "",
                    // providers that get the search only: no episode list, no source (`searchonly=a,b`)
                    searchOnly: (query(uri.query, "searchonly") ?? "").split(",").map(id => id.trim()).filter(id => id !== ""),
                } : null
            }
            return null
        }
        if (host === "dev" && (variant === "test" || variant === "scratch")) {
            if (segments.length === 1 && segments[0] === "anilist-down") {
                // the outage switch for showing the sync hint (same as core?anilist=down|up): on=1 cuts AniList off, on=0 ends it
                const on = query(uri.query, "on")
                return on === "1" || on === "0" ? { kind: "core-anilist", reachable: on === "0" } : null
            }
            if (segments.length === 1 && segments[0] === "check-updates") return { kind: "dev-check-updates" }
            return segments.length === 1 && segments[0] === "intro" ? { kind: "dev-intro" } : null
        }
        if (host === "manga") {
            // a new-chapter notification opens the manga page
            const id = positiveId(query(uri.query, "id"))
            return id ? page(`/manga/entry?id=${id}`) : null
        }
        if (host === "entry") {
            const id = positiveId(query(uri.query, "id"))
            return id ? page(`/entry?id=${id}`) : null
        }
        if (host === "open") {
            const path = query(uri.query, "path")
            return path && SHORTCUT_PAGES.has(path) ? page(path) : null
        }
        return null
    }
    if (uri.scheme !== "http" && uri.scheme !== "https") return null
    if (segments[0] !== "anime") return null
    const id = positiveId(segments[1])
    if (!id) return null
    if (host === "anilist.co") return page(`/entry?id=${id}`)
    if (host === "myanimelist.net") return malAnime(id)
    return null
}

/** java.net.URLEncoder: spaces as "+", and the few characters it leaves alone. */
function formEncode(value: string): string {
    return encodeURIComponent(value).replace(/%20/g, "+").replace(/[!'()~]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())
}

/** The first AniList or MyAnimeList link in shared text; other text is searched as a title. */
export function sharedTextTarget(text: string | null | undefined): AppLinkTarget | null {
    const value = text?.trim() ?? ""
    if (!value) return null
    for (const match of value.matchAll(/https?:\/\/\S+/g)) {
        const target = appLinkTarget(match[0])
        if (target) return target
    }
    if (value.startsWith("http://") || value.startsWith("https://")) return null
    return page("/search?q=" + formEncode(Array.from(value).slice(0, 100).join("")))
}

/** The link a widget row, a notification or a shortcut opens. */
export function entryLink(mediaId: number): string {
    return `${APP_SCHEME}://entry?id=${mediaId}`
}

/** The link a new-chapter notification opens: the manga page. */
export function mangaLink(mediaId: number): string {
    return `${APP_SCHEME}://manga?id=${mediaId}`
}

export function shortcutLink(path: "/search" | "/android-downloads" | "/schedule"): string {
    return `${APP_SCHEME}://open?path=${path}`
}

/**
 * Long-pressing the launcher icon (MainActivity.publishShortcuts): id, English/German label, page and icon. The icons are
 * the same system drawables as before (`android.R.drawable.*`); expo-quick-actions resolves the name with
 * `Resources.getIdentifier`, which takes the fully qualified "android:drawable/…". Without an icon the launcher shows
 * the rows bare.
 */
export const LAUNCHER_SHORTCUTS = [
    { id: "search", en: "Search", de: "Suche", path: "/search", icon: "android:drawable/ic_menu_search" },
    { id: "downloads", en: "Downloads", de: "Downloads", path: "/android-downloads", icon: "android:drawable/stat_sys_download_done" },
    { id: "schedule", en: "Schedule", de: "Sendeplan", path: "/schedule", icon: "android:drawable/ic_menu_my_calendar" },
] as const
