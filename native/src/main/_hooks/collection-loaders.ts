import { useGetLibraryCollection } from "@/api/hooks/anime_collection.hooks"
import { useGetMangaCollection } from "@/api/hooks/manga.hooks"
import { animeLibraryCollectionAtom } from "@/main/_atoms/anime-library-collection.atoms"
import { mangaCollectionAtom } from "@/main/_atoms/manga-collection.atoms"
import { useSetAtom } from "jotai"
import React from "react"

// anime-library-collection-loader.ts + manga-collection-loader.ts of the web app (mounted once in the main layout):
// fetch the local library and the manga collection and keep them in their atoms.
export function useAnimeLibraryCollectionLoader() {
    const setter = useSetAtom(animeLibraryCollectionAtom)
    const { data, status } = useGetLibraryCollection()
    React.useEffect(() => {
        if (status === "success") setter(data)
    }, [data, status, setter])
}

export function useMangaCollectionLoader() {
    const setter = useSetAtom(mangaCollectionAtom)
    const { data, status } = useGetMangaCollection()
    React.useEffect(() => {
        if (status === "success") setter(data)
    }, [data, status, setter])
}
