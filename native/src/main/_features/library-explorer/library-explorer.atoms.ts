import { Anime_LocalFile, LibraryExplorer_FileTreeNodeJSON } from "@/api/generated/types"
import { atom } from "jotai"
import { useSetAtom } from "jotai/react"

export const libraryExplorer_drawerOpenAtom = atom(false)

export const libraryExplorer_selectedNodeAtom = atom<LibraryExplorer_FileTreeNodeJSON | null>(null)

export const libraryExplorer_isSelectingPathsAtom = atom(false)
export const libraryExplorer_selectedPathsAtom = atom<Set<string>>(new Set<string>())

export type LibraryExplorer_Filter = "UNLOCKED" | "UNMATCHED" | "IGNORED" | "UNKNOWN_MEDIA" | undefined

export const libraryExplorer_selectedFilterAtom = atom<LibraryExplorer_Filter>(undefined)

export const libraryExplorer_matchLocalFilesAtom = atom<Anime_LocalFile[]>([])
export const libraryExplorer_resolveUnknownLocalFilesAtom = atom<Anime_LocalFile[]>([])

export const libraryExplorer_openDirectoryAtom = atom<string | null>(null)

export const libraryExplorer_superUpdateDrawerOpenAtom = atom(false)

export function useLibraryExplorer() {
    const setOpen = useSetAtom(libraryExplorer_drawerOpenAtom)
    const setOpenDirInLibraryExplorer = useSetAtom(libraryExplorer_openDirectoryAtom)
    return {
        // The web app waited 200 ms for the card menu to close; the native menu closes before its item runs.
        openDirInLibraryExplorer: (path: string) => {
            setOpenDirInLibraryExplorer(path)
            setOpen(true)
        },
    }
}
