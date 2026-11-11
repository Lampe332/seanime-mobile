import { atom, useAtom } from "jotai"

/* Who opens the playlist editor and with what (web playlists/lib/playlist-editor-manager.ts). */

const playlistEditorManager_isOpenAtom = atom(false)
const playlistEditorManager_selectedMediaAtom = atom<number | null>(null)
const playlistEditorManager_episodeToAddAtom = atom<string | null>(null)

export function usePlaylistEditorManager() {
    const [isModalOpen, setModalOpen] = useAtom(playlistEditorManager_isOpenAtom)
    const [selectedMedia, setSelectedMedia] = useAtom(playlistEditorManager_selectedMediaAtom)
    const [episodeToAdd, setEpisodeToAdd] = useAtom(playlistEditorManager_episodeToAddAtom)

    /** Card menu "Add to playlist": the editor opens on this anime's episodes */
    function selectMediaAndOpenEditor(mediaId: number) {
        setSelectedMedia(mediaId)
        setModalOpen(true)
    }

    /** An episode's "Add to playlist": the editor opens with it already picked */
    function selectEpisodeToAddAndOpenEditor(mediaId: number, anidbEpisode: string) {
        setSelectedMedia(mediaId)
        setEpisodeToAdd(anidbEpisode)
        setModalOpen(true)
    }

    return {
        selectedMedia, setSelectedMedia, episodeToAdd, setEpisodeToAdd, isModalOpen, setModalOpen, selectMediaAndOpenEditor, selectEpisodeToAddAndOpenEditor,
    }
}
