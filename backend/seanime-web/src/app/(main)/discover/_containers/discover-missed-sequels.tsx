import { useAnilistListMissedSequels } from "@/api/hooks/anilist.hooks"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { MediaEntryCardSkeleton } from "@/app/(main)/_features/media/_components/media-entry-card-skeleton"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { Button } from "@/components/ui/button"
import { Carousel, CarouselContent, CarouselDotButtons } from "@/components/ui/carousel"
import { useTr } from "@/lib/app-language"


/**
 * Android Home: touch Home neither auto-advances nor starts hover trailers. A section the user added
 * loads right away and stays visible while loading, empty or failed instead of silently rendering nothing.
 */
export function DiscoverMissedSequelsSection() {
    const tr = useTr()
    const { data, isLoading, isError, refetch } = useAnilistListMissedSequels(true)

    if (!isLoading && !data?.length) return (
        <PageWrapper className="space-y-2 z-[5] relative" data-discover-missed-sequels-container>
            <h2>{tr("Missed sequels", "Verpasste Fortsetzungen")}</h2>
            {isError ? <div className="home-state" role="alert">
                <p>{tr("Missed sequels could not load.", "Verpasste Fortsetzungen konnten nicht geladen werden.")}</p>
                <Button intent="gray-subtle" onClick={() => refetch()}>{tr("Try again", "Erneut versuchen")}</Button>
            </div> : <p className="home-state" role="status">{tr("No missed sequels right now.", "Gerade keine verpassten Fortsetzungen.")}</p>}
        </PageWrapper>
    )

    return (
        <PageWrapper className="space-y-2 z-[5] relative" data-discover-missed-sequels-container aria-busy={isLoading || undefined}>
            <h2>{tr("Missed sequels", "Verpasste Fortsetzungen")}</h2>
            <Carousel
                className="w-full max-w-full"
                gap="xl"
                opts={{
                    align: "start",
                    dragFree: true,
                }}
                autoScroll={false}
            >
                <CarouselDotButtons />
                <CarouselContent className="px-6">
                    {!isLoading ? data?.filter(Boolean).map(media => {
                        return (
                            <MediaEntryCard
                                key={media.id}
                                media={media}
                                showLibraryBadge
                                containerClassName="basis-[200px] md:basis-[250px] mx-2 mt-8 mb-0"
                                showTrailer={false}
                                type="anime"
                            />
                        )
                    }) : [...Array(3).keys()].map((v, idx) => <MediaEntryCardSkeleton key={idx} />)}
                </CarouselContent>
            </Carousel>
        </PageWrapper>
    )

}
