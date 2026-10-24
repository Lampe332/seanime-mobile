import { Anime_LibraryCollection, Anime_LibraryCollectionEntry } from "@/api/generated/types"
import { atom } from "jotai"
import { atomFamily } from "jotai-family"

export const animeLibraryCollectionAtom = atom<Anime_LibraryCollection | undefined>(undefined)

const animeLibraryEntryIndexAtom = atom<Record<number, Anime_LibraryCollectionEntry>>((get) => {
    const index: Record<number, Anime_LibraryCollectionEntry> = {}

    get(animeLibraryCollectionAtom)?.lists?.forEach(list => {
        list.entries?.forEach(entry => {
            if (!entry) {
                return
            }

            index[entry.mediaId] = entry
        })
    })

    return index
})

export const getAnimeLibraryEntryAtom = atomFamily((mediaId: number) => atom((get) => get(animeLibraryEntryIndexAtom)[mediaId]))
