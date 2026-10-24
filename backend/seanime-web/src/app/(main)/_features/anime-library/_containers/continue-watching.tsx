import { Anime_Episode, Continuity_WatchHistory } from "@/api/generated/types"
import { getEpisodeMinutesRemaining, getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { usePlayNext } from "@/app/(main)/_atoms/playback.atoms"
import { __libraryHeaderImageAtom } from "@/app/(main)/_features/anime-library/_components/library-header"
import { EpisodeCard } from "@/app/(main)/_features/anime/_components/episode-card"
import { EpisodeTorrentAvailabilityBadge } from "@/app/(main)/_features/anime/_components/episode-torrent-availability-badge"
import { useSeaCommandInject } from "@/app/(main)/_features/sea-command/use-inject"
import { episodeCardCarouselItemClass } from "@/components/shared/classnames"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { SeaImage } from "@/components/shared/sea-image"
import { TextGenerateEffect } from "@/components/shared/text-generate-effect"
import { Carousel, CarouselContent, CarouselDotButtons, CarouselItem } from "@/components/ui/carousel"
import { useDebounce } from "@/hooks/use-debounce"
import { anilist_animeIsMovie } from "@/lib/helpers/media"
import { useRouter } from "@/lib/navigation"
import { useContinueWatchingSpoilers } from "@/lib/theme/anime-spoilers"
import { ThemeLibraryScreenBannerType, useThemeSettings } from "@/lib/theme/theme-hooks"
import { useWindowSize } from "@uidotdev/usehooks"
import { atom } from "jotai"
import { useAtom, useSetAtom } from "jotai/react"
import React from "react"
import { seaCommand_compareMediaTitles } from "../../sea-command/utils"
import { useTr } from "@/lib/app-language"
import { resumeHomeEpisode } from "../../home/home-playback"

export const __libraryHeaderEpisodeAtom = atom<Anime_Episode | null>(null)

export function ContinueWatching({ episodes, isLoading, linkTemplate, withTitle, homeMobile = false }: {
    episodes: Anime_Episode[],
    isLoading: boolean
    linkTemplate?: string
    withTitle?: boolean
    homeMobile?: boolean
}) {

    const router = useRouter()
    const tr = useTr()
    const ts = useThemeSettings()
    const spoilerActive = useContinueWatchingSpoilers(ts)

    const { data: watchHistory } = useGetContinuityWatchHistory()

    const setHeaderImage = useSetAtom(__libraryHeaderImageAtom)
    const [headerEpisode, setHeaderEpisode] = useAtom(__libraryHeaderEpisodeAtom)

    const [episodeRefs, setEpisodeRefs] = React.useState<React.RefObject<any>[]>([])
    const [inViewEpisodes, setInViewEpisodes] = React.useState<number[]>([])
    const debouncedInViewEpisodes = useDebounce(inViewEpisodes, 500)

    const { width } = useWindowSize()

    // Create refs for each episode
    React.useEffect(() => {
        if (homeMobile) return
        setEpisodeRefs(episodes.map(() => React.createRef()))
    }, [episodes, homeMobile])

    // Observe each episode
    React.useEffect(() => {
        if (homeMobile) return
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const index = episodeRefs.findIndex(ref => ref.current === entry.target)
                if (index !== -1) {
                    if (entry.isIntersecting) {
                        setInViewEpisodes(prev => prev.includes(index) ? prev : [...prev, index])
                    } else {
                        setInViewEpisodes(prev => prev.filter((idx) => idx !== index))
                    }
                }
            })
        }, { threshold: 0.5 })  // Trigger callback when 50% of the element is visible

        episodeRefs.forEach((ref) => {
            if (ref.current) {
                observer.observe(ref.current)
            }
        })

        return () => {
            episodeRefs.forEach((ref) => {
                if (ref.current) {
                    observer.unobserve(ref.current)
                }
            })
        }
    }, [episodeRefs, width, homeMobile])

    const prevSelectedEpisodeRef = React.useRef<Anime_Episode | null>(null)

    // Set header image when new episode is in view
    React.useEffect(() => {
        if (homeMobile) return
        if (debouncedInViewEpisodes.length === 0) return

        let candidateIndices = debouncedInViewEpisodes
        // Exclude previously selected episode if possible
        if (prevSelectedEpisodeRef.current && debouncedInViewEpisodes.length > 1) {
            candidateIndices = debouncedInViewEpisodes.filter(idx => episodes[idx]?.baseAnime?.id !== prevSelectedEpisodeRef.current?.baseAnime?.id)
        }
        if (candidateIndices.length === 0) candidateIndices = debouncedInViewEpisodes

        const randomCandidateIdx = candidateIndices[Math.floor(Math.random() * candidateIndices.length)]
        const selectedEpisode = episodes[randomCandidateIdx]

        if (selectedEpisode) {
            setHeaderImage({
                bannerImage: selectedEpisode.baseAnime?.bannerImage || null,
                episodeImage: selectedEpisode.baseAnime?.bannerImage || selectedEpisode.baseAnime?.coverImage?.extraLarge || null,
            })
            prevSelectedEpisodeRef.current = selectedEpisode
        }
    }, [debouncedInViewEpisodes, episodes, setHeaderImage, homeMobile])

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

    if (homeMobile) return <section data-continue-watching-container aria-label={tr("Continue watching", "Weiterschauen")}>
        <div className="home-section-heading"><h2>{tr("Continue watching", "Weiterschauen")}</h2></div>
        {episodes.length ? <div className="home-resume-row">
            {episodes.map(episode => <div className="home-resume-tile" key={`${episode.baseAnime?.id}-${episode.episodeNumber}-${episode.localFile?.path || ""}`}>
                <_EpisodeCard episode={episode} homeMobile mRef={undefined} overrideLink={linkTemplate} spoilerActive={spoilerActive} watchHistory={watchHistory} />
            </div>)}
        </div> : <p className="home-state">{tr("No episodes to continue. Choose a series from your library.", "Keine Folge zum Fortsetzen. Wähle eine Serie aus deiner Bibliothek.")}</p>}
    </section>

    if (episodes.length > 0) return (
        <PageWrapper className="space-y-3 lg:space-y-6 p-4 relative z-[4]" data-continue-watching-container>
            <h2 data-continue-watching-title>Continue watching</h2>
            {(ts.libraryScreenBannerType === ThemeLibraryScreenBannerType.Dynamic && headerEpisode?.baseAnime && withTitle) && <TextGenerateEffect
                data-continue-watching-media-title
                words={headerEpisode?.baseAnime?.title?.userPreferred || ""}
                className="w-full text-xl lg:text-[2.8rem] lg:max-w-[70%] h-[3.3rem] !mt-1 line-clamp-1 truncate leading-[3rem] text-ellipsis hidden lg:block pb-1"
            />}
            <Carousel
                className="w-full max-w-full"
                gap="md"
                opts={{
                    align: "start",
                }}
                autoScroll
                autoScrollDelay={8000}
            >
                <CarouselDotButtons />
                <CarouselContent>
                    {episodes.map((episode, idx) => (
                        <CarouselItem
                            key={episode?.localFile?.path || episode?.baseAnime?.id}
                            className={episodeCardCarouselItemClass(ts.smallerEpisodeCarouselSize)}
                        >
                            <_EpisodeCard
                                key={episode.localFile?.path || ""}
                                episode={episode}
                                mRef={episodeRefs[idx]}
                                overrideLink={linkTemplate}
                                spoilerActive={spoilerActive}
                                watchHistory={watchHistory}
                            />
                        </CarouselItem>
                    ))}
                </CarouselContent>
            </Carousel>
        </PageWrapper>
    )
    return null
}

