import capitalize from "lodash/capitalize"
import type { Translate } from "@/lib/app-language"

/** A list status as a section title in the app's language (4.3.1 device test: "Completed" stayed English in German). */
function statusTitle(type: string | undefined, t: Translate, manga: boolean) {
    switch (type) {
        case "CURRENT":
            return manga ? t("Currently reading", "Lese ich gerade") : t("Currently watching", "Schaue ich gerade")
        case "REPEATING":
            return manga ? t("Rereading", "Lese erneut") : t("Rewatching", "Schaue erneut")
        case "PLANNING":
            return t("Planning", "Geplant")
        case "PAUSED":
            return t("Paused", "Pausiert")
        case "COMPLETED":
            return t("Completed", "Fertig")
        case "DROPPED":
            return t("Dropped", "Abgebrochen")
        default:
            return capitalize(type ?? "")
    }
}

export function getLibraryCollectionTitle(type: string | undefined, t: Translate) {
    return statusTitle(type, t, false)
}

export function getMangaCollectionTitle(type: string | undefined, t: Translate) {
    return statusTitle(type, t, true)
}

export function isCustomSource(mId: number | null | undefined) {
    if (mId === null || mId === undefined) return false
    return mId >= 0x80000000
}

export function getCustomSourceExtensionId(m: { siteUrl?: string } | null | undefined) {
    if (!m?.siteUrl) return null
    let s = m.siteUrl.replace("ext_custom_source_", "")
    if (s.includes("|END|")) {
        s = s.split("|END|")[0]
    }
    return s
}

export function getCustomSourceMediaSiteUrl(m: { siteUrl?: string } | null | undefined) {
    if (!m?.siteUrl) return null
    let s = m.siteUrl.replace("ext_custom_source_", "")
    if (s.includes("|END|")) {
        s = s.split("|END|")?.[1] ?? null
    }
    return s
}
