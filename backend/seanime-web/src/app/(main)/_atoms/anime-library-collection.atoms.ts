import { Anime_LibraryCollection, Anime_LibraryCollectionEntry } from "@/api/generated/types"
import { atom } from "jotai"
import { derive } from "jotai-derive"
import { atomFamily } from "jotai-family"

export const animeLibraryCollectionAtom = atom<Anime_LibraryCollection | undefined>(undefined)
export const animeLibraryCollectionWithoutStreamsAtom = derive([animeLibraryCollectionAtom], (animeLibraryCollection) => {
    if (!animeLibraryCollection) {
        return undefined
    }
    return {
        ...animeLibraryCollection,
        lists: animeLibraryCollection.lists?.map(list => ({
            ...list,
            entries: list.entries?.filter(n => !!n.libraryData),
        })),
    } as Anime_LibraryCollection
})

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
