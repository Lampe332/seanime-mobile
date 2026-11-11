import { getServerBaseUrl } from "@/api/client/server-url"
import type { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { usePlaybackStartManualTracking } from "@/api/hooks/playback_manager.hooks"
import { PhoneEmpty, PhoneSection } from "@/components/shared/phone-cards"
import { LoadingRows, RowGroup } from "@/components/shared/phone-kit"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { ExternalPlayerLink } from "@/lib/external-player-link/external-player-link"
import { openExternalPlayer } from "@/lib/external-player-link/open-external-player"
import { logger } from "@/lib/helpers/debug"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { useExternalPlayerLink } from "@/main/_atoms/playback.atoms"
import { __mpt_currentExternalPlayerLinkAtom } from "@/main/_features/progress-tracking/progress-tracking.atoms"
import { useServerHMACAuth } from "@/main/_hooks/use-server-status"
import { useMediastreamCurrentFile } from "@/main/mediastream/_lib/mediastream.atoms"
import { clientIdAtom } from "@/main/websocket-provider"
import { Image } from "expo-image"
import { useAtomValue, useSetAtom } from "jotai"
import Check from "lucide-react-native/icons/check"
import ExternalLink from "lucide-react-native/icons/external-link"
import Info from "lucide-react-native/icons/info"
import React from "react"
import { Pressable, View } from "react-native"
import { downloadedEpisodeGroups, encodeFilePath, episodeFacts, isWatched } from "../_lib/medialinks"

/*
 * The external player's page (web medialinks/page.tsx + medialinks-phone.tsx/.css `.pml-*`): the anime's downloaded
 * episodes as rows; a tap opens one in the external player (VLC, mpv …, the saved player link, as an Android intent
 * through openExternalPlayer) with its subtitle files, and Seanime tracks it. The anime page sends the chosen file
 * along (`useMediastreamCurrentFile`, handle-play-media.ts) and it starts once the entry has loaded.
 */

function EpisodeRow({ t, episode, watched, playing, onPlay }: { t: Translate, episode: Anime_Episode, watched: boolean, playing: boolean, onPlay: () => void }) {
    const image = episode.episodeMetadata?.image || episode.baseAnime?.coverImage?.large
    return (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: playing }} onPress={onPlay}
            className={cn("min-h-[76px] flex-row items-center gap-3.5 py-2.5 pl-2.5 pr-4", playing ? "bg-sm-accent-softer" : "bg-sm-surface-raised active:bg-sm-surface-control")}>
            <View style={{ width: 104, aspectRatio: 16 / 9 }} className="overflow-hidden rounded-lg bg-sm-surface-control">
                {!!image && <Image source={{ uri: image }} style={{ width: "100%", height: "100%" }} contentFit="cover" />}
                {watched && (
                    <View accessibilityRole="image" accessibilityLabel={t("Watched", "Gesehen")} className="absolute bottom-1 right-1 h-5 w-5 items-center justify-center rounded-full bg-[rgba(12,12,14,0.82)]">
                        <Check size={14} color={colors.smAccent} />
                    </View>
                )}
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={2} className="font-semibold">{episode.displayTitle}</Text>
                {!!episode.episodeTitle && <Text numberOfLines={1} className="text-[13px] leading-[18px]">{episode.episodeTitle}</Text>}
                <Text className={cn("text-[13px]", playing ? "font-semibold text-sm-accent" : "text-sm-text-muted")}>
                    {playing ? t("Opened in your player", "Im Player geöffnet") : episodeFacts(episode, t)}
                </Text>
            </View>
            <ExternalLink size={18} color={colors.smTextSubtle} />
        </Pressable>
    )
}

