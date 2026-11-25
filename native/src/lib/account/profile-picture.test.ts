import { describe, expect, it } from "vitest"
import { files } from "../../../test/expo-file-system"
import { isDeviceKey, isSyncDeviceKey } from "../app-backup-keys"
import { PROFILE_PICTURE_KEY, profilePictureFileUri, resolveProfileAvatar } from "./profile-picture"

const ANILIST = "https://s4.anilist.co/file/avatar.png"

describe("resolveProfileAvatar", () => {
    it("shows the usual avatar without an own picture", () => {
        expect(resolveProfileAvatar("", ANILIST)).toBe(ANILIST)
        expect(resolveProfileAvatar(undefined, ANILIST)).toBe(ANILIST)
        expect(resolveProfileAvatar("", null)).toBeNull()
        expect(resolveProfileAvatar("", undefined)).toBeNull()
    })

    it("shows the own picture when its file is on this device", () => {
        files.set("document/profile-picture-1.jpg", "jpeg")
        try {
            expect(resolveProfileAvatar("profile-picture-1.jpg", ANILIST)).toBe("document/profile-picture-1.jpg")
            expect(resolveProfileAvatar(" profile-picture-1.jpg ", null)).toBe("document/profile-picture-1.jpg")
        } finally {
            files.delete("document/profile-picture-1.jpg")
        }
    })

    it("falls back to the usual avatar for broken data", () => {
        // the file is gone (deleted, or the value came from an old backup)
        expect(resolveProfileAvatar("profile-picture-2.jpg", ANILIST)).toBe(ANILIST)
        // not a string (a hand-edited store)
        expect(resolveProfileAvatar(42, ANILIST)).toBe(ANILIST)
        expect(resolveProfileAvatar({ name: "profile-picture-1.jpg" }, null)).toBeNull()
        expect(resolveProfileAvatar(null, ANILIST)).toBe(ANILIST)
        // a file the fileUri reader throws on
        expect(resolveProfileAvatar("profile-picture-3.jpg", ANILIST, () => {
            throw new Error("unreadable")
        })).toBe(ANILIST)
    })

    it("never reads outside the own pictures", () => {
        files.set("document/secret.txt", "x")
        try {
            expect(profilePictureFileUri("secret.txt")).toBeUndefined()
            expect(profilePictureFileUri("profile-picture-../secret.txt")).toBeUndefined()
            expect(profilePictureFileUri("profile-picture-..\\secret.txt")).toBeUndefined()
            expect(resolveProfileAvatar("secret.txt", ANILIST)).toBe(ANILIST)
        } finally {
            files.delete("document/secret.txt")
        }
    })

    it("keeps the picture on this device: no backup, no sync", () => {
        expect(isDeviceKey(PROFILE_PICTURE_KEY)).toBe(true)
        expect(isSyncDeviceKey(PROFILE_PICTURE_KEY)).toBe(true)
    })
})
