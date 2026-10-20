import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSetAtom } from "jotai"
import React from "react"
import { createRoot } from "react-dom/client"
import { MangaReaderBar } from "../backend/seanime-web/src/app/(main)/manga/_containers/chapter-reader/manga-reader-bar"
import { __manga_selectedChapterAtom } from "../backend/seanime-web/src/app/(main)/manga/_lib/handle-chapter-reader"

const w = window as any
w.chapterMoves = []
const pages = Array.from({ length: 12 }, (_, index) => ({ index, url: `p${index}`, provider: "x" }))
function Reader() {
    const setChapter = useSetAtom(__manga_selectedChapterAtom)
    React.useLayoutEffect(() => { setChapter({ chapterId: "c2", chapterNumber: "2", provider: "x", mediaId: 117460 }) }, [])
    return <MangaReaderBar
        previousChapter={{ chapterId: "c1", chapterNumber: "1", provider: "x", mediaId: 117460 }}
        nextChapter={{ chapterId: "c3", chapterNumber: "3", provider: "x", mediaId: 117460 }}
        goToChapter={dir => w.chapterMoves.push(dir)}
        pageContainer={{ pages, mediaId: 117460, provider: "x", chapterId: "c2", pageDimensions: {}, isDownloaded: false } as any}
        entry={{ mediaId: 117460, media: { title: { userPreferred: "Overgeared" } } as any }}
    />
}
createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={new QueryClient()}>
        <div style={{ minHeight: "100vh", background: "#000" }}><Reader /></div>
    </QueryClientProvider>,
)
