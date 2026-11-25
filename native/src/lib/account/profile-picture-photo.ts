import { PROFILE_PICTURE_FILE_START } from "@/lib/account/profile-picture"
import {
    type ProfilePictureFiles, type ProfilePictureStore, PROFILE_PICTURE_SIZE, applySyncedProfilePicture, chooseProfilePicture, encodeProfilePicture,
} from "@/lib/account/profile-picture-sync"
import { storage, writeStoredValues } from "@/lib/storage"
import { Directory, File, Paths } from "expo-file-system"
import { ImageManipulator, SaveFormat } from "expo-image-manipulator"
import { launchImageLibraryAsync } from "expo-image-picker"

/*
 * Picking the own profile picture (profile-picture.ts): Android's system photo picker (no storage permission), cropped
 * square, shrunk to 384×384 JPEG (expo-image-manipulator) and written into the documents folder so it stays when the
 * photo is deleted from the gallery. One own picture at a time. What goes to the account's other devices and how a
 * device takes a picture over: profile-picture-sync.ts.
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

const pictureStore: ProfilePictureStore = {
    get: key => storage.getString(key),
    set: values => writeStoredValues(values, []),
}

const pictureFiles: ProfilePictureFiles = {
    write: async (name, base64) => {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
        const file = new File(Paths.document, name)
        if (!file.exists) file.create()
        await file.write(bytes)
    },
    removeExcept: removeProfilePictures,
}

/**
 * Lets the user pick and crop a photo, shrinks it and makes it this device's picture (and the account's while
 * `signedIn`); false when the picker was closed
 */
export async function pickProfilePicture(signedIn: boolean): Promise<boolean> {
    // full quality here: the picture is compressed once, after it was shrunk
    const result = await launchImageLibraryAsync({ mediaTypes: "images", allowsEditing: true, aspect: [1, 1], quality: 1 })
    const picked = result.canceled ? undefined : result.assets?.[0]
    if (!picked) return false
    const image = await ImageManipulator.manipulate(picked.uri).resize({ width: PROFILE_PICTURE_SIZE, height: PROFILE_PICTURE_SIZE }).renderAsync()
    const jpeg = await encodeProfilePicture(async quality => (await image.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true })).base64 ?? "")
    await chooseProfilePicture(pictureStore, pictureFiles, { jpeg, at: Date.now(), signedIn })
    return true
}

/** "Remove picture": here, and on the account's other devices while `signedIn` */
export async function removeProfilePicture(signedIn: boolean): Promise<void> {
    await chooseProfilePicture(pictureStore, pictureFiles, { jpeg: "", at: Date.now(), signedIn })
}

/** Shows a newer picture the sync, an import or a restore brought; never throws */
export async function takeSyncedProfilePicture(): Promise<void> {
    try {
        await applySyncedProfilePicture(pictureStore, pictureFiles)
    } catch {
        // the entry stays in the store: tried again with the next sync or app start
    }
}
