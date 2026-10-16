import { useGetMangaCollection } from "@/api/hooks/manga.hooks"
import { mangaCollectionAtom } from "@/app/(main)/_atoms/manga-collection.atoms"
import { useAtomValue, useSetAtom } from "jotai/react"
import React from "react"

/**
 * @description
 * - Fetches the manga collection and sets it in the atom
 */
export function useMangaCollectionLoader() {

    const setter = useSetAtom(mangaCollectionAtom)

    const { data, status } = useGetMangaCollection()

    React.useEffect(() => {
        if (status === "success") {
            setter(data)
        }
    }, [data, status])

    return null
}

export function useMangaCollection() {
    return useAtomValue(mangaCollectionAtom)
}