import { describe, expect, it } from "vitest"
import { packagePreferences } from "../../core/account/package"
import { isDeviceKey, isSyncDeviceKey, withoutDeviceKeys } from "../app-backup-keys"
import { PROFILE_PICTURE_KEY } from "./profile-picture"
import {
    type ProfilePictureFiles, type ProfilePictureStore, PROFILE_PICTURE_AT_KEY, PROFILE_PICTURE_MAX_BASE64, PROFILE_PICTURE_QUALITIES, PROFILE_PICTURE_SYNC_KEY,
    applySyncedProfilePicture, chooseProfilePicture, encodeProfilePicture, formatProfilePictureEntry, localProfilePictureTime, parseProfilePictureEntry,
} from "./profile-picture-sync"

/** One device: its store and its documents folder */
function device(values: Record<string, string> = {}, pictures: Record<string, string> = {}) {
    const stored = new Map(Object.entries(values))
    const folder = new Map(Object.entries(pictures))
    const store: ProfilePictureStore = {
        get: key => stored.get(key),
        set: next => {
            for (const [key, value] of Object.entries(next)) stored.set(key, value)
        },
    }
    const files: ProfilePictureFiles = {
        write: async (name, base64) => {
            folder.set(name, base64)
        },
        removeExcept: keep => {
            for (const name of [...folder.keys()]) if (name !== keep) folder.delete(name)
        },
    }
    /** What a sync package of this device carries (the account's sync, account-app.ts) */
    const synced = () => packagePreferences(Object.fromEntries(stored), isSyncDeviceKey)
    /** A package of another device arrives: its preferences are written, never the device's own keys */
    const receive = (preferences: Record<string, string>) => store.set(withoutDeviceKeys(preferences))
    return { stored, folder, store, files, synced, receive }
}

const JPEG_A = "QUFBQQ=="
const JPEG_B = "QkJCQg=="

