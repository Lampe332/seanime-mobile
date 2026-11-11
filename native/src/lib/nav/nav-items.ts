import type { AppLanguage } from "@/lib/app-language"
import type { MobileIconName } from "@/lib/mobile-icons"

/*
 * The app's navigation entries, from UIBottomNav.kt (the injected bottom bar / tablet rail of the WebView app) and the web
 * sidebar (main-sidebar.tsx) whose entries filled the bar's Menu.
 *
 * Entry labels stay English: they are the storage keys of the order and the hidden entries (UIBottomNav.kt kept them in
 * localStorage under the keys below). Only the shown text is translated (navLabel).
 */
export const NAV_STORAGE_KEYS = {
    order: "__seanime_nav_order",
    placement: "__seanime_nav_placement",
    items: "__seanime_nav_items_full",
    floatHidden: "__seanime_float_hidden",
    floatOrder: "__seanime_float_order",
} as const

/** Entries in the bottom bar before it shrinks its icons and labels (the Menu button counts) */
export const MAX_NAV_ITEMS = 7

export type NavItem = {
    id: string
    /** route; null for the Menu button */
    href: string | null
    label: string
    matchExact: boolean
    placement: "nav" | "float"
    isMenu?: boolean
}

export const DEFAULT_NAV_ITEMS: NavItem[] = [
    { id: "home", href: "/", label: "Home", matchExact: true, placement: "nav" },
    { id: "lists", href: "/lists", label: "My Lists", matchExact: false, placement: "nav" },
    { id: "discover", href: "/discover", label: "Discover", matchExact: false, placement: "nav" },
    { id: "search", href: "/search", label: "Search", matchExact: false, placement: "nav" },
    { id: "menu", href: null, label: "Menu", matchExact: false, placement: "nav", isMenu: true },
]

const DOWNLOADS_ITEM: NavItem = { id: "android-downloads", href: "/android-downloads", label: "Downloads", matchExact: true, placement: "nav" }

/** Destinations the bar never shows again (the desktop torrent pages the Android app removed) */
const REMOVED_HREF = /^\/(torrent-list|torrent-client|auto-downloader)(\/|$)/

