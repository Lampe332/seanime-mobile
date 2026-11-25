import { PROFILE_PICTURE_FILE_START } from "@/lib/account/profile-picture"
import { Directory, File, Paths } from "expo-file-system"
import { launchImageLibraryAsync } from "expo-image-picker"

/*
 * Picking the own profile picture (profile-picture.ts): Android's system photo picker (no storage permission), cropped
 * square, then copied into the documents folder so it stays when the photo is deleted from the gallery. The same steps as
 * the Home banner's photo (home-banner-photo.ts). One own picture at a time.
 */

/** Removes the own profile pictures on this device, except `keep` */
export function removeProfilePictures(keep?: string) {
    try {
        for (const entry of new Directory(Paths.document).list()) {
            if (entry instanceof File && entry.name.startsWith(PROFILE_PICTURE_FILE_START) && entry.name !== keep) entry.delete()
        }
    } catch {
        // a picture left behind only costs space; the choice itself is already stored
    }
}

/** Lets the user pick and crop a photo and keeps a copy; its file name, or undefined when the picker was closed */
export async function pickProfilePicture(): Promise<string | undefined> {
    // no image manipulator in the app: the crop's quality keeps the copy small, the avatar views scale it down
    const result = await launchImageLibraryAsync({ mediaTypes: "images", allowsEditing: true, aspect: [1, 1], quality: 0.6 })
    const picked = result.canceled ? undefined : result.assets?.[0]
    if (!picked) return undefined
    const name = `${PROFILE_PICTURE_FILE_START}${Date.now()}.jpg`
    new File(picked.uri).copy(new File(Paths.document, name))
    return name
}
