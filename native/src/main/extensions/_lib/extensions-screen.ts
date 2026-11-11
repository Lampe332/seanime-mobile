import type { Extension_Extension, Extension_InvalidExtension, ExtensionRepo_AllExtensions } from "@/api/generated/types"
import { filterMarketplace, isPhoneExtension, PHONE_EXTENSION_TYPES } from "./extensions-phone"

/*
 * Logic of the Extensions tab (web extensions-phone.tsx, -marketplace.tsx, extension-code.tsx) without the screen:
 * the selection behind a row, the marketplace's groups and chips, the repository link check and the line diff of an
 * update's code.
 */

export type ExtensionSelection = {
    extension: Extension_Extension
    invalid?: Extension_InvalidExtension
    userConfigError?: Extension_InvalidExtension
    updateData?: NonNullable<ExtensionRepo_AllExtensions["hasUpdate"]>[number]
    disabled: boolean
    unsafe: boolean
}

/** Everything the sheet of one installed (on, off or broken) extension needs; null once it is uninstalled. */
export function findSelection(all: ExtensionRepo_AllExtensions | undefined, id: string | null): ExtensionSelection | null {
    if (!all || !id) return null
    const enabled = all.extensions?.find(extension => extension.id === id)
    const disabled = all.disabledExtensions?.find(extension => extension.id === id)
    const invalid = all.invalidExtensions?.find(item => item.id === id)
    const extension = enabled ?? disabled ?? (invalid && { ...invalid.extension, id: invalid.extension?.id || invalid.id, name: invalid.extension?.name || invalid.id })
    if (!extension) return null
    return {
        extension,
        invalid: enabled || disabled ? undefined : invalid,
        userConfigError: all.invalidUserConfigExtensions?.find(item => item.id === id),
        updateData: all.hasUpdate?.find(update => update.extensionID === id),
        disabled: !enabled && !!disabled,
        unsafe: !!all.unsafeExtensions?.[id],
    }
}

/** IDs of every installed extension, broken ones included (the marketplace marks them as installed). */
export function installedExtensionIds(all: ExtensionRepo_AllExtensions | undefined) {
    return new Set([...(all?.extensions ?? []), ...(all?.disabledExtensions ?? [])].map(extension => extension.id)
        .concat((all?.invalidExtensions ?? []).map(item => item.id)))
}

/**
 * A full http(s) link (web isWebUrl via `new URL`; Hermes' URL has no reliable `protocol`, so the same rule as a pattern:
 * the scheme, a host without spaces, anything after it).
 */
export function isWebUrl(value: string) {
    return /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i.test(value.trim())
}

export const ALL_TYPES = { type: "all", tabName: "All Types", chipEn: "All", chipDe: "Alle" }

/** Rows per type in the overview; "Show all" opens the type's full list. */
export const OVERVIEW_ROWS = 4

export type MarketplaceFilterState = { type: string, language: string, search: string }

export type MarketplaceView = {
    usable: Extension_Extension[]
    languages: string[]
    /** chips: all + each phone type, with counts that follow language and search */
    chips: { type: string, tabName: string, chipEn: string, chipDe: string, count: number }[]
    groups: (typeof PHONE_EXTENSION_TYPES[number] & { items: Extension_Extension[] })[]
    /** the official repository lists no streaming or manga sources: what is missing */
    missing: typeof PHONE_EXTENSION_TYPES[number][]
    /** a chosen type this repository has nothing of (another repository is needed, not another filter) */
    typeMissing?: typeof PHONE_EXTENSION_TYPES[number]
    filtered: boolean
    /** without a type or a search each type shows its first rows and "Show all" */
    overview: boolean
}

