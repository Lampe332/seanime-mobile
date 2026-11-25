/*
 * Anime4K upscaling (settings → Playback), only on this device. The shaders are bloc97/Anime4K v4.0.1 (MIT,
 * assets/shaders/anime4k/LICENSE), bundled as Metro assets (metro.config.js "glsl") and handed to mpv as file paths
 * when an episode opens (player-anime4k-files.ts). Chains follow the repo's GLSL_Instructions.md:
 * - "fast": the lightest useful chain, Clamp_Highlights + Restore S + Upscale x2 S (Mode A cut down to its S parts)
 * - "quality": the official "Mode A (Fast)" chain "for lower-end GPU" (M parts, S for the second upscale)
 */

export type Anime4kMode = "off" | "fast" | "quality"

export const ANIME4K_MODES: readonly Anime4kMode[] = ["off", "fast", "quality"]
export const ANIME4K_DEFAULT_MODE: Anime4kMode = "off"

export const ANIME4K_CHAINS = {
    fast: [
        "Anime4K_Clamp_Highlights.glsl",
        "Anime4K_Restore_CNN_S.glsl",
        "Anime4K_Upscale_CNN_x2_S.glsl",
    ],
    quality: [
        "Anime4K_Clamp_Highlights.glsl",
        "Anime4K_Restore_CNN_M.glsl",
        "Anime4K_Upscale_CNN_x2_M.glsl",
        "Anime4K_AutoDownscalePre_x2.glsl",
        "Anime4K_AutoDownscalePre_x4.glsl",
        "Anime4K_Upscale_CNN_x2_S.glsl",
    ],
} as const

export type Anime4kShader = (typeof ANIME4K_CHAINS)[keyof typeof ANIME4K_CHAINS][number]

/**
 * mpv's path lists (`glsl-shaders`) are split by ":" on Unix, Android included, and by ";" only on Windows
 * (mpv manual "String list and path list options"; Anime4K GLSL_Instructions.md: "for Unix based OSes, ';' separators
 * must be replaced with ':'").
 */
export const MPV_PATH_LIST_SEPARATOR = ":"

/** A stored value as a mode; anything unknown is off */
export function anime4kModeOf(value: unknown): Anime4kMode {
    return ANIME4K_MODES.includes(value as Anime4kMode) ? value as Anime4kMode : ANIME4K_DEFAULT_MODE
}

/** The shader files of a mode, in mpv's order; none when off */
export function anime4kShaderFiles(mode: Anime4kMode): readonly Anime4kShader[] {
    return mode === "off" ? [] : ANIME4K_CHAINS[mode]
}

/**
 * A local file URI (expo-asset localUri, `file:///data/...`) as the plain path mpv reads; null for anything that is not
 * a local file or that the path list cannot hold (its separator inside the path).
 */
export function mpvShaderPath(uri: string | null | undefined, separator = MPV_PATH_LIST_SEPARATOR): string | null {
    if (!uri) return null
    let path = uri
    if (uri.startsWith("file://")) {
        try {
            path = decodeURIComponent(uri.slice("file://".length))
        } catch {
            return null
        }
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
        return null
    }
    if (!path.startsWith("/") || path.includes(separator) || /[\r\n]/.test(path)) return null
    return path
}

/**
 * The mpv property for the resolved shader files of a chain. Empty (no shaders) when the chain is empty or any of its
 * files is missing: half a chain changes the picture in ways Anime4K does not intend, so the episode plays plain.
 */
export function anime4kShaderOption(uris: readonly (string | null | undefined)[], separator = MPV_PATH_LIST_SEPARATOR): [string, string] {
    const paths = uris.map(uri => mpvShaderPath(uri, separator))
    const complete = paths.length > 0 && paths.every((path): path is string => path !== null)
    return ["glsl-shaders", complete ? paths.join(separator) : ""]
}
