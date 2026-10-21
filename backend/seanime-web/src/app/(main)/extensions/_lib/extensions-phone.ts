import { Extension_Extension, Extension_InvalidExtension, ExtensionRepo_AllExtensions } from "@/api/generated/types"
import { LANGUAGES_LIST } from "@/app/(main)/manga/_lib/language-map"
import type { Translate } from "@/lib/app-language"
import orderBy from "lodash/orderBy"

/** Extension types the phone app can use; anime torrents need the desktop app. */
export type PhoneExtensionType = "onlinestream-provider" | "manga-provider" | "plugin" | "custom-source"

/** Content sources first: on a phone they are what extensions are installed for. */
export const PHONE_EXTENSION_TYPES: {
    type: PhoneExtensionType
    /** Name of the desktop marketplace tab; the first-run tutorial finds the filter by it */
    tabName: string
    en: string, de: string
    chipEn: string, chipDe: string
    oneEn: string, oneDe: string
}[] = [
    { type: "onlinestream-provider", tabName: "Online Streaming", en: "Online streaming", de: "Online-Streaming", chipEn: "Streaming", chipDe: "Streaming", oneEn: "Streaming source", oneDe: "Streaming-Quelle" },
    { type: "manga-provider", tabName: "Manga", en: "Manga", de: "Manga", chipEn: "Manga", chipDe: "Manga", oneEn: "Manga source", oneDe: "Manga-Quelle" },
    { type: "plugin", tabName: "Plugins", en: "Plugins", de: "Plugins", chipEn: "Plugins", chipDe: "Plugins", oneEn: "Plugin", oneDe: "Plugin" },
    { type: "custom-source", tabName: "Custom Sources", en: "Custom sources", de: "Eigene Quellen", chipEn: "Custom sources", chipDe: "Eigene Quellen", oneEn: "Custom source", oneDe: "Eigene Quelle" },
]

const phoneTypes = new Set<string>(PHONE_EXTENSION_TYPES.map(item => item.type))

export function isPhoneExtension(extension: Extension_Extension | undefined) {
    return !!extension && phoneTypes.has(extension.type)
}

export function extensionTypeLabel(type: string, t: Translate) {
    const item = PHONE_EXTENSION_TYPES.find(item => item.type === type)
    return item ? t(item.oneEn, item.oneDe) : t("Anime torrents", "Anime-Torrents")
}

/** Language of the content an extension provides, in that language's own name. */
export function extensionLanguageLabel(lang: string | undefined, t: Translate) {
    if (!lang || lang.toLowerCase() === "multi") return t("Multiple languages", "Mehrere Sprachen")
    return LANGUAGES_LIST[lang.toLowerCase()]?.nativeName || lang.toUpperCase()
}

/** One line under the name: version, author and content language, or "Built-in". */
export function extensionMeta(extension: Extension_Extension | undefined, t: Translate) {
    if (!extension) return ""
    if (extension.manifestURI === "builtin") return t("Built-in", "Integriert")
    const lang = extension.lang && extension.lang.toLowerCase() !== "multi" ? extensionLanguageLabel(extension.lang, t) : ""
    return [extension.version, extension.author, lang].filter(Boolean).join(" · ")
}

export function invalidReasonLabel(code: string | undefined, t: Translate) {
    switch (code) {
        case "invalid_manifest":
            return t("Manifest error", "Fehler im Manifest")
        case "invalid_semver_constraint":
            return t("Incompatible with this Seanime version", "Passt nicht zu dieser Seanime-Version")
        case "invalid_payload":
            return t("Invalid or incompatible code", "Code ungültig oder inkompatibel")
        case "plugin_permissions_not_granted":
            return t("Waiting for your permission", "Wartet auf deine Erlaubnis")
        default:
            return t("Could not be loaded", "Konnte nicht geladen werden")
    }
}

export type PermissionLine = { kind: "item", label: string, value: string } | { kind: "warning" | "text", text: string }

/** The server's permission text: "• Name: detail" lines are permissions, "* ..." lines are warnings. */
export function parsePermissionDescription(text: string | undefined): PermissionLine[] {
    return (text ?? "").split("\n").map(line => line.trim()).filter(Boolean).map((line): PermissionLine => {
        if (line.startsWith("•")) {
            const item = line.replace(/^•\s*/, "")
            const colon = item.indexOf(":")
            return colon > 0 ? { kind: "item", label: item.slice(0, colon).trim(), value: item.slice(colon + 1).trim() } : { kind: "item", label: item, value: "" }
        }
        if (line.startsWith("*")) return { kind: "warning", text: line.replace(/^\*\s*/, "") }
        return { kind: "text", text: line }
    })
}

