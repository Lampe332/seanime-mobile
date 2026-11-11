import definitions from "./mobile-icons/icons.json"
import React from "react"
import { SvgXml } from "react-native-svg"

/**
 * The app's icon catalogue (lib/mobile-icons/icons.json, the same file the web app and MobileIcons.kt drew from):
 * 24×24 outline icons, stroke 1.8, coloured by `color` (currentColor).
 */
export type MobileIconName = keyof typeof definitions.paths

export function mobileIconFor(item: { id?: string, href?: string | null, name?: string }): MobileIconName | undefined {
    const routes = definitions.routes as Record<string, MobileIconName>
    const actions = definitions.actions as Record<string, MobileIconName>
    const ids = definitions.ids as Record<string, MobileIconName>
    if (item.href?.includes("id=seanime-download-notifier")) return "notifier"
    return ids[item.id || ""] || routes[item.href?.split("?")[0] || ""] || actions[item.name || ""]
}

const xmlCache = new Map<MobileIconName, string>()

function iconXml(name: MobileIconName) {
    let xml = xmlCache.get(name)
    if (!xml) {
        xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${definitions.paths[name]}</svg>`
        xmlCache.set(name, xml)
    }
    return xml
}

export function MobileIcon({ name, size = 24, color }: { name: MobileIconName, size?: number, color: string }) {
    return <SvgXml xml={iconXml(name)} width={size} height={size} color={color} />
}
