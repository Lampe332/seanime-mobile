import { BANNER_FILE_PREFIX, BANNER_FILE_START } from "@/lib/theme/home-banner"
import { Directory, File, Paths } from "expo-file-system"
import { launchImageLibraryAsync } from "expo-image-picker"

/*
 * The user's own banner photo: Android's system photo picker (no storage permission), cropped to the banner's 3:1, then
 * copied into the documents folder so it stays when the photo is deleted from the gallery. One own photo at a time.
 */

/** Removes the own banner photos on this device, except `keep` */
export function removeBannerPhotos(keep?: string) {
    try {
        for (const entry of new Directory(Paths.document).list()) {
            if (entry instanceof File && entry.name.startsWith(BANNER_FILE_START) && entry.name !== keep) entry.delete()
        }
    } catch {
        // a photo left behind only costs space; the banner itself is already chosen
    }
}

/** Lets the user pick and crop a photo and keeps a copy; the value to store, or undefined when the picker was closed */
export async function pickBannerPhoto(): Promise<string | undefined> {
    const result = await launchImageLibraryAsync({ mediaTypes: "images", allowsEditing: true, aspect: [3, 1], quality: 0.85 })
    const picked = result.canceled ? undefined : result.assets?.[0]
    if (!picked) return undefined
    const name = `${BANNER_FILE_START}${Date.now()}.jpg`
    new File(picked.uri).copy(new File(Paths.document, name))
    removeBannerPhotos(name)
    return BANNER_FILE_PREFIX + name
}
