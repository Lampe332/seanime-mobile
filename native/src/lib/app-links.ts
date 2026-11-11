import { APP_VARIANT } from "@/lib/app-variant"

/**
 * Where a link from outside (widget, launcher shortcut, notification, AniList/MyAnimeList page, shared text) opens in the
 * app (AppLinks.kt). Pure, so it can be unit tested; app-links-handler.tsx does the navigation.
 */
export type AppLinkTarget =
/** A page of the app: a path with its query. */
    | { kind: "page", path: string }
    /** A MyAnimeList anime; the app works with AniList ids, so it is looked up first. */
    | { kind: "mal", malId: number }

export const page = (path: string): AppLinkTarget => ({ kind: "page", path })
export const malAnime = (malId: number): AppLinkTarget => ({ kind: "mal", malId })

const SHORTCUT_PAGES = new Set(["/", "/search", "/android-downloads", "/schedule"])

/**
 * The app's own link schemes: `seanime` (the old app's links, widgets and shortcuts, and the release's scheme) and
 * `seanime-native` (the test package).
 */
export const APP_LINK_SCHEMES = new Set(["seanime", "seanime-native"])

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

export function appLinkTarget(link: string | null | undefined): AppLinkTarget | null {
    const uri = parse(link?.trim() ?? "")
    if (!uri) return null
    const segments = uri.path.split("/").filter(Boolean)
    const host = uri.host.replace(/^www\./, "")
    if (APP_LINK_SCHEMES.has(uri.scheme)) {
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
