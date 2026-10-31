import { useGetMangaEntry, useGetMangaEntryDetails } from "@/api/hooks/manga.hooks"
import { MediaEntryCharactersSection } from "@/app/(main)/_features/media/_components/media-entry-characters-section"
import { MediaEntryPageLoadingDisplay } from "@/app/(main)/_features/media/_components/media-entry-page-loading-display"
import { MediaEntryLoadError } from "@/app/(main)/_features/media/_components/media-entry-load-error"
import { PluginWebviewSlot } from "@/app/(main)/_features/plugin/webview/plugin-webviews"
import { MangaRecommendations } from "@/app/(main)/manga/_components/manga-recommendations"
import { MetaSection } from "@/app/(main)/manga/_components/meta-section"
import { ChapterList } from "@/app/(main)/manga/_containers/chapter-list/chapter-list"
import { useHandleMangaDownloadData } from "@/app/(main)/manga/_lib/handle-manga-downloads"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { usePathname } from "@/lib/navigation"
import { useRouter, useSearchParams } from "@/lib/navigation"
import React from "react"


export default function Page() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const mediaId = pathname.startsWith("/manga/entry") ? searchParams.get("id") : null
    const { data: mangaEntry, isLoading: mangaEntryLoading, isError: mangaEntryFailed, error: mangaEntryError, refetch: retryMangaEntry, isFetching: mangaEntryFetching } = useGetMangaEntry(mediaId)
    const { data: mangaDetails, isLoading: mangaDetailsLoading } = useGetMangaEntryDetails(mediaId)

    /**
     * Fetch manga download data
     */
    const { downloadData, downloadDataLoading } = useHandleMangaDownloadData(mediaId)

    React.useEffect(() => {
        if (!pathname.startsWith("/manga/entry")) return
        if (!mediaId) {
            router.push("/")
        } else if (!mangaEntryLoading && !mangaEntry && !mangaEntryFailed) {
            router.push("/")
        }
    }, [mangaEntry, pathname, mangaEntryLoading, mangaEntryFailed])

    React.useEffect(() => {
        try {
            if (mangaEntry?.media?.title?.userPreferred) {
                document.title = `${mangaEntry?.media?.title?.userPreferred} | Seanime`
            }
        }
        catch {
        }
    }, [mangaEntry])

    if (!mangaEntry && mangaEntryFailed) return <MediaEntryLoadError error={mangaEntryError} onRetry={() => retryMangaEntry()} retrying={mangaEntryFetching} />
    if (!mangaEntry || mangaEntryLoading) return <MediaEntryPageLoadingDisplay />

    return (
        <div
            data-manga-entry-page
            data-mobile-anime
            data-mobile-manga
            data-media={JSON.stringify(mangaEntry.media)}
            data-manga-entry-list-data={JSON.stringify(mangaEntry.listData)}
        >
            <MetaSection entry={mangaEntry} details={mangaDetails} detailsLoading={mangaDetailsLoading} />

            <div data-manga-entry-page-content-container id="manga-chapters" className="px-4 md:px-8 relative z-[8]">

                <PageWrapper
                    data-manga-entry-page-content
                    key="chapter-list"
                    className="relative 2xl:order-first pb-10 pt-4 space-y-10"
                    {...{
                        initial: { opacity: 0, y: 15 },
                        animate: { opacity: 1, y: 0 },
                        exit: { opacity: 0, y: 15 },
                        transition: {
                            type: "spring",
                            damping: 24,
                            stiffness: 180,
                        },
                    }}
                >

                    <div
                        data-manga-entry-page-grid
                        className="grid gap-8 xl:grid-cols-[1fr,480px] 2xl:grid-cols-[1fr,650px]"
                    >
                        <div className="min-w-0 space-y-2">
                            <ChapterList
                                entry={mangaEntry}
                                mediaId={mediaId}
                                details={mangaDetails}
                                downloadData={downloadData}
                                downloadDataLoading={downloadDataLoading}
                            />
                        </div>

                        <div data-manga-entry-page-characters-section-container className="min-w-0 pt-12">
                            <MediaEntryCharactersSection details={mangaDetails} isMangaPage loading={mangaDetailsLoading} />
                        </div>
                    </div>

                    <PluginWebviewSlot slot="after-manga-entry-chapter-list" />

                    <MangaRecommendations entry={mangaEntry} details={mangaDetails} loading={mangaDetailsLoading} />

                    <PluginWebviewSlot slot="manga-entry-screen-bottom" />

                </PageWrapper>
            </div>
        </div>
    )
}
