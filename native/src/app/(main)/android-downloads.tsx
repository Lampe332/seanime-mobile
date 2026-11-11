import { DownloadsPhone } from "@/main/android-downloads/_screens/downloads-phone"
import { __manga_selectedChapterAtom } from "@/main/manga/_lib/handle-chapter-reader"
import { useFocusEffect, useLocalSearchParams } from "expo-router"
import { useSetAtom } from "jotai"
import React from "react"

// Downloads tab at the old app's path "/android-downloads?kind=torrents" / "?anime=media-1" / "?kind=manga&manga=ID"
// (main/android-downloads/_screens/downloads-phone.tsx). Its own params only, like the Search tab.
export default function DownloadsScreen() {
    const { kind, anime, manga } = useLocalSearchParams<{ kind?: string, anime?: string, manga?: string }>()
    const tab = kind === "torrents" ? "torrents" : kind === "manga" ? "manga" : "anime"
    const setChapter = useSetAtom(__manga_selectedChapterAtom)
    // leaving the tab closes a chapter opened from the Manga tab (2.8)
    useFocusEffect(React.useCallback(() => () => setChapter(undefined), [setChapter]))
    return <DownloadsPhone kind={tab} animeKey={tab === "anime" && anime ? anime : null}
        mangaId={tab === "manga" && manga ? Number(manga) || 0 : 0} />
}
