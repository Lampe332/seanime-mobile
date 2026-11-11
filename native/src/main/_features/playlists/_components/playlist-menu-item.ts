import type { CardMenuItem } from "@/components/shared/card-menu"
import { useTr } from "@/lib/app-language"
import { useHasDebridService, useHasOnlineStreaming, useHasTorrentStreaming } from "@/main/_hooks/use-server-status"
import ListPlus from "lucide-react-native/icons/list-plus"
import { usePlaylistEditorManager } from "../lib/playlist-editor-manager"

/**
 * The card menu's "Add to playlist" (media-entry-card.tsx): for anime with files here or on the Nakama host, or on the
 * list while a stream source is on; the editor opens on the anime's episodes. Null when the card has no such entry.
 */
export function usePlaylistMenuItem(mediaId: number, type: "anime" | "manga", entry: { local: boolean, onList: boolean }): CardMenuItem | null {
    const t = useTr()
    const { selectMediaAndOpenEditor } = usePlaylistEditorManager()
    const { hasTorrentStreaming } = useHasTorrentStreaming()
    const { hasDebridService } = useHasDebridService()
    const { hasOnlineStreaming } = useHasOnlineStreaming()
    const streaming = hasTorrentStreaming || hasDebridService || hasOnlineStreaming
    if (type !== "anime" || !(entry.local || (entry.onList && streaming))) return null
    return { id: "playlist", label: t("Add to playlist", "Zur Playlist hinzufügen"), icon: ListPlus, onPress: () => selectMediaAndOpenEditor(mediaId) }
}
