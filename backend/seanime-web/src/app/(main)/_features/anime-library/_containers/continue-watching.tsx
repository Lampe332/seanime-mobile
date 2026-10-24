import { Anime_Episode, Continuity_WatchHistory } from "@/api/generated/types"
import { getEpisodeMinutesRemaining, getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { usePlayNext } from "@/app/(main)/_atoms/playback.atoms"
import { EpisodeCard } from "@/app/(main)/_features/anime/_components/episode-card"
import { useSeaCommandInject } from "@/app/(main)/_features/sea-command/use-inject"
import { SeaImage } from "@/components/shared/sea-image"
import { anilist_animeIsMovie } from "@/lib/helpers/media"
import { useRouter } from "@/lib/navigation"
import { useContinueWatchingSpoilers } from "@/lib/theme/anime-spoilers"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import React from "react"
import { seaCommand_compareMediaTitles } from "../../sea-command/utils"
import { useTr } from "@/lib/app-language"
import { resumeHomeEpisode } from "../../home/home-playback"

/** Android Home: the resume row. */
export function ContinueWatching({ episodes, isLoading, linkTemplate }: {
    episodes: Anime_Episode[],
    isLoading: boolean
    linkTemplate?: string
}) {

    const router = useRouter()
    const tr = useTr()
    const ts = useThemeSettings()
    const spoilerActive = useContinueWatchingSpoilers(ts)

    const { data: watchHistory } = useGetContinuityWatchHistory()

    const { setPlayNext } = usePlayNext()

    const { inject, remove } = useSeaCommandInject()

    React.useEffect(() => {
        inject("continue-watching", {
            items: episodes.map(episode => ({
                data: episode,
                id: `${episode.localFile?.path || episode.baseAnime?.title?.userPreferred || ""}-${episode.episodeNumber || 1}`,
                value: `${episode.episodeNumber || 1}`,
                heading: "Continue Watching",
                priority: 100,
                render: () => (
                    <>
                        <div className="w-12 aspect-[6/5] flex-none rounded-[--radius-md] relative overflow-hidden">
                            <SeaImage
                                src={episode.episodeMetadata?.image || ""}
                                alt="episode image"
                                fill
                                className="object-center object-cover"
                            />
                        </div>
                        <div className="flex gap-1 items-center w-full">
                            <p className="max-w-[70%] truncate">{episode.baseAnime?.title?.userPreferred || ""}</p>&nbsp;-&nbsp;
                            {!anilist_animeIsMovie(episode.baseAnime) ? <>
                                <p className="text-[--muted]">Ep</p><span>{episode.episodeNumber}</span>
                            </> : <>
                                <p className="text-[--muted]">Movie</p>
                            </>}

                        </div>
                    </>
                ),
                onSelect: () => setPlayNext(episode.baseAnime?.id, () => {
                    router.push(`/entry?id=${episode.baseAnime?.id}`)
                }),
            })),
            filter: ({ item, input }) => {
                if (!input) return true
                return item.value.toLowerCase().includes(input.toLowerCase()) ||
                    seaCommand_compareMediaTitles(item.data.baseAnime?.title, input)
            },
            priority: 100,
        })

        return () => remove("continue-watching")
    }, [episodes, inject, remove, router, setPlayNext])

    return <section data-continue-watching-container aria-label={tr("Continue watching", "Weiterschauen")}>
        <div className="home-section-heading"><h2>{tr("Continue watching", "Weiterschauen")}</h2></div>
        {episodes.length ? <div className="home-resume-row">
            {episodes.map(episode => <div className="home-resume-tile" key={`${episode.baseAnime?.id}-${episode.episodeNumber}-${episode.localFile?.path || ""}`}>
                <_EpisodeCard episode={episode} overrideLink={linkTemplate} spoilerActive={spoilerActive} watchHistory={watchHistory} />
            </div>)}
        </div> : <p className="home-state">{tr("No episodes to continue. Choose a series from your library.", "Keine Folge zum Fortsetzen. Wähle eine Serie aus deiner Bibliothek.")}</p>}
    </section>
}

const _EpisodeCard = React.memo(({ episode, overrideLink, spoilerActive, watchHistory }: {
    episode: Anime_Episode,
    overrideLink?: string
    spoilerActive: boolean
    watchHistory: Continuity_WatchHistory | undefined
}) => {
    const router = useRouter()

    const { setPlayNext } = usePlayNext()

    return (
        <EpisodeCard
            key={episode.localFile?.path || ""}
            episode={episode}
            homeMobile
            image={episode.episodeMetadata?.image || episode.baseAnime?.bannerImage || episode.baseAnime?.coverImage?.extraLarge}
            topTitle={episode.episodeTitle || episode?.baseAnime?.title?.userPreferred}
            spoilerSafeTopTitle={episode?.baseAnime?.title?.userPreferred}
            disableAnimation={true}
            spoilerMode="replace"
            spoilerActive={spoilerActive}
            title={episode.displayTitle}
            isInvalid={episode.isInvalid}
            progressTotal={episode.baseAnime?.episodes}
            progressNumber={episode.progressNumber}
            episodeNumber={episode.episodeNumber}
            length={episode.episodeMetadata?.length}
            hasDiscrepancy={episode.episodeNumber !== episode.progressNumber}
            percentageComplete={getEpisodePercentageComplete(watchHistory, episode.baseAnime?.id || 0, episode.episodeNumber)}
            minutesRemaining={getEpisodeMinutesRemaining(watchHistory, episode.baseAnime?.id || 0, episode.episodeNumber)}
            anime={{
                id: episode?.baseAnime?.id || 0,
                image: episode?.baseAnime?.coverImage?.medium,
                title: episode?.baseAnime?.title?.userPreferred,
            }}
            allowAnimeInfo
            onClick={() => resumeHomeEpisode(episode, setPlayNext, url => router.push(url), overrideLink)}
        />
    )
})
