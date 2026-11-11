import { Anime_AutoSelectPreference, Anime_AutoSelectProfile } from "@/api/generated/types"

/**
 * The auto-select profile (backend: internal/library/anime/autoselect_types.go) as the form edits it, and back.
 * The server treats "" as neutral for the four preferences, a missing list as empty, and a profile with dbId 0 as "never saved".
 */

export const PREFERENCES: Anime_AutoSelectPreference[] = ["neutral", "prefer", "avoid", "only", "never"]
export const MAX_PROVIDERS = 3

export type AutoSelectForm = {
    providers: string[]
    releaseGroups: string[]
    resolutions: string[]
    excludeTerms: string[]
    preferredLanguages: string[]
    preferredCodecs: string[]
    preferredSources: string[]
    multipleAudioPreference: Anime_AutoSelectPreference
    multipleSubsPreference: Anime_AutoSelectPreference
    batchPreference: Anime_AutoSelectPreference
    bestReleasePreference: Anime_AutoSelectPreference
    requireLanguage: boolean
    requireCodec: boolean
    requireSource: boolean
    /** Digits only, "" = no minimum */
    minSeeders: string
    /** "" or a size such as "200MB", "1.5GB" */
    minSize: string
    maxSize: string
}

export const EMPTY_FORM: AutoSelectForm = {
    providers: [],
    releaseGroups: [],
    resolutions: [],
    excludeTerms: [],
    preferredLanguages: [],
    preferredCodecs: [],
    preferredSources: [],
    multipleAudioPreference: "neutral",
    multipleSubsPreference: "neutral",
    batchPreference: "neutral",
    bestReleasePreference: "neutral",
    requireLanguage: false,
    requireCodec: false,
    requireSource: false,
    minSeeders: "",
    minSize: "",
    maxSize: "",
}

function preference(value: string | null | undefined): Anime_AutoSelectPreference {
    return PREFERENCES.includes(value as Anime_AutoSelectPreference) ? value as Anime_AutoSelectPreference : "neutral"
}

function list(value: string[] | null | undefined) {
    return Array.isArray(value) ? value.filter(item => typeof item === "string" && item.trim()) : []
}

export function profileToForm(profile: Anime_AutoSelectProfile | null | undefined): AutoSelectForm {
    if (!profile) return { ...EMPTY_FORM }
    return {
        providers: list(profile.providers),
        releaseGroups: list(profile.releaseGroups),
        resolutions: list(profile.resolutions),
        excludeTerms: list(profile.excludeTerms),
        preferredLanguages: list(profile.preferredLanguages),
        preferredCodecs: list(profile.preferredCodecs),
        preferredSources: list(profile.preferredSources),
        multipleAudioPreference: preference(profile.multipleAudioPreference),
        multipleSubsPreference: preference(profile.multipleSubsPreference),
        batchPreference: preference(profile.batchPreference),
        bestReleasePreference: preference(profile.bestReleasePreference),
        requireLanguage: !!profile.requireLanguage,
        requireCodec: !!profile.requireCodec,
        requireSource: !!profile.requireSource,
        minSeeders: profile.minSeeders ? String(profile.minSeeders) : "",
        minSize: (profile.minSize ?? "").trim(),
        maxSize: (profile.maxSize ?? "").trim(),
    }
}

/** dbId is passed through: the server stores into the one row it already has. */
export function formToProfile(form: AutoSelectForm, dbId = 0): Anime_AutoSelectProfile {
    return {
        dbId,
        providers: form.providers.slice(0, MAX_PROVIDERS),
        releaseGroups: form.releaseGroups,
        resolutions: form.resolutions,
        excludeTerms: form.excludeTerms,
        preferredLanguages: form.preferredLanguages,
        preferredCodecs: form.preferredCodecs,
        preferredSources: form.preferredSources,
        multipleAudioPreference: form.multipleAudioPreference,
        multipleSubsPreference: form.multipleSubsPreference,
        batchPreference: form.batchPreference,
        bestReleasePreference: form.bestReleasePreference,
        requireLanguage: form.requireLanguage,
        requireCodec: form.requireCodec,
        requireSource: form.requireSource,
        minSeeders: Number(form.minSeeders) || 0,
        minSize: form.minSize.trim(),
        maxSize: form.maxSize.trim(),
    }
}

/** Adds an entry to the end (the order is the priority); empty and case-insensitive duplicates are ignored. */
export function addToken(items: string[], raw: string, max = Infinity): string[] {
    const token = raw.trim()
    if (!token || items.length >= max || items.some(item => item.toLowerCase() === token.toLowerCase())) return items
    return [...items, token]
}

export function removeToken(items: string[], token: string): string[] {
    return items.filter(item => item !== token)
}

/** Selects or deselects an entry of an ordered list; a new one goes to the end. */
export function toggleToken(items: string[], token: string, max = Infinity): string[] {
    return items.includes(token) ? removeToken(items, token) : addToken(items, token, max)
}

/** Same sizes the server reads (util.StringToBytes): a number and an optional B/KB/MB/GB/TB/KiB... unit. */
const SIZE = /^\d+(\.\d+)?\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)?$/i

export function isValidSize(value: string) {
    const v = value.trim()
    return !v || SIZE.test(v)
}

function sizeBytes(value: string) {
    const v = value.trim().toUpperCase().replace("IB", "B")
    const unit = /(TB|GB|MB|KB|B)$/.exec(v)?.[1]
    const factor = { TB: 1024 ** 4, GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024, B: 1 }[unit ?? "B"] as number
    return parseFloat(unit ? v.slice(0, -unit.length) : v) * factor
}

type SizeError = "format" | "range"

/** The fields that cannot be saved: a bad size, or a minimum above the maximum. */
export function formErrors(form: AutoSelectForm): { minSize?: SizeError, maxSize?: SizeError } {
    const errors: { minSize?: SizeError, maxSize?: SizeError } = {}
    if (!isValidSize(form.minSize)) errors.minSize = "format"
    if (!isValidSize(form.maxSize)) errors.maxSize = "format"
    if (!errors.minSize && !errors.maxSize && form.minSize.trim() && form.maxSize.trim() && sizeBytes(form.minSize) > sizeBytes(form.maxSize)) {
        errors.maxSize = "range"
    }
    return errors
}

export function formEquals(a: AutoSelectForm, b: AutoSelectForm) {
    return JSON.stringify(a) === JSON.stringify(b)
}

/** Choices for a list: the presets, plus stored entries no preset has (set elsewhere), so nothing stored is hidden. */
export function withStored<T extends { value: string }>(presets: T[], stored: string[], make: (value: string) => T): T[] {
    return [...presets, ...stored.filter(value => !presets.some(preset => preset.value === value)).map(make)]
}
