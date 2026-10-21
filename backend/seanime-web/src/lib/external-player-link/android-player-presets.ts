/** Android players that open an http stream from an intent:// link (MainActivity starts it, or says the app is missing). */
export const ANDROID_PLAYER_PRESETS = [
    { name: "VLC", packageName: "org.videolan.vlc" },
    { name: "MX Player", packageName: "com.mxtech.videoplayer.ad" },
    { name: "mpv", packageName: "is.xyz.mpv" },
    { name: "Just Player", packageName: "com.brouken.player" },
] as const

/** ExternalPlayerLink strips the "http://" of {url} for intent:// links, so the scheme goes into the intent. */
export function androidPlayerLink(packageName: string) {
    return `intent://{url}#Intent;scheme=http;type=video/*;package=${packageName};end`
}

/** The preset a saved link belongs to, if it is one of them. */
export function androidPlayerPresetOf(link: string) {
    return ANDROID_PLAYER_PRESETS.find(preset => link === androidPlayerLink(preset.packageName))
}
