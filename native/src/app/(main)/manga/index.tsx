import { useHandleMangaCollection } from "@/main/manga/_lib/handle-manga-collection"
import { MangaLibraryPhone } from "@/main/manga/_screens/manga-library-phone"

// The Manga tab at the web app's path "/manga" (manga/page.tsx → MangaLibraryPhone); Menu › Manga.
export default function MangaLibraryRoute() {
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

    return <MangaLibraryPhone
        lists={mangaCollectionLists}
        rawLists={rawMangaCollectionLists}
        loading={mangaCollectionLoading}
        error={mangaCollectionError}
        onRetry={() => void refetchMangaCollection()}
        latestChapterNumbers={latestChapterNumbers}
        storedProviders={storedProviders}
        storedFilters={storedFilters}
    />
}
