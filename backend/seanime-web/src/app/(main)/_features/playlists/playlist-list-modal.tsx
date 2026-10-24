import { Anime_LibraryCollectionList } from "@/api/generated/types"
import { useGetLibraryCollection } from "@/api/hooks/anime_collection.hooks"
import { usePlaylistEditorManager } from "@/app/(main)/_features/playlists/lib/playlist-editor-manager"
import { MobilePlaylists } from "./_components/mobile-playlists"
import React from "react"
import { toast } from "sonner"

export function PlaylistListModal() {
    const { setModalOpen, setSelectedMedia, selectedMedia } = usePlaylistEditorManager()

    const { data: _data, isLoading: isLibraryLoading } = useGetLibraryCollection()

    const libraryCollection = React.useMemo(() => {
        if (!_data?.lists) return undefined
        if (!!_data?.stream) {
            // Add to current list
            let currentList = _data.lists?.find(n => n.type === "CURRENT")
            let entries = [...(currentList?.entries ?? [])]
            for (let anime of (_data.stream.anime ?? [])) {
                if (!entries.some(e => e.mediaId === anime.id)) {
                    entries.push({
                        media: anime,
                        mediaId: anime.id,
                        listData: _data.stream.listData?.[anime.id],
                        libraryData: undefined,
                    })
                }
            }
            return {
                ..._data,
                lists: [
                    {
                        type: "CURRENT",
                        status: "CURRENT",
                        entries: entries,
                    } as Anime_LibraryCollectionList,
                    ...(_data.lists ?? [])?.filter(n => n.type !== "CURRENT") ?? [],
                ].filter(Boolean),
            }
        } else {
            return _data
        }
    }, [_data])

    const allEntries = libraryCollection?.lists?.flatMap(n => n.entries) ?? []

    React.useEffect(() => {
        if (selectedMedia && !isLibraryLoading && libraryCollection) {
            if (!allEntries.find(n => n?.mediaId === selectedMedia)) {
                toast.warning("This anime is not in your library or currently watching collection.")
                setSelectedMedia(null)
                React.startTransition(() => {
                    setModalOpen(false)
                })
            }
        }
    }, [selectedMedia, allEntries, isLibraryLoading, libraryCollection])

    return <MobilePlaylists libraryCollection={libraryCollection} libraryLoading={isLibraryLoading} />
}
