import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Manga_MangaPreferences, Manga_MangaSourceRefreshJob } from "@/api/generated/types"
import { useGetMangaPreferences, useGetMangaSourceRefresh, useImportMangaPreferences } from "@/api/hooks/manga.hooks"
import { WSEvents } from "@/lib/server/ws-events"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useQueryClient } from "@tanstack/react-query"
import { useAtom, useSetAtom } from "jotai"
import React from "react"
import { __manga_entryFiltersAtom, __manga_entryProviderAtom, __manga_preferencesHydratedAtom } from "./handle-manga-selected-provider"
import { fromMangaPreferences, toMangaPreferences } from "./manga-preferences"

/*
 * manga-preferences-sync.tsx, mounted once in the main layout like the web's main-layout. Since Seanime 3.10 the chosen
 * source and chapter filters of every manga live on the server; this imports the app's stored ones once, then mirrors
 * the server's into the atoms and marks them ready (__manga_preferencesHydratedAtom): "Continue reading" and the source
 * refresh wait for that, so they never act on a source the server has already changed.
 */
export function MangaPreferencesSync() {
    const queryClient = useQueryClient()
    const { data: serverPreferences } = useGetMangaPreferences()
    const { mutate: importPreferences, isPending: importPending } = useImportMangaPreferences()
    const [providers, setProviders] = useAtom(__manga_entryProviderAtom)
    const [filters, setFilters] = useAtom(__manga_entryFiltersAtom)
    const setHydrated = useSetAtom(__manga_preferencesHydratedAtom)
    const initialized = React.useRef(false)
    // the app's stored choices before the first sync (only the first render's value is kept)
    const legacyPreferences = React.useRef(toMangaPreferences(providers, filters))

    const applyPreferences = React.useCallback((pref: Manga_MangaPreferences) => {
        const unpacked = fromMangaPreferences(pref)
        setProviders(unpacked.providers)
        setFilters(unpacked.filters)
        setHydrated(true)
    }, [setFilters, setHydrated, setProviders])

    React.useEffect(() => {
        if (!serverPreferences) return
        if (!initialized.current) {
            initialized.current = true
            importPreferences(legacyPreferences.current, {
                onSuccess: pref => {
                    const canonical = pref ?? serverPreferences
                    queryClient.setQueryData([API_ENDPOINTS.MANGA.GetMangaPreferences.key], canonical)
                    applyPreferences(canonical)
                },
                onError: () => setHydrated(false),
            })
            return
        }
        if (!importPending) applyPreferences(serverPreferences)
    }, [applyPreferences, importPending, importPreferences, queryClient, serverPreferences, setHydrated])

    const handlePreferencesUpdated = React.useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaPreferences.key] })
    }, [queryClient])

    useWebsocketMessageListener({ type: WSEvents.MANGA_PREFERENCES_UPDATED, onMessage: handlePreferencesUpdated })

    return null
}

/** Keeps the source refresh job current from the server's events and reloads chapters once a job ends. */
export function MangaSourceRefreshSync() {
    const queryClient = useQueryClient()
    const { data: job } = useGetMangaSourceRefresh()
    const handledJob = React.useRef<string | null>(null)

    const handleJobUpdated = React.useCallback((updatedJob: Manga_MangaSourceRefreshJob) => {
        queryClient.setQueryData([API_ENDPOINTS.MANGA.GetMangaSourceRefresh.key], updatedJob)
    }, [queryClient])

    useWebsocketMessageListener({ type: WSEvents.MANGA_SOURCE_REFRESH_UPDATED, onMessage: handleJobUpdated })

    const terminal = job?.status === "completed" || job?.status === "cancelled" || job?.status === "failed"
    React.useEffect(() => {
        if (!job || !terminal || handledJob.current === job.id) return
        handledJob.current = job.id
        void (async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaPreferences.key] })
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaLatestChapterNumbersMap.key] }),
                queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaEntryChapters.key] }),
                queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaEntryPages.key] }),
            ])
        })()
    }, [job, queryClient, terminal])

    return null
}
