import { HibikeManga_ChapterDetails, Manga_MediaDownloadData } from "@/api/generated/types"
import { useServerHMACAuth, useServerStatus } from "@/main/_hooks/use-server-status"
import React from "react"

export function getChapterNumberFromChapter(chapter: string): number {
    const chapterNumber = chapter.match(/(\d+(\.\d+)?)/)?.[0]
    return chapterNumber ? Math.floor(parseFloat(chapterNumber)) : 0
}

export function getDecimalFromChapter(chapter: string): number {
    const chapterNumber = chapter.match(/(\d+(\.\d+)?)/)?.[0]
    return chapterNumber ? parseFloat(chapterNumber) : 0
}

export function isChapterBefore(a: string, b: string): boolean {
    // compare the decimal part of the chapter number
    return getDecimalFromChapter(a) < getDecimalFromChapter(b)
}

export function isChapterAfter(a: string, b: string): boolean {
    // compare the decimal part of the chapter number
    return getDecimalFromChapter(a) > getDecimalFromChapter(b)
}

export function useMangaReaderUtils() {
    const serverStatus = useServerStatus()
    // only for isReady below: a status kept from the old server may still say it had a password
    const { getHMACTokenQueryParam, password } = useServerHMACAuth()
    const [tokenQueryParam, setTokenQueryParam] = React.useState<string>("")

    React.useLayoutEffect(() => {
        (async () => {
            setTokenQueryParam(await getHMACTokenQueryParam("/api/v1/image-proxy", "&"))
        })()
    }, [password])

    const getChapterPageUrl = React.useCallback((url: string, isDownloaded: boolean | undefined) => {
        // the server's local manga pages are not there, the app runs without it (§4s)
        if (url.startsWith("{{manga-local-assets}}")) return ""
        // straight from the source, the headers go with the picture (getChapterPageHeaders)
        if (!isDownloaded) return url
        // a chapter the core saved: its file on the device; the server's downloads folder is not there
        return url.startsWith("file://") ? url : ""
    }, [])

    /** The headers a page needs when it loads straight from the source (area manga on, §4n); otherwise none */
    const getChapterPageHeaders = React.useCallback((url: string, isDownloaded: boolean | undefined, headers?: Record<string, string>) => {
        if (isDownloaded || url.startsWith("{{manga-local-assets}}") || !headers || Object.keys(headers).length === 0) return undefined
        return headers
    }, [])

    return {
        isReady: (!serverStatus?.serverHasPassword) || (!!password && !!tokenQueryParam),
        getChapterPageUrl,
        getChapterPageHeaders,
    }

}

export function useMangaDownloadDataUtils(data: Manga_MediaDownloadData | undefined, loading: boolean) {

    const isChapterLocal = React.useCallback((chapter: HibikeManga_ChapterDetails | undefined) => {
        if (!chapter) return false
        return chapter.provider === "local-manga"
    }, [])

    const isChapterDownloaded = React.useCallback((chapter: HibikeManga_ChapterDetails | undefined) => {
        if (!data || !chapter) return false
        return (data?.downloaded[chapter.provider]?.findIndex(n => n.chapterId === chapter.id) ?? -1) !== -1
    }, [data])

    const isChapterQueued = React.useCallback((chapter: HibikeManga_ChapterDetails | undefined) => {
        if (!data || !chapter) return false
        return (data?.queued[chapter.provider]?.findIndex(n => n.chapterId === chapter.id) ?? -1) !== -1
    }, [data])

    const getProviderNumberOfDownloadedChapters = React.useCallback((provider: string) => {
        if (!data) return 0
        return Object.keys(data.downloaded[provider] || {}).length
    }, [data])
    return {
        isChapterDownloaded,
        isChapterQueued,
        getProviderNumberOfDownloadedChapters,
        showActionButtons: !loading,
        isChapterLocal,
    }

}
