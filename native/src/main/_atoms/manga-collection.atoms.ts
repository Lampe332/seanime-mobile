import { Manga_Collection, Manga_CollectionEntry } from "@/api/generated/types"
import { atom } from "jotai"
import { atomFamily } from "jotai-family"

export const mangaCollectionAtom = atom<Manga_Collection | undefined>(undefined)

const mangaCollectionEntryIndexAtom = atom<Record<number, Manga_CollectionEntry>>((get) => {
    const index: Record<number, Manga_CollectionEntry> = {}

    get(mangaCollectionAtom)?.lists?.forEach(list => {
        list.entries?.forEach(entry => {
            if (!entry) {
                return
            }

            index[entry.mediaId] = entry
        })
    })

    return index
})

export const getMangaCollectionEntryAtom = atomFamily((mediaId: number) => atom((get) => get(mangaCollectionEntryIndexAtom)[mediaId]))