/** The marketplace's lists (MarketplacePhone): phone types only, chips and groups after language and search. */
export function marketplaceView(data: Extension_Extension[] | undefined, filters: MarketplaceFilterState, appLanguage: string, isDefault: boolean): MarketplaceView {
    const usable = (data ?? []).filter(isPhoneExtension)
    const languages = [...new Set(usable.map(extension => extension.lang?.toLowerCase()).filter(Boolean) as string[])].sort()
    const narrowed = filterMarketplace(usable, { type: "all", language: filters.language, search: filters.search }, appLanguage)
    const shown = filters.type === "all" ? narrowed : narrowed.filter(extension => extension.type === filters.type)
    const groups = PHONE_EXTENSION_TYPES.map(item => ({ ...item, items: shown.filter(extension => extension.type === item.type) })).filter(group => group.items.length > 0)
    const chips = [ALL_TYPES, ...PHONE_EXTENSION_TYPES].map(item => ({
        type: item.type, tabName: item.tabName, chipEn: item.chipEn, chipDe: item.chipDe,
        count: item.type === "all" ? narrowed.length : narrowed.filter(extension => extension.type === item.type).length,
    }))
    const missing = isDefault && !!data
        ? PHONE_EXTENSION_TYPES.filter(item => item.type === "onlinestream-provider" || item.type === "manga-provider")
            .filter(item => !usable.some(extension => extension.type === item.type))
        : []
    const typeMissing = filters.type !== "all" && !usable.some(extension => extension.type === filters.type)
        ? PHONE_EXTENSION_TYPES.find(item => item.type === filters.type) : undefined
    return {
        usable, languages, chips, groups, missing, typeMissing,
        filtered: filters.type !== "all" || filters.language !== "all" || !!filters.search.trim(),
        overview: filters.type === "all" && !filters.search.trim(),
    }
}

export type DiffLine = { kind: "same" | "add" | "del", text: string }

/** The editor's normalisation before a diff (extension-code.tsx normalizeDiffCode): no BOM, LF line ends. */
export function normalizeDiffCode(code: string) {
    return code.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
}

/** Above this many cells (changed old lines × changed new lines) the middle is shown as removed block + added block. */
const MAX_DIFF_CELLS = 4_000_000

/**
 * The unified diff of an update (web: CodeMirror's unifiedMergeView), line by line: common start and end stay, the
 * changed middle by longest common subsequence. A very large middle stays correct but coarse (all removed, all added).
 */
export function lineDiff(oldCode: string, newCode: string): DiffLine[] {
    const a = normalizeDiffCode(oldCode).split("\n")
    const b = normalizeDiffCode(newCode).split("\n")
    let start = 0
    while (start < a.length && start < b.length && a[start] === b[start]) start++
    let endA = a.length, endB = b.length
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--
        endB--
    }
    const out: DiffLine[] = a.slice(0, start).map(text => ({ kind: "same", text }))
    const midA = a.slice(start, endA), midB = b.slice(start, endB)
    const n = midA.length, m = midB.length
    if (n * m > MAX_DIFF_CELLS) {
        out.push(...midA.map(text => ({ kind: "del" as const, text })), ...midB.map(text => ({ kind: "add" as const, text })))
    } else if (n || m) {
        // lcs[i][j] = length of the LCS of midA[i..] and midB[j..], flat for memory
        const w = m + 1
        const lcs = new Uint32Array((n + 1) * w)
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                lcs[i * w + j] = midA[i] === midB[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
            }
        }
        let i = 0, j = 0
        while (i < n && j < m) {
            if (midA[i] === midB[j]) {
                out.push({ kind: "same", text: midA[i] })
                i++
                j++
            } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
                out.push({ kind: "del", text: midA[i++] })
            } else {
                out.push({ kind: "add", text: midB[j++] })
            }
        }
        while (i < n) out.push({ kind: "del", text: midA[i++] })
        while (j < m) out.push({ kind: "add", text: midB[j++] })
    }
    out.push(...a.slice(endA).map(text => ({ kind: "same" as const, text })))
    return out
}

/** The extension's preference values to save: every field, the typed value or its default (extension-user-config.tsx). */
export function userConfigValues(fields: { name: string, default?: string }[] | undefined, typed: Record<string, string>) {
    const values: Record<string, string> = {}
    for (const field of fields ?? []) values[field.name] = typed[field.name] || field.default || ""
    return values
}
