import React from "react"
import definitions from "./mobile-icons/icons.json"
export type MobileIconName = keyof typeof definitions.paths
export function mobileIconFor(item: { id?: string, href?: string | null, name?: string }): MobileIconName | undefined {
    const routes = definitions.routes as Record<string, MobileIconName>
    const actions = definitions.actions as Record<string, MobileIconName>
    const ids = definitions.ids as Record<string, MobileIconName>
    if (item.href?.includes("id=seanime-download-notifier")) return "notifier"
    return ids[item.id || ""] || routes[item.href?.split("?")[0] || ""] || actions[item.name || ""]
}
export function MobileIcon({ name, ...props }: React.SVGProps<SVGSVGElement> & { name: MobileIconName }) {
    return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: definitions.paths[name] }} />
}
