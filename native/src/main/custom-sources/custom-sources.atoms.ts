import { atomWithStorage } from "@/lib/storage"
import { atomWithImmer } from "jotai-immer"

/* The custom sources screen's query and its source (web custom-sources.atom.ts; the source is kept in MMKV under the same key). */

export type CustomSourcesParams = {
    search: string
    page: number
    perPage: number
    type: "anime" | "manga"
}

export const __customSources_paramsAtom = atomWithImmer<CustomSourcesParams>({
    type: "anime",
    search: "",
    page: 1,
    perPage: 100,
})

export const __customSources_providerAtom = atomWithStorage<string | null>("sea-custom-sources-provider", null)
