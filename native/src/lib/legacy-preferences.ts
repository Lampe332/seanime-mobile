/*
 * E6: the release replaces Seanime Mobile 2.0.33 in the same package. Library, settings, lists and downloads live in the
 * Go data folder and stay; the few settings the old app's Kotlin kept in SharedPreferences are copied once into MMKV
 * here (docs/NATIVE-UMBAU.md §9 "E6 Datenübernahme"). Runs before any atom reads storage (index.ts imports
 * legacy-preferences-run.ts first) and never overwrites a value the new app already has.
 */
import type { LegacyPreferences } from "../../modules/seanime-server"

/** MMKV keys of the new app (lib/app-language.ts, lib/feedback.ts, lib/airing/airing-notifier.ts). */
export const LEGACY_TARGET_KEYS = {
    language: "seanime-mobile-language",
    feedbackHaptics: "seanime-mobile-feedback-haptics",
    feedbackSounds: "seanime-mobile-feedback-sounds",
    airingEnabled: "seanime-mobile-airing-notifications",
    airingAnnounced: "seanime-mobile-airing-announced",
} as const

/** Set once the copy ran, so a later change in the new app is never overwritten by the old value. */
export const LEGACY_MIGRATED_KEY = "seanime-mobile-legacy-preferences-copied"

export type KeyValueStore = {
    getString(key: string): string | undefined
    set(key: string, value: string): void
}

/** The MMKV values (JSON, as atomWithStorage writes them) to take over from the old app's preferences. */
export function legacyWrites(legacy: LegacyPreferences, has: (key: string) => boolean): [string, string][] {
    const writes: [string, string][] = []
    const add = (key: string, value: unknown) => {
        if (!has(key)) writes.push([key, JSON.stringify(value)])
    }
    if (legacy.language === "de" || legacy.language === "en") add(LEGACY_TARGET_KEYS.language, legacy.language)
    if (typeof legacy.feedbackHaptics === "boolean") add(LEGACY_TARGET_KEYS.feedbackHaptics, legacy.feedbackHaptics)
    if (typeof legacy.feedbackSounds === "boolean") add(LEGACY_TARGET_KEYS.feedbackSounds, legacy.feedbackSounds)
    if (typeof legacy.airingEnabled === "boolean") add(LEGACY_TARGET_KEYS.airingEnabled, legacy.airingEnabled)
    const announced = announcedMap(legacy.airingAnnounced)
    if (announced) add(LEGACY_TARGET_KEYS.airingAnnounced, announced)
    return writes
}

/** AiringNotifier.kt stored {"<mediaId>": <episode>}; the new notifier reads the same shape (airing-policy.ts Announced). */
function announcedMap(json: string | undefined): Record<number, number> | null {
    if (!json) return null
    try {
        const parsed: unknown = JSON.parse(json)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
        const result: Record<number, number> = {}
        for (const [id, episode] of Object.entries(parsed)) {
            if (/^\d+$/.test(id) && Number.isInteger(episode)) result[Number(id)] = episode as number
        }
        return Object.keys(result).length ? result : null
    }
    catch {
        return null
    }
}

/** Copies the old app's preferences once; returns the keys it wrote. `read` failing (no native module) copies nothing. */
export function copyLegacyPreferences(store: KeyValueStore, read: () => LegacyPreferences): string[] {
    if (store.getString(LEGACY_MIGRATED_KEY) !== undefined) return []
    let legacy: LegacyPreferences
    try {
        legacy = read()
    }
    catch {
        return []
    }
    const writes = legacyWrites(legacy, key => store.getString(key) !== undefined)
    for (const [key, value] of writes) store.set(key, value)
    store.set(LEGACY_MIGRATED_KEY, JSON.stringify(Date.now()))
    return writes.map(([key]) => key)
}
