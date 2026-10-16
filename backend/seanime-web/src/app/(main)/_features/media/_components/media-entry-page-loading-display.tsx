import { TRANSPARENT_SIDEBAR_BANNER_IMG_STYLE } from "@/app/(main)/_features/custom-ui/styles"
import { cn } from "@/components/ui/core/styling"
import { Skeleton } from "@/components/ui/skeleton"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import React from "react"

export function MediaEntryPageLoadingDisplay() {
    const ts = useThemeSettings()
    const showBannerSkeleton = !ts.libraryScreenCustomBackgroundImage

    return (
        <div data-media-entry-page-loading-display className="relative min-h-[31rem] overflow-hidden">
            {showBannerSkeleton && (
                <div className="__header h-[30rem] fixed left-0 top-0 w-full">
                    <div
                        className={cn(
                            "h-[30rem] w-full flex-none object-cover object-center absolute top-0 overflow-hidden",
                            !ts.disableSidebarTransparency && TRANSPARENT_SIDEBAR_BANNER_IMG_STYLE,
                        )}
                    >
                        <div className="w-full absolute z-[1] top-0 h-[12rem] bg-gradient-to-b from-[--background] to-transparent via" />
                        <Skeleton className="h-full absolute w-full rounded-none opacity-70" />
                        <div className="w-full absolute bottom-0 h-[22rem] bg-gradient-to-t from-[--background] via-[--background]/80 via-30% to-transparent" />
                    </div>
                </div>
            )}

            <div className="relative z-[5] space-y-8 px-6 sm:px-8 pt-6">
                <div className="flex flex-col lg:flex-row gap-8">
                    <Skeleton className="mx-auto lg:m-0 aspect-[6/8] h-auto w-full max-w-[150px] sm:max-w-[200px] lg:max-w-[230px] rounded-[--radius-md]" />

                    <div className="flex-1 space-y-3 pt-1">
                        <div className="space-y-2">
                            <Skeleton className="mx-auto lg:mx-0 h-9 w-2/3 max-w-[36rem] rounded-xl" />
                            <Skeleton className="mx-auto lg:mx-0 h-5 w-1/2 max-w-[24rem] rounded-xl opacity-60" />
                        </div>

                        <div className="flex gap-3 justify-center lg:justify-start">
                            <Skeleton className="h-6 w-28 rounded-xl" />
                            <Skeleton className="h-6 w-20 rounded-xl opacity-70" />
                        </div>

                        <div className="flex gap-3 justify-center lg:justify-start">
                            <Skeleton className="h-7 w-14 rounded-xl" />
                            <Skeleton className="h-7 w-10 rounded-xl opacity-70" />
                        </div>

                    </div>
                </div>

                {/* action buttons row: icon buttons + text buttons */}
                <div className="flex gap-3 items-center flex-wrap justify-center lg:justify-start">
                    <Skeleton className="h-8 w-8 rounded-xl" />
                    <Skeleton className="h-7 w-16 rounded-xl opacity-80" />
                    <Skeleton className="h-8 w-8 rounded-xl opacity-70" />
                    <Skeleton className="h-8 w-8 rounded-xl opacity-70" />
                    {/* <Skeleton className="h-8 w-8 rounded-xl opacity-60" />
                     <Skeleton className="h-8 w-8 rounded-xl opacity-60" /> */}
                </div>

                {/* tabs: Library / Torrent / Debrid / Online */}
                <div className="flex gap-2 justify-center lg:justify-start">
                    <Skeleton className="h-9 w-28 rounded-xl" />
                    <Skeleton className="h-9 w-36 rounded-xl opacity-70" />
                    <Skeleton className="h-9 w-32 rounded-xl opacity-60" />
                </div>
            </div>
        </div>
    )
}

type MediaEntryDetailsSkeletonProps = {
    isMangaPage?: boolean
    showCharacters?: boolean
    showCards?: boolean
    className?: string
}

export function MediaEntryDetailsSkeleton(props: MediaEntryDetailsSkeletonProps) {
    const { isMangaPage, showCharacters = true, showCards = true, className } = props
    const rowCount = isMangaPage ? 4 : 5
    const cardCount = isMangaPage ? 4 : 5

    return (
        <div data-media-entry-details-skeleton className={cn("space-y-8", className)}>
            {showCharacters && <div className="space-y-4">
                <Skeleton className="h-8 w-40 rounded-xl" />
                <div
                    className={cn(
                        "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4",
                        isMangaPage && "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-2",
                    )}
                >
                    {Array.from({ length: rowCount }).map((_, index) => (
                        <div key={index} className="flex gap-4 py-3 pr-12">
                            <Skeleton className="size-20 flex-none rounded-[--radius-md]" />
                            <div className="flex-1 space-y-2 pt-1">
                                <Skeleton className="h-5 w-3/4 rounded-xl" />
                                <Skeleton className="h-4 w-1/2 rounded-xl opacity-70" />
                                <Skeleton className="h-3 w-1/3 rounded-xl opacity-60" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>}

            {showCards && <div className="space-y-4">
                <Skeleton className="h-8 w-52 rounded-xl" />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4">
                    {Array.from({ length: cardCount }).map((_, index) => (
                        <Skeleton key={index} className="aspect-[7/10] h-auto rounded-[--radius-md]" />
                    ))}
                </div>
            </div>}
        </div>
    )
}
