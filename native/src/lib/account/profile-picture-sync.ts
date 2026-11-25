import { PROFILE_PICTURE_FILE_START, PROFILE_PICTURE_KEY } from "@/lib/account/profile-picture"

/*
 * The own profile picture on every device of the account. A pick is shrunk to 384×384 JPEG and, while signed in, also
 * kept as one entry of the app's store that the account sync carries like any other preference (and a file backup takes
 * along). A device that gets a newer entry writes its picture file from it; "no picture" is an entry too, so removing
 * goes to every device. The last choice wins, by the choosing device's clock.
 *
 * The entry is one plain text, "v1|<time>|<base64 JPEG>" (nothing after the last bar: removed). Not JSON on purpose: the
 * sync merges a JSON object field by field (core/account/package.ts), and a time from one device with the picture of
 * another must never meet. Builds before this one do not know the key; they carry it along untouched like every
 * preference they do not know.
 *
 * Without an account a choice writes no entry: the picture stays on the device as before. Neither does a picture from
 * before this build: only the next choice or removal while signed in goes to the other devices.
 * The picture's bytes are never logged.
 */

/** The synced entry; app-backup-keys.ts must not name it a device key */
export const PROFILE_PICTURE_SYNC_KEY = "seanime-mobile-profile-picture-synced"
/** When this device's picture was chosen or removed (a device key): what a synced entry must be newer than */
export const PROFILE_PICTURE_AT_KEY = "seanime-mobile-profile-picture-at"

export const PROFILE_PICTURE_SIZE = 384
/**
 * The most base64 characters an entry's picture may have: 75 KB of JPEG. A 384×384 photo at quality 0.7 is about
 * 15–40 KB, so the first quality nearly always fits; the lower ones are for unusually detailed photos.
 */
export const PROFILE_PICTURE_MAX_BASE64 = 100_000
export const PROFILE_PICTURE_QUALITIES = [0.7, 0.5, 0.3] as const

const ENTRY_START = "v1|"

export type ProfilePictureEntry = { at: number, /** base64 JPEG, "" when the picture was removed */ jpeg: string }

/** The parts of the app this needs: its store (values as stored, i.e. the atoms' JSON) and the picture files */
export type ProfilePictureStore = {
    get: (key: string) => string | undefined
    /** Writes the values so that the atoms on these keys show them at once (storage.ts writeStoredValues) */
    set: (values: Record<string, string>) => void
}
export type ProfilePictureFiles = {
    write: (name: string, base64: string) => Promise<void>
    /** Removes the own pictures on this device, except `keep` */
    removeExcept: (keep?: string) => void
}

export function formatProfilePictureEntry(entry: ProfilePictureEntry): string {
    return `${ENTRY_START}${entry.at}|${entry.jpeg}`
}

/** The entry in a stored value, or undefined for anything else (too large, not base64, no time) */
export function parseProfilePictureEntry(raw: unknown): ProfilePictureEntry | undefined {
    if (typeof raw !== "string" || !raw.startsWith(ENTRY_START)) return undefined
    const bar = raw.indexOf("|", ENTRY_START.length)
    if (bar < 0) return undefined
    const time = raw.slice(ENTRY_START.length, bar)
    const jpeg = raw.slice(bar + 1)
    if (!/^\d{1,15}$/.test(time) || Number(time) <= 0) return undefined
    if (jpeg.length > PROFILE_PICTURE_MAX_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(jpeg)) return undefined
    return { at: Number(time), jpeg }
}

export function profilePictureFileName(at: number): string {
    return `${PROFILE_PICTURE_FILE_START}${at}.jpg`
}

function storedName(store: ProfilePictureStore): string {
    try {
        const value: unknown = JSON.parse(store.get(PROFILE_PICTURE_KEY) ?? "\"\"")
        return typeof value === "string" ? value : ""
    } catch {
        return ""
    }
}

/** When this device's picture was last chosen or removed; a picture from before the sync tells it by its file name; else 0 */
export function localProfilePictureTime(store: ProfilePictureStore): number {
    const noted = Number(store.get(PROFILE_PICTURE_AT_KEY))
    const named = /^(\d{1,15})\.jpg$/.exec(storedName(store).slice(PROFILE_PICTURE_FILE_START.length))
    return Math.max(Number.isFinite(noted) ? noted : 0, named ? Number(named[1]) : 0)
}

/**
 * Shrinks with the first quality whose result fits an entry. `encode` gives the base64 JPEG for a quality; throws when
 * even the lowest is too large (the picture is then not used at all, so every device can hold what one device shows).
 */
export async function encodeProfilePicture(encode: (quality: number) => Promise<string>): Promise<string> {
    for (const quality of PROFILE_PICTURE_QUALITIES) {
        const jpeg = await encode(quality)
        if (jpeg && jpeg.length <= PROFILE_PICTURE_MAX_BASE64) return jpeg
    }
    throw new Error("The picture is too large.")
}

/**
 * The user's own choice on this device: `jpeg` is the shrunk picture, "" removes it. The file is written first, then
 * the store. Only a signed-in device writes the synced entry.
 */
export async function chooseProfilePicture(store: ProfilePictureStore, files: ProfilePictureFiles,
    choice: { jpeg: string, at: number, signedIn: boolean }): Promise<void> {
    const entry = parseProfilePictureEntry(formatProfilePictureEntry(choice))
    if (!entry) throw new Error("The picture is too large.")
    const name = entry.jpeg ? profilePictureFileName(entry.at) : ""
    if (name) await files.write(name, entry.jpeg)
    store.set({
        [PROFILE_PICTURE_KEY]: JSON.stringify(name),
        [PROFILE_PICTURE_AT_KEY]: String(entry.at),
        ...(choice.signedIn ? { [PROFILE_PICTURE_SYNC_KEY]: formatProfilePictureEntry(entry) } : {}),
    })
    files.removeExcept(name || undefined)
}

/**
 * Takes over the synced entry when it is newer than this device's own choice (after a sync, an import, a restore); true
 * when the picture changed. An entry that cannot be written changes nothing and is tried again the next time.
 */
export async function applySyncedProfilePicture(store: ProfilePictureStore, files: ProfilePictureFiles): Promise<boolean> {
    const entry = parseProfilePictureEntry(store.get(PROFILE_PICTURE_SYNC_KEY))
    if (!entry || entry.at <= localProfilePictureTime(store)) return false
    const name = entry.jpeg ? profilePictureFileName(entry.at) : ""
    try {
        if (name) await files.write(name, entry.jpeg)
    } catch {
        return false
    }
    store.set({ [PROFILE_PICTURE_KEY]: JSON.stringify(name), [PROFILE_PICTURE_AT_KEY]: String(entry.at) })
    files.removeExcept(name || undefined)
    return true
}