/** Opens a local file in the external player and starts the manual progress tracking (medialinks/page.tsx) */
function usePlayInExternalPlayer(entry: Anime_Entry | undefined) {
    const t = useTr()
    const clientId = useAtomValue(clientIdAtom)
    const { externalPlayerLink, encodePath } = useExternalPlayerLink()
    const { getHMACTokenQueryParam } = useServerHMACAuth()
    const { mutate: startManualTracking } = usePlaybackStartManualTracking()
    const setCurrentExternalPlayerLink = useSetAtom(__mpt_currentExternalPlayerLinkAtom)

    const subtitleUrls = async (filePath: string) => {
        try {
            const subtitlesToken = await getHMACTokenQueryParam("/api/v1/mediastream/local-subtitles", "&")
            const response = await fetch(`${getServerBaseUrl()}/api/v1/mediastream/local-subtitles?path=${encodeFilePath(filePath, encodePath)}${subtitlesToken}`,
                { headers: { Origin: getServerBaseUrl() } })
            if (!response.ok) return []
            const files = ((await response.json()) as { data?: { path: string }[] }).data ?? []
            if (!files.length) return []
            const fileToken = await getHMACTokenQueryParam("/api/v1/mediastream/file", "&")
            return files.map(file => `${getServerBaseUrl()}/api/v1/mediastream/file?path=${encodeFilePath(file.path, encodePath)}${fileToken}`)
        } catch (error) {
            logger("MEDIALINKS").warning("Failed to get local subtitle files", error)
            return []
        }
    }

    // true once a player app took the episode; a missing player (toast) neither marks the row nor starts the tracking
    return async (filePath: string): Promise<boolean> => {
        const episode = entry?.episodes?.find(ep => ep.localFile?.path === filePath)
        if (!entry || !episode) {
            toast.error(t("Episode not found.", "Folge nicht gefunden."))
            return false
        }
        if (!externalPlayerLink) {
            toast.warning(t("External player link is not set.", "Kein externer Player eingestellt."))
            return false
        }
        const link = new ExternalPlayerLink(externalPlayerLink)
        link.setEpisodeNumber(episode.progressNumber)
        link.setMediaTitle(entry.media?.title?.userPreferred)
        link.setSubtitleUrls(await subtitleUrls(filePath))
        await link.to({
            endpoint: "/api/v1/mediastream/file?path=" + encodeFilePath(filePath, encodePath),
            onTokenQueryParam: () => getHMACTokenQueryParam("/api/v1/mediastream/file", "&"),
        })
        if (!(await openExternalPlayer(link.getFullUrl()))) return false
        setCurrentExternalPlayerLink(link.getFullUrl())
        // Only main episodes move the progress
        if (episode.progressNumber && episode.type === "main") {
            startManualTracking({ mediaId: entry.mediaId, episodeNumber: episode.progressNumber, clientId: clientId || "" })
        }
        return true
    }
}

export function MedialinksPhone({ mediaId }: { mediaId: string | undefined }) {
    const t = useTr()
    const router = useRouter()
    const { data: entry, isLoading } = useGetAnimeEntry(mediaId)
    const { filePath, setFilePath } = useMediastreamCurrentFile()
    const play = usePlayInExternalPlayer(entry)
    // The episode last sent to the player, marked until another one is
    const [playingPath, setPlayingPath] = React.useState<string>()

    // A file chosen on the anime page starts once its entry is here; the path is cleared so it starts once
    React.useEffect(() => {
        if (!entry || !filePath) return
        setFilePath(undefined)
        void play(filePath)
    }, [entry, filePath, play, setFilePath])

    const groups = downloadedEpisodeGroups(entry, t)
    const progress = entry?.listData?.progress ?? 0

    return (
        <PhoneScreen title={entry?.media?.title?.userPreferred || t("External player", "Externer Player")}
            subtitle={t("A tap opens the episode in your external player", "Ein Tipp öffnet die Folge in deinem externen Player")}
            actions={entry ? <Button intent="icon" accessibilityLabel={t("The anime's page", "Seite des Anime")} onPress={() => router.push(`/entry?id=${entry.mediaId}`)}>
                <Info size={22} color={colors.smTextMuted} />
            </Button> : undefined}>
            {isLoading ? <LoadingRows label={t("Loading episodes", "Folgen werden geladen")} count={4} />
                : !groups.length ? <PhoneEmpty title={t("No downloaded episodes", "Keine heruntergeladenen Folgen")}
                        text={t("Only episodes on this device can open in an external player.", "Nur Folgen auf diesem Gerät lassen sich im externen Player öffnen.")} />
                    : groups.map(group => (
                        <PhoneSection key={group.key} title={group.title} count={group.episodes.length}>
                            <RowGroup>
                                {group.episodes.map(episode => (
                                    <EpisodeRow key={episode.localFile!.path} t={t} episode={episode} playing={episode.localFile!.path === playingPath}
                                        watched={isWatched(episode, progress)} onPlay={() => {
                                            const path = episode.localFile!.path
                                            void play(path).then(opened => { if (opened) setPlayingPath(path) })
                                        }} />
                                ))}
                            </RowGroup>
                        </PhoneSection>
                    ))}
        </PhoneScreen>
    )
}