describe("the synced profile picture", () => {
    it("a pick makes an entry with its time", async () => {
        const phone = device()
        await chooseProfilePicture(phone.store, phone.files, { jpeg: JPEG_A, at: 1000, signedIn: true })
        expect(parseProfilePictureEntry(phone.stored.get(PROFILE_PICTURE_SYNC_KEY))).toEqual({ at: 1000, jpeg: JPEG_A })
        expect(phone.stored.get(PROFILE_PICTURE_KEY)).toBe("\"profile-picture-1000.jpg\"")
        expect(phone.folder.get("profile-picture-1000.jpg")).toBe(JPEG_A)
        // the package carries the entry and nothing of the device's own
        expect(phone.synced()).toEqual({ [PROFILE_PICTURE_SYNC_KEY]: `v1|1000|${JPEG_A}` })
    })

    it("a newer entry of another device replaces the local picture", async () => {
        const phone = device()
        const tablet = device()
        await chooseProfilePicture(tablet.store, tablet.files, { jpeg: JPEG_A, at: 1000, signedIn: true })
        await chooseProfilePicture(phone.store, phone.files, { jpeg: JPEG_B, at: 2000, signedIn: true })
        tablet.receive(phone.synced())
        expect(await applySyncedProfilePicture(tablet.store, tablet.files)).toBe(true)
        expect(tablet.stored.get(PROFILE_PICTURE_KEY)).toBe("\"profile-picture-2000.jpg\"")
        expect([...tablet.folder]).toEqual([["profile-picture-2000.jpg", JPEG_B]])
        expect(localProfilePictureTime(tablet.store)).toBe(2000)
        // applying it again changes nothing
        expect(await applySyncedProfilePicture(tablet.store, tablet.files)).toBe(false)
    })

    it("an older entry changes nothing", async () => {
        const phone = device()
        await chooseProfilePicture(phone.store, phone.files, { jpeg: JPEG_B, at: 2000, signedIn: true })
        phone.receive({ [PROFILE_PICTURE_SYNC_KEY]: formatProfilePictureEntry({ at: 1000, jpeg: JPEG_A }) })
        expect(await applySyncedProfilePicture(phone.store, phone.files)).toBe(false)
        expect(phone.stored.get(PROFILE_PICTURE_KEY)).toBe("\"profile-picture-2000.jpg\"")
        expect([...phone.folder]).toEqual([["profile-picture-2000.jpg", JPEG_B]])
        // neither does an older removal
        phone.receive({ [PROFILE_PICTURE_SYNC_KEY]: formatProfilePictureEntry({ at: 1500, jpeg: "" }) })
        expect(await applySyncedProfilePicture(phone.store, phone.files)).toBe(false)
        expect(phone.folder.size).toBe(1)
    })

    it("removing goes to the other devices", async () => {
        const phone = device()
        const tablet = device()
        await chooseProfilePicture(phone.store, phone.files, { jpeg: JPEG_A, at: 1000, signedIn: true })
        tablet.receive(phone.synced())
        await applySyncedProfilePicture(tablet.store, tablet.files)
        expect(tablet.folder.size).toBe(1)

        await chooseProfilePicture(phone.store, phone.files, { jpeg: "", at: 3000, signedIn: true })
        expect(phone.folder.size).toBe(0)
        expect(phone.synced()).toEqual({ [PROFILE_PICTURE_SYNC_KEY]: "v1|3000|" })
        tablet.receive(phone.synced())
        expect(await applySyncedProfilePicture(tablet.store, tablet.files)).toBe(true)
        expect(tablet.stored.get(PROFILE_PICTURE_KEY)).toBe("\"\"")
        expect(tablet.folder.size).toBe(0)
        // a picture chosen before the removal does not come back
        tablet.receive({ [PROFILE_PICTURE_SYNC_KEY]: formatProfilePictureEntry({ at: 2000, jpeg: JPEG_B }) })
        expect(await applySyncedProfilePicture(tablet.store, tablet.files)).toBe(false)
    })

    it("a guest without an account syncs nothing", async () => {
        const phone = device()
        await chooseProfilePicture(phone.store, phone.files, { jpeg: JPEG_A, at: 1000, signedIn: false })
        expect(phone.stored.has(PROFILE_PICTURE_SYNC_KEY)).toBe(false)
        expect(phone.synced()).toEqual({})
        // the picture itself works as before
        expect(phone.stored.get(PROFILE_PICTURE_KEY)).toBe("\"profile-picture-1000.jpg\"")
        expect(phone.folder.get("profile-picture-1000.jpg")).toBe(JPEG_A)
        await chooseProfilePicture(phone.store, phone.files, { jpeg: "", at: 2000, signedIn: false })
        expect(phone.stored.has(PROFILE_PICTURE_SYNC_KEY)).toBe(false)
        expect(phone.folder.size).toBe(0)
    })

    it("a picture from before the update stays and is not uploaded", async () => {
        // as the build before stored it: the atom's JSON name, the file, no time and no entry
        const phone = device({ [PROFILE_PICTURE_KEY]: "\"profile-picture-5000.jpg\"" }, { "profile-picture-5000.jpg": "old" })
        expect(await applySyncedProfilePicture(phone.store, phone.files)).toBe(false)
        expect(phone.stored.get(PROFILE_PICTURE_KEY)).toBe("\"profile-picture-5000.jpg\"")
        expect([...phone.folder]).toEqual([["profile-picture-5000.jpg", "old"]])
        expect(phone.synced()).toEqual({})
        // its file name tells when it was picked: an entry chosen earlier elsewhere does not replace it, a later one does
        expect(localProfilePictureTime(phone.store)).toBe(5000)
        phone.receive({ [PROFILE_PICTURE_SYNC_KEY]: formatProfilePictureEntry({ at: 4000, jpeg: JPEG_A }) })
        expect(await applySyncedProfilePicture(phone.store, phone.files)).toBe(false)
        expect(phone.folder.has("profile-picture-5000.jpg")).toBe(true)
        phone.receive({ [PROFILE_PICTURE_SYNC_KEY]: formatProfilePictureEntry({ at: 6000, jpeg: JPEG_A }) })
        expect(await applySyncedProfilePicture(phone.store, phone.files)).toBe(true)
        expect([...phone.folder]).toEqual([["profile-picture-6000.jpg", JPEG_A]])
    })

    it("the entry stays under the chosen size", async () => {
        // 100 000 base64 characters = 75 KB of JPEG, far below the account server's 10 MB per package
        expect(PROFILE_PICTURE_MAX_BASE64).toBe(100_000)
        expect(PROFILE_PICTURE_QUALITIES).toEqual([0.7, 0.5, 0.3])
        const fits = "A".repeat(PROFILE_PICTURE_MAX_BASE64)
        const tooLarge = "A".repeat(PROFILE_PICTURE_MAX_BASE64 + 4)

        // the first quality that fits is taken
        const tried: number[] = []
        expect(await encodeProfilePicture(async quality => {
            tried.push(quality)
            return quality > 0.5 ? tooLarge : fits
        })).toBe(fits)
        expect(tried).toEqual([0.7, 0.5])
        // a photo that never fits is not used
        await expect(encodeProfilePicture(async () => tooLarge)).rejects.toThrow()
        await expect(encodeProfilePicture(async () => "")).rejects.toThrow()

        const phone = device()
        await chooseProfilePicture(phone.store, phone.files, { jpeg: fits, at: 1000, signedIn: true })
        expect(phone.stored.get(PROFILE_PICTURE_SYNC_KEY)!.length).toBeLessThanOrEqual(PROFILE_PICTURE_MAX_BASE64 + 20)
        // too large a picture is neither stored nor written, and one that arrives is not taken over
        await expect(chooseProfilePicture(phone.store, phone.files, { jpeg: tooLarge, at: 2000, signedIn: true })).rejects.toThrow()
        expect(phone.stored.get(PROFILE_PICTURE_KEY)).toBe("\"profile-picture-1000.jpg\"")
        phone.receive({ [PROFILE_PICTURE_SYNC_KEY]: `v1|3000|${tooLarge}` })
        expect(await applySyncedProfilePicture(phone.store, phone.files)).toBe(false)
        expect(phone.folder.has("profile-picture-1000.jpg")).toBe(true)
    })

    it("reads only well-formed entries", () => {
        expect(parseProfilePictureEntry(undefined)).toBeUndefined()
        expect(parseProfilePictureEntry("")).toBeUndefined()
        expect(parseProfilePictureEntry("v2|1000|QUFB")).toBeUndefined()
        expect(parseProfilePictureEntry("v1|1000")).toBeUndefined()
        expect(parseProfilePictureEntry("v1|0|QUFB")).toBeUndefined()
        expect(parseProfilePictureEntry("v1|-5|QUFB")).toBeUndefined()
        expect(parseProfilePictureEntry("v1|1000|../../secret")).toBeUndefined()
        expect(parseProfilePictureEntry("v1|1000|")).toEqual({ at: 1000, jpeg: "" })
    })

    it("a failed write changes nothing and is tried again", async () => {
        const phone = device({ [PROFILE_PICTURE_SYNC_KEY]: `v1|1000|${JPEG_A}` })
        const failing: ProfilePictureFiles = { ...phone.files, write: async () => Promise.reject(new Error("disk full")) }
        expect(await applySyncedProfilePicture(phone.store, failing)).toBe(false)
        expect(phone.stored.has(PROFILE_PICTURE_KEY)).toBe(false)
        expect(await applySyncedProfilePicture(phone.store, phone.files)).toBe(true)
    })

    it("the entry is synced and backed up, the name and the time stay on the device", () => {
        expect(isDeviceKey(PROFILE_PICTURE_SYNC_KEY)).toBe(false)
        expect(isSyncDeviceKey(PROFILE_PICTURE_SYNC_KEY)).toBe(false)
        expect(isSyncDeviceKey(PROFILE_PICTURE_KEY)).toBe(true)
        expect(isSyncDeviceKey(PROFILE_PICTURE_AT_KEY)).toBe(true)
        // a plain text, not JSON: the sync must not split it into fields (core/account/package.ts)
        expect(() => JSON.parse(formatProfilePictureEntry({ at: 1000, jpeg: JPEG_A })) as unknown).toThrow()
    })
})
