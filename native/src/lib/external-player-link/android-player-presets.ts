/**
 * Android players that open an http stream from an intent:// link (MainActivity starts it, or says the app is missing).
 * className: the player's exported VIEW activity. expo-intent-launcher only targets an app through a component (a package
 * alone is ignored and Android would pick any video app), so each preset names it (from the apps' manifests / MX's API).
 */
export const ANDROID_PLAYER_PRESETS = [
    { name: "VLC", packageName: "org.videolan.vlc", className: "org.videolan.vlc.StartActivity" },
    { name: "MX Player", packageName: "com.mxtech.videoplayer.ad", className: "com.mxtech.videoplayer.ad.ActivityScreen" },
    { name: "mpv", packageName: "is.xyz.mpv", className: "is.xyz.mpv.MPVActivity" },
    { name: "Just Player", packageName: "com.brouken.player", className: "com.brouken.player.PlayerActivity" },
] as const

/** ExternalPlayerLink strips the "http://" of {url} for intent:// links, so the scheme goes into the intent. */
export function androidPlayerLink(packageName: string) {
    return `intent://{url}#Intent;scheme=http;type=video/*;package=${packageName};end`
}

/** The preset a saved link belongs to, if it is one of them. */
export function androidPlayerPresetOf(link: string) {
    return ANDROID_PLAYER_PRESETS.find(preset => link === androidPlayerLink(preset.packageName))
}

export type IntentLink = { data: string, type?: string, packageName?: string, className?: string }

/** The activity that opens a stream in this player app, if it is a preset. */
export function playerActivityOf(packageName: string | undefined) {
    return ANDROID_PLAYER_PRESETS.find(preset => preset.packageName === packageName)?.className
}

/**
 * Parses an Android `intent://` link; null for any other link. The activity comes from `component=pkg/.Cls` or, for a
 * preset package, from the preset (without one the system picks the app).
 */
export function parseIntentLink(link: string): IntentLink | null {
    if (!link.startsWith("intent://")) return null
    const hash = link.indexOf("#Intent;")
    if (hash === -1) return null
    const target = link.slice("intent://".length, hash)
    const fields = new Map<string, string>()
    for (const part of link.slice(hash + "#Intent;".length).split(";")) {
        const eq = part.indexOf("=")
        if (eq > 0) fields.set(part.slice(0, eq), part.slice(eq + 1))
    }
    const scheme = (fields.get("scheme") ?? "http").toLowerCase()
    const component = fields.get("component")?.split("/")
    const packageName = fields.get("package") ?? component?.[0]
    const componentClass = component?.[1] ? (component[1].startsWith(".") ? component[0] + component[1] : component[1]) : undefined
    const className = componentClass ?? playerActivityOf(packageName)
    return {
        data: `${scheme}://${target}`,
        type: fields.get("type"),
        packageName,
        ...(className ? { className } : {}),
    }
}
