import { useHandleMangaCollection } from "@/app/(main)/manga/_lib/handle-manga-collection"
import { MangaLibraryPhone } from "@/app/(main)/manga/_screens/manga-library-phone"
import React from "react"


export default function Page() {
    const {
        mangaCollectionLoading,
        mangaCollectionError,
        refetchMangaCollection,
        mangaCollectionLists,
        rawMangaCollectionLists,
        latestChapterNumbers,
        storedFilters,
        storedProviders,
    } = useHandleMangaCollection({ redirectOnError: false, keepGenresOnUnreadToggle: true })

    return (
        <MangaLibraryPhone
            lists={mangaCollectionLists}
            rawLists={rawMangaCollectionLists}
            loading={mangaCollectionLoading}
            error={mangaCollectionError}
            onRetry={() => refetchMangaCollection()}
            latestChapterNumbers={latestChapterNumbers}
            storedProviders={storedProviders}
            storedFilters={storedFilters}
        />
    )
}
