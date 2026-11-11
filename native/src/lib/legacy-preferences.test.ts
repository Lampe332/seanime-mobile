import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { copyLegacyPreferences, LEGACY_MIGRATED_KEY, LEGACY_TARGET_KEYS, legacyWrites } from "./legacy-preferences"

const memoryStore = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial))
    return { values, getString: (key: string) => values.get(key), set: (key: string, value: string) => void values.set(key, value) }
}

const source = (path: string) => readFileSync(join(__dirname, path), "utf8")

describe("legacy preferences of Seanime Mobile 2.0.33", () => {
    it("the target keys are the ones the new app's atoms read", () => {
        expect(source("app-language.ts")).toContain(`const STORAGE_KEY = "${LEGACY_TARGET_KEYS.language}"`)
        expect(source("feedback.ts")).toContain(`const HAPTICS_KEY = "${LEGACY_TARGET_KEYS.feedbackHaptics}"`)
        expect(source("feedback.ts")).toContain(`const SOUNDS_KEY = "${LEGACY_TARGET_KEYS.feedbackSounds}"`)
        expect(source("airing/airing-notifier.ts")).toContain(`const ENABLED_KEY = "${LEGACY_TARGET_KEYS.airingEnabled}"`)
        expect(source("airing/airing-notifier.ts")).toContain(`const ANNOUNCED_KEY = "${LEGACY_TARGET_KEYS.airingAnnounced}"`)
    })

    it("the Kotlin reader uses the old app's preference files and keys", () => {
        const module = source("../../modules/seanime-server/android/src/main/java/com/seanime/server/SeanimeServerModule.kt")
        const old = (file: string) => source(`../../../app/src/main/java/com/seanime/app/${file}`)
        expect(old("AppLanguage.kt")).toContain(`PREFS = "seanime_app"`)
        expect(old("AppLanguage.kt")).toContain(`KEY = "language"`)
        expect(old("Feedback.kt")).toContain(`KEY_HAPTICS = "feedback_haptics"`)
        expect(old("Feedback.kt")).toContain(`KEY_SOUNDS = "feedback_sounds"`)
        expect(old("notify/AiringNotifier.kt")).toContain(`PREFS = "airing_notifier"`)
        expect(old("notify/AiringNotifier.kt")).toContain(`getBoolean("enabled", true)`)
        for (const text of [`getSharedPreferences("seanime_app"`, `getSharedPreferences("airing_notifier"`, `"feedback_haptics"`,
            `"feedback_sounds"`, `getString("language", null)`, `contains("enabled")`, `getString("announced", null)`]) {
            expect(module).toContain(text)
        }
    })

    it("an updated phone gets its language, feedback and new-episode settings as JSON values", () => {
        const store = memoryStore()
        const written = copyLegacyPreferences(store, () => ({
            language: "de", feedbackHaptics: false, feedbackSounds: true, airingEnabled: false, airingAnnounced: "{\"21\":5,\"166\":12}",
        }))
        expect(written).toHaveLength(5)
        expect(store.values.get(LEGACY_TARGET_KEYS.language)).toBe("\"de\"")
        expect(store.values.get(LEGACY_TARGET_KEYS.feedbackHaptics)).toBe("false")
        expect(store.values.get(LEGACY_TARGET_KEYS.feedbackSounds)).toBe("true")
        expect(store.values.get(LEGACY_TARGET_KEYS.airingEnabled)).toBe("false")
        expect(JSON.parse(store.values.get(LEGACY_TARGET_KEYS.airingAnnounced)!)).toEqual({ 21: 5, 166: 12 })
        expect(store.values.has(LEGACY_MIGRATED_KEY)).toBe(true)
    })

    it("runs once and never overwrites a value of the new app", () => {
        const store = memoryStore({ [LEGACY_TARGET_KEYS.language]: "\"en\"" })
        expect(copyLegacyPreferences(store, () => ({ language: "de", feedbackHaptics: false }))).toEqual([LEGACY_TARGET_KEYS.feedbackHaptics])
        expect(store.values.get(LEGACY_TARGET_KEYS.language)).toBe("\"en\"")
        store.values.delete(LEGACY_TARGET_KEYS.feedbackHaptics)
        expect(copyLegacyPreferences(store, () => ({ feedbackHaptics: false }))).toEqual([])
        expect(store.values.has(LEGACY_TARGET_KEYS.feedbackHaptics)).toBe(false)
    })

    it("a fresh install (nothing stored) or a missing native module writes no setting", () => {
        const fresh = memoryStore()
        expect(copyLegacyPreferences(fresh, () => ({}))).toEqual([])
        expect([...fresh.values.keys()]).toEqual([LEGACY_MIGRATED_KEY])
        const broken = memoryStore()
        expect(copyLegacyPreferences(broken, () => { throw new Error("no native module") })).toEqual([])
        expect(broken.values.size).toBe(0)
    })

    it("ignores unusable old values", () => {
        expect(legacyWrites({ language: "fr", airingAnnounced: "[1,2]" }, () => false)).toEqual([])
        expect(legacyWrites({ airingAnnounced: "not json" }, () => false)).toEqual([])
        expect(legacyWrites({ airingAnnounced: "{\"x\":1,\"5\":\"2\"}" }, () => false)).toEqual([])
    })
})