const _EpisodeCard = React.memo(({ episode, mRef, overrideLink, spoilerActive, watchHistory, homeMobile = false }: {
    episode: Anime_Episode,
    mRef: React.RefObject<any> | undefined,
    overrideLink?: string
    spoilerActive: boolean
    watchHistory: Continuity_WatchHistory | undefined
    homeMobile?: boolean
}) => {
    const router = useRouter()
    const setHeaderImage = useSetAtom(__libraryHeaderImageAtom)
    const setHeaderEpisode = useSetAtom(__libraryHeaderEpisodeAtom)

    React.useEffect(() => {
        if (homeMobile) return
        setHeaderImage(prev => {
            if (prev?.episodeImage === null) {
                return {
                    bannerImage: episode.baseAnime?.bannerImage || null,
                    episodeImage: episode.baseAnime?.bannerImage || episode.baseAnime?.coverImage?.extraLarge || null,
                }
            }
            return prev
        })
        setHeaderEpisode(prev => {
            if (prev === null) {
                return episode
            }
            return prev
        })
    }, [])

    const { setPlayNext } = usePlayNext()

    return (
        <EpisodeCard
            key={episode.localFile?.path || ""}
            episode={episode}
            homeMobile={homeMobile}
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
            badge={<EpisodeTorrentAvailabilityBadge status={episode.torrentAvailability} />}
            length={episode.episodeMetadata?.length}
            hasDiscrepancy={episode.episodeNumber !== episode.progressNumber}
            percentageComplete={getEpisodePercentageComplete(watchHistory, episode.baseAnime?.id || 0, episode.episodeNumber)}
            minutesRemaining={getEpisodeMinutesRemaining(watchHistory, episode.baseAnime?.id || 0, episode.episodeNumber)}
            anime={{
                id: episode?.baseAnime?.id || 0,
                image: episode?.baseAnime?.coverImage?.medium,
                title: episode?.baseAnime?.title?.userPreferred,
            }}
            onMouseEnter={() => {
                if (homeMobile) return
                React.startTransition(() => {
                    setHeaderImage({
                        bannerImage: episode.baseAnime?.bannerImage || null,
                        episodeImage: episode.baseAnime?.bannerImage || episode.baseAnime?.coverImage?.extraLarge || null,
                    })
                })
            }}
            allowAnimeInfo
            mRef={mRef}
            onClick={() => {
                if (homeMobile) {
                    resumeHomeEpisode(episode, setPlayNext, url => router.push(url), overrideLink)
                    return
                }
                if (!overrideLink) {
                    setPlayNext(episode.baseAnime?.id, () => {
                        router.push(`/entry?id=${episode.baseAnime?.id}`)
                    })
                } else {
                    setPlayNext(episode.baseAnime?.id, () => {
                        router.push(overrideLink.replace("{id}", episode.baseAnime?.id ? String(episode.baseAnime.id) : ""))
                    })
                }
            }}
        />
    )
})
