import { ExtensionRepo_MangaProviderExtensionItem, Manga_MangaPreferences } from "@/api/generated/types"

export type MangaEntryFilters = {
    scanlators: string[]
    language: string
}

export function toMangaPreferences(providers: Record<string, string>, filters: Record<string, MangaEntryFilters>): Manga_MangaPreferences {
    const entries: NonNullable<Manga_MangaPreferences["entries"]> = {}

    for (const [mediaId, provider] of Object.entries(providers)) {
        entries[Number(mediaId)] = { provider, filters: {} }
    }

    for (const [key, filter] of Object.entries(filters)) {
        const separator = key.indexOf("$")
        if (separator <= 0) continue
        const mediaId = Number(key.slice(0, separator))
        const provider = key.slice(separator + 1)
        if (!Number.isInteger(mediaId) || mediaId <= 0 || !provider) continue

        const entry = entries[mediaId] ?? { provider: "", filters: {} }
        entry.filters ??= {}
        entry.filters[provider] = {
            scanlators: filter.scanlators ?? [],
            language: filter.language ?? "",
        }
        entries[mediaId] = entry
    }

    return { entries }
}

export function fromMangaPreferences(preferences: Manga_MangaPreferences) {
    const providers: Record<string, string> = {}
    const filters: Record<string, MangaEntryFilters> = {}

    for (const [mediaId, entry] of Object.entries(preferences.entries ?? {})) {
        if (entry.provider) {
            providers[mediaId] = entry.provider
        }
        for (const [provider, filter] of Object.entries(entry.filters ?? {})) {
            filters[`${mediaId}$${provider}`] = {
                scanlators: filter.scanlators ?? [],
                language: filter.language ?? "",
            }
        }
    }

    return { providers, filters }
}

export function getActiveMangaFilters(
    storedFilters: Record<string, MangaEntryFilters>,
    selectedProviders: Record<string, string>,
    extensions: ExtensionRepo_MangaProviderExtensionItem[] | undefined,
) {
    const filters: Record<string, MangaEntryFilters> = {}

    for (const [key, value] of Object.entries(storedFilters)) {
        const [mediaId, providerId] = key.split("$")
        const selectedProvider = selectedProviders[mediaId]
        if (!selectedProvider || providerId !== selectedProvider) continue

        const extension = extensions?.find(extension => extension.id === selectedProvider)
        if (!extension?.settings?.supportsMultiScanlator && !extension?.settings?.supportsMultiLanguage) continue

        filters[mediaId] = {
            scanlators: value.scanlators ?? [],
            language: value.language ?? "",
        }
    }

    return filters
}

/** The source for a manga without one: the saved default when it is installed, otherwise the first installed one */
export function defaultMangaProvider(
    savedDefault: string | undefined,
    extensions: ExtensionRepo_MangaProviderExtensionItem[] | undefined,
): string | null {
    const saved = savedDefault ? extensions?.find(extension => extension.id === savedDefault) : undefined
    return saved?.id ?? extensions?.[0]?.id ?? null
}

/** Stored sources that are no longer installed (such as the old built-in "local-manga") replaced; null when none is */
export function withInstalledProviders(
    stored: Record<string, string>,
    extensions: ExtensionRepo_MangaProviderExtensionItem[],
    fallback: string,
): Record<string, string> | null {
    let next: Record<string, string> | null = null
    for (const [mediaId, providerId] of Object.entries(stored)) {
        if (extensions.some(extension => extension.id === providerId)) continue
        next ??= { ...stored }
        next[mediaId] = fallback
    }
    return next
}
