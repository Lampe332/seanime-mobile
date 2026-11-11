import type { Anime_Entry, Anime_Episode, Anime_EpisodeCollection } from "@/api/generated/types"
import { getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { EpisodeInfoDialog, EpisodeRow, IconAction, PluginEpisodeMenu, UpNextRow } from "@/main/entry/_containers/episode-list/episode-section"
import { usePlayNextVideoOnMount } from "@/main/entry/_lib/handle-play-on-mount"
import Info from "lucide-react-native/icons/info"
import React from "react"
import { Pressable, View } from "react-native"

const PAGE = 24
const PAGINATE_FROM = 29

/**
 * The episodes of the torrent and debrid sources (torrent-stream-episode-section.tsx): the next 30 to watch as cards
 * (all of them backwards once the anime is done), then every episode as a row, 24 to a page from 29 on, opening on the page
 * of the next episode. A tap on a card or row is the page's `onEpisodeClick`; without it they cannot be tapped.
 */
export function TorrentStreamEpisodeSection({ entry, episodeCollection, onEpisodeClick, onPlayNextEpisodeOnMount, bottomSection, pluginType }: {
    entry: Anime_Entry
    episodeCollection: Anime_EpisodeCollection | undefined
    onEpisodeClick?: (episode: Anime_Episode) => void
    onPlayNextEpisodeOnMount: (episode: Anime_Episode) => void
    bottomSection?: React.ReactNode
    /** which plugin episode items this list shows (web contextType) */
    pluginType: "torrentstream" | "debridstream"
}) {
    const t = useTr()
    const { data: watchHistory } = useGetContinuityWatchHistory()
    const progress = entry.listData?.progress
    const episodes = episodeCollection?.episodes

    const all = episodes ? [...episodes] : []
    const episodesToWatch = ((!!progress && !!entry.media?.episodes && progress === entry.media.episodes) ? all.reverse() : all.slice(progress || 0)).slice(0, 30)

    usePlayNextVideoOnMount({
        mediaId: entry.mediaId,
        onPlay: () => onPlayNextEpisodeOnMount(episodesToWatch[0]),
    }, !!episodesToWatch[0] && !!onEpisodeClick)

    const count = episodes?.length ?? 0
    const paginate = count >= PAGINATE_FROM
    const pages = paginate ? Math.ceil(count / PAGE) : 1
    // The page holding the next episode, as long as the anime and the progress stay the same
    const startPage = paginate && progress ? Math.min(Math.max(1, Math.ceil((progress + 1) / PAGE)), pages) : 1
    const [page, setPage] = React.useState(startPage)
    const [pageFor, setPageFor] = React.useState(startPage)
    if (pageFor !== startPage) {
        setPageFor(startPage)
        setPage(startPage)
    }
    const shown = paginate ? (episodes ?? []).slice((page - 1) * PAGE, page * PAGE) : episodes ?? []
    const [info, setInfo] = React.useState<Anime_Episode | null>(null)

    if (!episodeCollection || !entry.media) return null
    const media = entry.media

    return <View className="gap-6">
        {episodesToWatch.length > 0 && <UpNextRow episodes={episodesToWatch} entry={entry} watchHistory={watchHistory} onPlay={onEpisodeClick} />}

        <View>
            {shown.map(episode => <EpisodeRow key={episode.episodeNumber + (episode.displayTitle || "")} mobileEntry media={media}
                image={episode.episodeMetadata?.image || episode.baseAnime?.coverImage?.large} title={episode.displayTitle || episode.baseAnime?.title?.userPreferred || ""}
                episodeTitle={episode.episodeTitle} isFiller={episode.episodeMetadata?.isFiller} length={episode.episodeMetadata?.length}
                isWatched={!!progress && progress >= (episode.progressNumber || 0)} episodeNumber={episode.episodeNumber} watchedProgress={progress}
                percentageComplete={getEpisodePercentageComplete(watchHistory, entry.mediaId, episode.episodeNumber)}
                onPress={onEpisodeClick ? () => onEpisodeClick(episode) : undefined}
                action={<>
                    <IconAction icon={Info} label={t("Episode info", "Infos zur Folge")} onPress={() => setInfo(episode)} />
                    <PluginEpisodeMenu type={pluginType} episode={episode} title={episode.displayTitle || episode.baseAnime?.title?.userPreferred || ""} />
                </>} />)}
            {pages > 1 && <View className="mt-6 flex-row flex-wrap justify-center gap-1">
                {Array.from({ length: pages }, (_, i) => i + 1).map(n => <Pressable key={n} accessibilityRole="button" accessibilityState={{ selected: n === page }}
                    onPress={() => setPage(n)} className={cn("h-11 min-w-11 items-center justify-center rounded-full px-3", n === page ? "bg-sm-surface-control" : "active:bg-sm-surface-raised")}>
                    <Text className={n === page ? "font-semibold" : "text-sm-text-muted"}>{n}</Text>
                </Pressable>)}
            </View>}
        </View>

        {bottomSection}
        {!!info && <EpisodeInfoDialog episode={info} onClose={() => setInfo(null)} />}
    </View>
}