/** Icons are shown from image files only, as on the desktop cards; anything else gets the first letter. */
export function isExtensionIconUrl(url: string | undefined) {
    return !!url && /\.(png|jpe?g|avif|webp|ico)(\?.*)?$/i.test(url)
}

export function matchesExtensionSearch(extension: Extension_Extension | undefined, term: string) {
    const needle = term.trim().toLowerCase()
    if (!needle) return true
    return [extension?.name, extension?.description, extension?.id].some(value => value?.toLowerCase().includes(needle))
}

export function sortExtensions<T extends Extension_Extension>(extensions: T[]) {
    return orderBy(extensions, [extension => extension.name?.toLowerCase(), "id"])
}

export type InstalledGroup = { key: PhoneExtensionType | "disabled", en: string, de: string, items: Extension_Extension[] }

export type InstalledOverview = {
    /** Plugins waiting for the user to grant their permissions */
    permissions: Extension_InvalidExtension[]
    /** Extensions that failed to load */
    broken: Extension_InvalidExtension[]
    groups: InstalledGroup[]
    /** Every installed extension the phone can use, before the search */
    total: number
    /** Installed extensions with an update, before the search */
    updates: number
    /** Updates "Update all" may install (the others use unsafe flags) */
    safeUpdates: NonNullable<ExtensionRepo_AllExtensions["hasUpdate"]>
    /** Extensions that failed to load, wait for permissions or need their preferences filled in, before the search */
    attention: number
}

/** The phone Installed tab: what needs attention, then one group per type and the disabled ones, each sorted by name. */
export function getInstalledOverview(all: ExtensionRepo_AllExtensions | undefined, term: string): InstalledOverview {
    const enabled = (all?.extensions ?? []).filter(isPhoneExtension)
    const disabled = (all?.disabledExtensions ?? []).filter(isPhoneExtension)
    const invalid = (all?.invalidExtensions ?? []).filter(item => !item.extension?.type || isPhoneExtension(item.extension))
    const ids = new Set([...enabled, ...disabled].map(extension => extension.id))
    const updates = (all?.hasUpdate ?? []).filter(update => ids.has(update.extensionID))
    const byId = (a: Extension_InvalidExtension, b: Extension_InvalidExtension) => a.id.localeCompare(b.id)
    const found = invalid.filter(item => matchesExtensionSearch(item.extension, term))

    return {
        permissions: found.filter(item => item.code === "plugin_permissions_not_granted").sort(byId),
        broken: found.filter(item => item.code !== "plugin_permissions_not_granted").sort(byId),
        groups: [
            ...PHONE_EXTENSION_TYPES.map(({ type, en, de }) => ({ key: type, en, de, items: sortExtensions(enabled.filter(extension => extension.type === type)) })),
            { key: "disabled" as const, en: "Disabled", de: "Deaktiviert", items: sortExtensions(disabled) },
        ].map(group => ({ ...group, items: group.items.filter(extension => matchesExtensionSearch(extension, term)) }))
            .filter(group => group.items.length > 0),
        total: enabled.length + disabled.length + invalid.length,
        updates: updates.length,
        safeUpdates: updates.filter(update => !all?.unsafeExtensions?.[update.extensionID]),
        attention: invalid.length + (all?.invalidUserConfigExtensions ?? []).filter(item => ids.has(item.id)).length,
    }
}

export type MarketplaceFilters = { type: string, language: string, search: string }

/** Marketplace entries the phone can use, narrowed by type, content language and search, sorted by name. */
export function filterMarketplace(extensions: Extension_Extension[] | undefined, filters: MarketplaceFilters) {
    return sortExtensions((extensions ?? []).filter(isPhoneExtension)
        .filter(extension => filters.type === "all" || extension.type === filters.type)
        .filter(extension => filters.language === "all" || extension.lang?.toLowerCase() === filters.language)
        .filter(extension => matchesExtensionSearch(extension, filters.search)))
}

/** Short form of a repository URL: owner/repository on GitHub (its host says nothing), else the host and the file name. */
export function shortRepositoryUrl(url: string) {
    try {
        const parsed = new URL(url)
        const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent)
        if (["raw.githubusercontent.com", "github.com"].includes(parsed.host) && parts.length >= 2) return `${parts[0]}/${parts[1]}`
        const file = parts.at(-1)
        return file ? `${parsed.host} · ${file}` : parsed.host
    } catch {
        return url
    }
}
