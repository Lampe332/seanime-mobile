import { atomWithStorage } from "@/lib/storage"
import { File, Paths } from "expo-file-system"
import { useAtomValue } from "jotai"
import React from "react"

/*
 * The user's own profile picture (Settings › Account): shown instead of the AniList avatar in the More panel's head and on
 * the account page. It only changes what the app shows; nothing goes to AniList. The photo is a copy in this device's
 * documents folder, the store keeps its name. It stays on this device (a device key in app-backup-keys.ts): the picker
 * cannot shrink the photo, so it would be far too large for every sync package, and a name of a file another device does
 * not have would only hide that device's own picture.
 */

export const PROFILE_PICTURE_KEY = "seanime-mobile-profile-picture"
/** Own pictures are named "profile-picture-<time>.jpg": a new name per pick, so the image cache never shows the previous one */
export const PROFILE_PICTURE_FILE_START = "profile-picture-"

/** The file name of the own picture, "" without one */
export const profilePictureAtom = atomWithStorage<string>(PROFILE_PICTURE_KEY, "")

/** The uri of an own picture in this device's documents folder, or undefined when it is not there */
export function profilePictureFileUri(name: string): string | undefined {
    if (!name.startsWith(PROFILE_PICTURE_FILE_START) || name.includes("/") || name.includes("\\")) return undefined
    try {
        const file = new File(Paths.document, name)
        return file.exists ? file.uri : undefined
    } catch {
        return undefined
    }
}

/** The avatar to show: the own picture when its file is on this device, else `fallback` (AniList's, or null for the neutral one) */
export function resolveProfileAvatar(stored: unknown, fallback: string | null | undefined,
    fileUri: (name: string) => string | undefined = profilePictureFileUri): string | null {
    const name = typeof stored === "string" ? stored.trim() : ""
    let own: string | undefined
    try {
        own = name ? fileUri(name) : undefined
    } catch {
        own = undefined
    }
    return own || fallback || null
}

/** Whether an own picture is set and on this device (the account page's "Remove picture") */
export function useHasProfilePicture(): boolean {
    const stored = useAtomValue(profilePictureAtom)
    return React.useMemo(() => resolveProfileAvatar(stored, null) !== null, [stored])
}

/** The avatar to show in place of `fallback` */
export function useProfileAvatar(fallback: string | null | undefined): string | null {
    const stored = useAtomValue(profilePictureAtom)
    return React.useMemo(() => resolveProfileAvatar(stored, fallback), [stored, fallback])
}
