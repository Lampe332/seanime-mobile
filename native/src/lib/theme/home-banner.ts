import { File, Paths } from "expo-file-system"

/*
 * The banner behind the Home title (Settings > Appearance > Banner) is stored in the theme's
 * libraryScreenCustomBannerImage, which the account sync carries to the user's other devices. Three kinds of value:
 * - "preset:<id>": one of the pictures that ship with the app (banner-presets.ts), the same on every device;
 * - "file:<name>": the user's own photo, copied into this device's documents folder. Another device that receives the
 *   value has no such file and simply shows no banner;
 * - "https://…": an image link saved before the picker existed; still shown, no longer entered.
 */

export const BANNER_PRESET_PREFIX = "preset:"
export const BANNER_FILE_PREFIX = "file:"
/** Own photos are named "home-banner-<time>.jpg": a new name per pick, so the image cache never shows the previous one */
export const BANNER_FILE_START = "home-banner-"

export type BannerSource =
    | { kind: "preset", id: string, asset: number }
    | { kind: "file", uri: string }
    | { kind: "link", uri: string }

/** The uri of an own photo in this device's documents folder, or undefined when it is not on this device */
export function bannerFileUri(name: string): string | undefined {
    if (!name.startsWith(BANNER_FILE_START) || name.includes("/")) return undefined
    try {
        const file = new File(Paths.document, name)
        return file.exists ? file.uri : undefined
    } catch {
        return undefined
    }
}

/** What the stored value shows: a bundled picture, a file on this device, an old link, or nothing */
export function resolveBanner(value: string | undefined, presets: Readonly<Record<string, number>>,
    fileUri: (name: string) => string | undefined = bannerFileUri): BannerSource | undefined {
    const stored = value?.trim() ?? ""
    if (stored.startsWith(BANNER_PRESET_PREFIX)) {
        const id = stored.slice(BANNER_PRESET_PREFIX.length)
        const asset = Object.prototype.hasOwnProperty.call(presets, id) ? presets[id] : undefined
        return asset === undefined ? undefined : { kind: "preset", id, asset }
    }
    if (stored.startsWith(BANNER_FILE_PREFIX)) {
        const uri = fileUri(stored.slice(BANNER_FILE_PREFIX.length))
        return uri ? { kind: "file", uri } : undefined
    }
    if (/^https?:\/\/\S+$/i.test(stored)) return { kind: "link", uri: stored }
    return undefined
}
