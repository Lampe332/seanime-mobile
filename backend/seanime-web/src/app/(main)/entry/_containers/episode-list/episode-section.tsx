import { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { getEpisodeMinutesRemaining, getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { EpisodeCard } from "@/app/(main)/_features/anime/_components/episode-card"

import { useSeaCommandInject } from "@/app/(main)/_features/sea-command/use-inject"
import { EpisodeListGrid, EpisodeListPaginatedGrid } from "@/app/(main)/entry/_components/episode-list-grid"
import { useAnimeEntryPageView } from "@/app/(main)/entry/_containers/anime-entry-page"
import { EpisodeItem } from "@/app/(main)/entry/_containers/episode-list/episode-item"
import { UndownloadedEpisodeList } from "@/app/(main)/entry/_containers/episode-list/undownloaded-episode-list"
import { PhoneDownloadedEpisodes, usePhoneDownloadedEpisodes } from "@/app/(main)/entry/_containers/episode-list/phone-downloaded-episodes"
import { useHandleEpisodeSection } from "@/app/(main)/entry/_lib/handle-episode-section"
import { useHandlePlayMedia } from "@/app/(main)/entry/_lib/handle-play-media"
import { episodeCardCarouselItemClass } from "@/components/shared/classnames"
import { Alert } from "@/components/ui/alert"
import { AppLayoutStack } from "@/components/ui/app-layout"
import { Carousel, CarouselContent, CarouselDotButtons, CarouselItem } from "@/components/ui/carousel"
import { tr, useTr } from "@/lib/app-language"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import React from "react"
import { IoLibrarySharp } from "react-icons/io5"

const MAX_COL = 4

export function EpisodeSection({ entry, bottomSection }: { entry: Anime_Entry, bottomSection: React.ReactNode }) {
    const t = useTr()
    const ts = useThemeSettings()
    const { currentView } = useAnimeEntryPageView()

    const {
        media,
        hasInvalidEpisodes,
        episodesToWatch,
        mainEpisodes,
        specialEpisodes,
        ncEpisodes,
    } = useHandleEpisodeSection({ entry })

    const { playMediaFile } = useHandlePlayMedia()

    const { data: watchHistory } = useGetContinuityWatchHistory()

    const { inject, remove } = useSeaCommandInject()

    // Android: episodes saved with the phone's download manager count as available here.
    const phoneDownloads = usePhoneDownloadedEpisodes(entry.mediaId)
    const phoneDownloadedNumbers = React.useMemo(() => new Set(phoneDownloads.map(episode => Number(episode.episode))), [phoneDownloads])

    React.useEffect(() => {
        if (!media) return

        const allEpisodes = [
            { ...episodesToWatch?.[0], type: "next" as const },
            ...mainEpisodes.map(ep => ({ ...ep, type: "main" as const })),
            ...specialEpisodes.map(ep => ({ ...ep, type: "special" as const })),
            ...ncEpisodes.map(ep => ({ ...ep, type: "other" as const })),
        ]

        inject("library-episodes", {
            items: allEpisodes.filter(n => !!n.episodeTitle).map(episode => ({
                data: episode,
                id: `${episode.type}-${episode.localFile?.path || ""}-${episode.episodeNumber}`,
                value: `${episode.episodeNumber}`,
                heading: episode.type === "next" ? tr("Next Episode", "Nächste Episode") :
                    episode.type === "special" ? tr("Specials", "Specials") :
                        episode.type === "other" ? tr("Others", "Sonstiges") : tr("Episodes", "Episoden"),
                priority: episode.type === "next" ? 2 :
                    episode.type === "main" ? 1 : 0,
                render: () => (
                    <div className="flex gap-1 items-center w-full">
                        <p className="max-w-[70%] truncate">{episode.displayTitle}</p>
                        {!!episode.episodeTitle && (
                            <p className="text-[--muted] flex-1 truncate">- {episode.episodeTitle}</p>
                        )}
                    </div>
                ),
                onSelect: () => playMediaFile({
                    path: episode.localFile?.path ?? "",
                    mediaId: entry.mediaId,
                    episode: episode as Anime_Episode,
                }),
            })),
            filter: ({ item, input }) => {
                if (!input) return true
                return item.value.toLowerCase().includes(input.toLowerCase())
            },
            shouldShow: () => currentView === "library",
            priority: 1,
        })

        return () => remove("library-episodes")
    }, [media, episodesToWatch, mainEpisodes, specialEpisodes, ncEpisodes, currentView])

    if (!media) return null

    if ((!entry.listData && !entry._isNakamaEntry) || !entry.libraryData) {
        return <div className="space-y-10">
            <PhoneDownloadedEpisodes episodes={phoneDownloads} />
            {media?.status !== "NOT_YET_RELEASED"
                ? <h4 className="text-yellow-50 flex items-center gap-2"><IoLibrarySharp /> {entry._isNakamaEntry
                    ? t("Not in the Nakama's library", "Nicht in der Nakama-Bibliothek")
                    : t("Not in your library", "Nicht in deiner Bibliothek")}</h4>
                : <h5 className="text-yellow-50">{t("Not yet released", "Noch nicht erschienen")}</h5>}
            <div className="overflow-y-auto pt-4 space-y-10 overflow-x-hidden">
                {!entry._isNakamaEntry && <UndownloadedEpisodeList
                    downloadInfo={entry.downloadInfo}
                    excludeEpisodes={phoneDownloadedNumbers}
                    media={media}
                    watchedProgress={entry.listData?.progress}
                    maxCol={MAX_COL}
                />}
                {bottomSection}
            </div>
        </div>
    }

    return (
        <>
            <AppLayoutStack spacing="lg" data-episode-section-stack>
                <PhoneDownloadedEpisodes episodes={phoneDownloads} />

                {hasInvalidEpisodes && <Alert
                    intent="alert"
                    description={t("Some episodes are invalid. Update the metadata to fix this.", "Einige Episoden sind ungültig. Aktualisiere die Metadaten, um das zu beheben.")}
                />}

                {episodesToWatch.length > 0 && (
                    <>
                        <Carousel
                            className="w-full max-w-full"
                            gap="md"
                            opts={{
                                align: "start",
                            }}
                            data-episode-carousel
                        >
                            <CarouselDotButtons />
                            <CarouselContent>
                                {episodesToWatch.map((episode, idx) => (
                                    <CarouselItem
                                        key={episode?.localFile?.path || idx}
                                        className={episodeCardCarouselItemClass(ts.smallerEpisodeCarouselSize)}
                                    >
                                        <EpisodeCard
                                            key={episode.localFile?.path || ""}
                                            contextType="library"
                                            episode={episode}
                                            image={episode.episodeMetadata?.image || episode.baseAnime?.bannerImage || episode.baseAnime?.coverImage?.extraLarge}
                                            topTitle={episode.episodeTitle || episode?.baseAnime?.title?.userPreferred}
                                            title={episode.displayTitle}
                                            isInvalid={episode.isInvalid}
                                            progressTotal={episode.baseAnime?.episodes}
                                            watchedProgress={entry.listData?.progress}
                                            progressNumber={episode.progressNumber}
                                            episodeNumber={episode.episodeNumber}
                                            length={episode.episodeMetadata?.length}
                                            percentageComplete={getEpisodePercentageComplete(watchHistory, entry.mediaId, episode.episodeNumber)}
                                            minutesRemaining={getEpisodeMinutesRemaining(watchHistory, entry.mediaId, episode.episodeNumber)}
                                            fallbackImage={[episode.baseAnime?.bannerImage, episode.baseAnime?.coverImage?.large,
                                                episode.baseAnime?.coverImage?.extraLarge]}
                                            onClick={() => playMediaFile({
                                                path: episode.localFile?.path ?? "",
                                                mediaId: entry.mediaId,
                                                episode: episode,
                                            })}
                                            anime={{
                                                id: entry.mediaId,
                                                image: episode.baseAnime?.coverImage?.medium,
                                                title: episode?.baseAnime?.title?.userPreferred,
                                            }}
                                        />
                                    </CarouselItem>
                                ))}
                            </CarouselContent>
                        </Carousel>
                    </>
                )}


                <div className="space-y-10" data-episode-list-stack>
                    <EpisodeListPaginatedGrid
                        maxCol={MAX_COL}
                        length={mainEpisodes.length}
                        renderItem={(index) => (
                            <EpisodeItem
                                mobileEntry
                                key={mainEpisodes[index].localFile?.path || ""}
                                episode={mainEpisodes[index]}
                                media={media}
                                isWatched={!!entry.listData?.progress && entry.listData.progress >= mainEpisodes[index].progressNumber}
                                watchedProgress={entry.listData?.progress}
                                onPlay={({ path, mediaId }) => playMediaFile({ path, mediaId, episode: mainEpisodes[index] })}
                                percentageComplete={getEpisodePercentageComplete(watchHistory, entry.mediaId, mainEpisodes[index].episodeNumber)}
                                minutesRemaining={getEpisodeMinutesRemaining(watchHistory, entry.mediaId, mainEpisodes[index].episodeNumber)}
                            />
                        )}
                    />

                    {!entry._isNakamaEntry && <UndownloadedEpisodeList
                        downloadInfo={entry.downloadInfo}
                        excludeEpisodes={phoneDownloadedNumbers}
                        media={media}
                        watchedProgress={entry.listData?.progress}
                        maxCol={MAX_COL}
                    />}

                    {specialEpisodes.length > 0 && <>
                        <h2>{t("Specials", "Specials")}</h2>
                        <EpisodeListGrid data-episode-list-specials maxCol={MAX_COL}>
                            {specialEpisodes.map(episode => (
                                <EpisodeItem
                                    key={episode.localFile?.path || ""}
                                    episode={episode}
                                    media={media}
                                    watchedProgress={entry.listData?.progress}
                                    onPlay={({ path, mediaId }) => playMediaFile({ path, mediaId, episode: episode })}
                                />
                            ))}
                        </EpisodeListGrid>
                    </>}

                    {ncEpisodes.length > 0 && <>
                        <h2>{t("Others", "Sonstiges")}</h2>
                        <EpisodeListGrid data-episode-list-others maxCol={MAX_COL}>
                            {ncEpisodes.map(episode => (
                                <EpisodeItem
                                    key={episode.localFile?.path || ""}
                                    episode={episode}
                                    media={media}
                                    watchedProgress={entry.listData?.progress}
                                    onPlay={({ path, mediaId }) => playMediaFile({ path, mediaId, episode: episode })}
                                />
                            ))}
                        </EpisodeListGrid>
                    </>}

                    {bottomSection}

                </div>
            </AppLayoutStack>
        </>
    )

}