function navigationPath(href: string | null) {
    if (!href || href === "#") return ""
    return href.split(/[?#]/)[0].replace(/(.)\/+$/, "$1")
}

/** The old Offline entry (/sync) was replaced by Downloads; a saved bar drops it */
function isRemovedOfflineItem(item: Pick<NavItem, "href">) {
    return navigationPath(item.href) === "/sync"
}

function normKey(s: string | null | undefined) {
    return String(s || "").trim().toLowerCase()
}

/** Two entries point to the same destination when label (case-insensitive) or href match. */
function sameTarget(a: NavItem, b: NavItem) {
    if (normKey(a.label) && normKey(a.label) === normKey(b.label)) return true
    return !!a.href && !!b.href && a.href !== "#" && a.href === b.href
}

function normalize(raw: unknown): NavItem | null {
    if (!raw || typeof raw !== "object") return null
    const it = raw as Partial<NavItem>
    if (!it.id) return null
    return {
        id: it.id,
        href: it.href !== undefined ? it.href : null,
        label: it.label || it.id,
        matchExact: !!it.matchExact,
        placement: it.placement === "float" ? "float" : "nav",
        isMenu: !!it.isMenu,
    }
}

function inSavedOrder(items: NavItem[], order: unknown[]) {
    const rank = new Map(order.map((id, i) => [String(id), i]))
    return [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
}

/**
 * The bar's entries from what is stored (UIBottomNav.kt loadNavItems + prepareNavItems + dedupe): the full saved list if
 * there is one, else the defaults with the saved placement and order; always with Downloads, never the removed pages,
 * duplicates merged (a "nav" placement wins).
 */
export function resolveNavItems(stored: { items?: unknown, placement?: unknown, order?: unknown }): NavItem[] {
    let items: NavItem[] = []
    if (Array.isArray(stored.items)) {
        items = stored.items.map(normalize).filter((n): n is NavItem => !!n && !isRemovedOfflineItem(n))
    }
    if (!items.length) {
        items = DEFAULT_NAV_ITEMS.map(d => ({ ...d }))
        if (stored.placement && typeof stored.placement === "object") {
            const placement = stored.placement as Record<string, unknown>
            for (const it of items) {
                if (placement[it.id] === "nav" || placement[it.id] === "float") it.placement = placement[it.id] as NavItem["placement"]
            }
        }
        if (Array.isArray(stored.order)) items = inSavedOrder(items, stored.order)
    }
    if (!items.some(it => it.id === DOWNLOADS_ITEM.id || navigationPath(it.href) === DOWNLOADS_ITEM.href)) items.push({ ...DOWNLOADS_ITEM })
    items = items.filter(it => !REMOVED_HREF.test(it.href || ""))

    const out: NavItem[] = []
    for (const it of items) {
        if (it.isMenu) {
            out.push(it)
            continue
        }
        const i = out.findIndex(o => !o.isMenu && sameTarget(o, it))
        if (i < 0) out.push(it)
        else if (out[i].placement !== "nav" && it.placement === "nav") out[i] = it
    }
    return out
}

/** Whether `item` is the page at `pathname` */
export function isActive(item: NavItem, pathname: string) {
    if (item.isMenu || !item.href) return false
    if (item.matchExact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(item.href + "/")
}

const NAV_LABELS_DE: Record<string, string> = {
    "Home": "Start", "My Lists": "Meine Listen", "My lists": "Meine Listen", "Discover": "Entdecken", "Search": "Suche",
    "Menu": "Menü", "Schedule": "Sendeplan", "Scan summaries": "Scan-Berichte", "More": "Mehr",
    "Refresh AniList": "AniList aktualisieren", "Extensions": "Erweiterungen", "Settings": "Einstellungen",
    "Sign out": "Abmelden", "Sign in": "Anmelden", "Login": "Anmelden",
    // added by the native app
    "Downloads": "Downloads", "Server status": "Server-Status", "Building blocks": "Bausteine",
}

/** The shown text of an entry; the label itself stays the English key */
export function navLabel(label: string, language: AppLanguage) {
    return language === "de" ? (NAV_LABELS_DE[label] || label) : label
}

const ICON_BY_ID: Record<string, MobileIconName> = {
    "home": "home", "lists": "lists", "discover": "discover", "search": "search", "menu": "menu", "android-downloads": "download",
}
const ICON_BY_ROUTE: Record<string, MobileIconName> = {
    "/": "home", "/lists": "lists", "/discover": "discover", "/search": "search", "/android-downloads": "download",
    "/settings": "settings", "/extensions": "extensions", "/manga": "manga", "/schedule": "calendar",
}

export function navIcon(item: Pick<NavItem, "id" | "href">): MobileIconName {
    return ICON_BY_ID[item.id] || ICON_BY_ROUTE[navigationPath(item.href)] || "fallback"
}

/**
 * The Menu's entries (the web sidebar's links, main-sidebar.tsx), in its order. `ready` marks the ones whose native screen
 * exists; the menu lists only those, so it never leads to an empty page. E2 sets ready as each screen arrives.
 */
export type MenuEntry = { id: string, href: string, label: string, icon: MobileIconName, ready: boolean }

export const MENU_ENTRIES: MenuEntry[] = [
    { id: "schedule", href: "/schedule", label: "Schedule", icon: "calendar", ready: true },
    { id: "manga", href: "/manga", label: "Manga", icon: "manga", ready: true },
    { id: "scan-summaries", href: "/scan-summaries", label: "Scan summaries", icon: "report", ready: true },
    { id: "extensions", href: "/extensions", label: "Extensions", icon: "extensions", ready: true },
    { id: "settings", href: "/settings", label: "Settings", icon: "settings", ready: true },
    // native-app pages: the server state (E0's test screen) and the catalogue of building blocks. Development aids the old
    // menu never had, so only dev builds list them; the routes stay reachable by link.
    { id: "server-status", href: "/server-status", label: "Server status", icon: "wrench", ready: __DEV__ },
    { id: "building-blocks", href: "/building-blocks", label: "Building blocks", icon: "grip", ready: __DEV__ },
]

/*
 * Customize navigation (UIBottomNav.kt edit mode, opened from Settings › App › Navigation): a tap moves an entry between
 * the bar and the Menu, the bar holds at most MAX_NAV_ITEMS (the Menu button counts and always stays). Each change is
 * stored at once under the old keys (saveNavState), so the bar follows while the editor is open.
 */

/** What the Menu lists: bar entries given back to it, then the screens of MENU_ENTRIES that are ready and not in the bar */
export type MenuTarget = { id: string, label: string, href: string, icon: MobileIconName }

export function menuTargets(items: NavItem[]): MenuTarget[] {
    const bar = items.filter(it => it.placement === "nav" && !it.isMenu)
    const out: MenuTarget[] = []
    const add = (target: MenuTarget) => {
        const asItem = { ...target, matchExact: false, placement: "float" as const }
        if (bar.some(b => sameTarget(b, asItem))) return
        if (out.some(o => sameTarget({ ...o, matchExact: false, placement: "float" }, asItem))) return
        out.push(target)
    }
    for (const it of items) {
        if (it.placement === "float" && !it.isMenu && it.href) add({ id: it.id, label: it.label, href: it.href, icon: navIcon(it) })
    }
    for (const entry of MENU_ENTRIES) {
        if (entry.ready) add({ id: entry.id, label: entry.label, href: entry.href, icon: entry.icon })
    }
    return out
}

/** Entries in the bar, the Menu button included */
export function navCount(items: NavItem[]) {
    return items.filter(it => it.placement === "nav").length
}

/** After the last bar entry, or in front of the Menu button when that is the last one (defaultNavInsertIndex) */
function insertIndex(items: NavItem[]) {
    let last = -1
    items.forEach((it, i) => {
        if (it.placement === "nav") last = i
    })
    if (last === -1) return items.length
    return items[last].isMenu ? last : last + 1
}

export type NavEditResult = { items: NavItem[] } | { refused: "full" | "fixed" }

/** Gives a bar entry back to the Menu; the Menu button refuses (removeNavToFloat). */
export function moveToMenu(items: NavItem[], id: string): NavEditResult {
    const item = items.find(it => it.id === id)
    if (!item) return { items }
    if (item.isMenu) return { refused: "fixed" }
    return { items: items.map(it => it.id === id ? { ...it, placement: "float" } : it) }
}

/** Brings a Menu entry into the bar; nothing falls out, so a full bar refuses (addFloatToNav). */
export function moveToBar(items: NavItem[], target: Pick<MenuTarget, "label" | "href">): NavEditResult {
    if (navCount(items) >= MAX_NAV_ITEMS) return { refused: "full" }
    const probe: NavItem = { id: "", href: target.href, label: target.label, matchExact: false, placement: "float" }
    const existing = items.find(it => !it.isMenu && sameTarget(it, probe))
    if (existing?.placement === "nav") return { items }
    const rest = existing ? items.filter(it => it !== existing) : items
    const entry: NavItem = existing
        ? { ...existing, placement: "nav" }
        : { id: "__float_" + target.label.replace(/\W/g, "_"), href: target.href, label: target.label, matchExact: false, placement: "nav" }
    const next = [...rest]
    next.splice(Math.min(insertIndex(rest), next.length), 0, entry)
    return { items: next }
}

/** Moves a bar entry one place towards the start (-1) or the end (1) of the bar; Menu entries keep their places. */
export function moveInBar(items: NavItem[], id: string, delta: -1 | 1): NavItem[] {
    const bar = items.map((it, i) => ({ it, i })).filter(({ it }) => it.placement === "nav")
    const at = bar.findIndex(({ it }) => it.id === id)
    const to = at + delta
    if (at < 0 || to < 0 || to >= bar.length) return items
    const next = [...items]
    next[bar[at].i] = bar[to].it
    next[bar[to].i] = bar[at].it
    return next
}

/** The stored form (saveNavState): the full list, the order of the ids and the placement by id */
export function storedNavState(items: NavItem[]) {
    return {
        items,
        order: items.map(it => it.id),
        placement: Object.fromEntries(items.map(it => [it.id, it.placement])) as Record<string, NavItem["placement"]>,
    }
}
