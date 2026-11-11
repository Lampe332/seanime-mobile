/*
 * Logic of the settings screen (settings-phone*.tsx of the web app) that has no React in it: which area a link opens, when
 * the update notice may open by itself, and the value lists of the selects.
 */

export type SettingsSectionId = "seanime" | "ui" | "playback" | "library" | "onlinestream" | "torrents" | "manga" | "nakama" | "logs" | "about"

/** The areas in the order of the list */
export const SETTINGS_SECTIONS: SettingsSectionId[] = ["seanime", "ui", "playback", "library", "onlinestream", "torrents", "manga", "nakama", "logs", "about"]

/**
 * `?tab=` of the desktop page (links, tours, the anime page's "turned off in the settings") to the area that holds it;
 * tabs of desktop-only features open the list.
 */
const TAB_SECTIONS: Record<string, SettingsSectionId> = {
    seanime: "seanime", local: "seanime", ui: "ui", playback: "playback", "external-player-link": "playback", "media-player": "playback",
    mediastream: "playback", library: "library", onlinestream: "onlinestream", torrent: "torrents", "torrent-client": "torrents",
    torrentstream: "torrents", debrid: "torrents", manga: "manga", nakama: "nakama", logs: "logs", about: "about",
}

export function sectionFromTab(tab: string | null | undefined): SettingsSectionId | null {
    if (!tab) return null
    return Object.prototype.hasOwnProperty.call(TAB_SECTIONS, tab) ? TAB_SECTIONS[tab] : null
}

/** The link that opens the settings on an area (`/settings?tab=…`) */
export function settingsHref(tab: string) {
    return `/settings?tab=${encodeURIComponent(tab)}`
}

export type Option = { value: string, label: string }

/** Opacity choices in steps of 5, plus a stored value between them */
export function opacityOptions(current: number): Option[] {
    const steps = Array.from({ length: 20 }, (_, i) => (i + 1) * 5)
    return [...new Set([...steps, current])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${value} %` }))
}

/** KB/s choices of the torrent client; a stored value that is not one of them stays visible */
export function limitOptions(values: number[], stored: number, unlimited: string): Option[] {
    const label = (kb: number) => kb === 0 ? unlimited : kb >= 1024 && kb % 1024 === 0 ? `${kb / 1024} MB/s` : `${kb} KB/s`
    const all = values.includes(stored) ? values : [...values, stored].sort((a, b) => a - b)
    return all.map(kb => ({ value: String(kb), label: label(kb) }))
}

/** A stored value the options no longer list stays visible instead of silently showing the first option */
export function withStoredOption(options: Option[], value: string, label: string = value): Option[] {
    return options.some(option => option.value === value) ? options : [...options, { value, label }]
}

/** The provider answered that the account's plan has no API access (TorBox: 403 PLAN_RESTRICTED_FEATURE); the key itself is fine. */
export function planRestricted(detail: string) {
    return /PLAN_RESTRICTED|not available on your plan|upgrade to a paid plan/i.test(detail)
}

/** The server's message of a failed key check, with the key blanked out in case a provider echoes it, at most 240 characters */
export function keyCheckDetail(failure: unknown, key: string) {
    const data = (failure as { response?: { data?: { error?: unknown } } } | null)?.response?.data
    const message = String(data?.error ?? "")
    return (key.length >= 4 ? message.split(key).join("•••") : message).slice(0, 240)
}

/** Bytes as the developer tools show them */
export function formatBytes(bytes: number) {
    if (!bytes) return "0 B"
    const units = ["B", "KB", "MB", "GB"]
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${units[i]}`
}

/** Which log files a filter of the log list shows */
export function filterLogFiles(names: string[], filter: "all" | "server" | "scanner") {
    return names.filter(name => filter === "all" || (filter === "server" ? name.startsWith("seanime-") : name.includes("-scan")))
}
