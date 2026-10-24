import { getServerBaseUrl } from "@/api/client/server-url"
import { useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { usePlaybackStartManualTracking } from "@/api/hooks/playback_manager.hooks"
import { useExternalPlayerLink } from "@/app/(main)/_atoms/playback.atoms"
import { __mpt_currentExternalPlayerLinkAtom } from "@/app/(main)/_features/progress-tracking/manual-progress-tracking"
import { MedialinksPhone } from "@/app/(main)/medialinks/_screens/medialinks-phone"
import { useMediastreamCurrentFile } from "@/app/(main)/mediastream/_lib/mediastream.atoms"
import { clientIdAtom } from "@/app/websocket-provider"
import { ExternalPlayerLink } from "@/lib/external-player-link/external-player-link"
import { openTab } from "@/lib/helpers/browser"
import { logger } from "@/lib/helpers/debug"
import { useSearchParams } from "@/lib/navigation"
import { useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { toast } from "sonner"
import { useServerHMACAuth } from "../_hooks/use-server-status"

type LocalSubtitleFile = {
    path: string
}

export default function Page() {

    const clientId = useAtomValue(clientIdAtom)
    const searchParams = useSearchParams()
    const mediaId = searchParams.get("id")
    const { data: animeEntry, isLoading: animeEntryLoading } = useGetAnimeEntry(mediaId)
    const { filePath, setFilePath } = useMediastreamCurrentFile()
    const { getHMACTokenQueryParam } = useServerHMACAuth()

    const { mutate: startManualTracking, isPending: isStarting } = usePlaybackStartManualTracking()
    const setCurrentExternalPlayerLink = useSetAtom(__mpt_currentExternalPlayerLinkAtom)

    const { externalPlayerLink, encodePath } = useExternalPlayerLink()

    function encodeFilePath(filePath: string) {
        if (encodePath) {
            return Buffer.from(filePath).toString("base64")
        }
        return encodeURIComponent(filePath)
    }

    async function getLocalSubtitleUrls(filePath: string) {
        try {
            const subtitlesToken = await getHMACTokenQueryParam("/api/v1/mediastream/local-subtitles", "&")
            const subtitleFilesResponse = await fetch(`${getServerBaseUrl()}/api/v1/mediastream/local-subtitles?path=${encodeFilePath(filePath)}${subtitlesToken}`,
                {
                    credentials: "include",
                })
            if (!subtitleFilesResponse.ok) return []

            const subtitleFilesPayload = await subtitleFilesResponse.json() as { data?: LocalSubtitleFile[] }
            const subtitleFiles = subtitleFilesPayload.data ?? []
            if (!subtitleFiles.length) return []

            const fileToken = await getHMACTokenQueryParam("/api/v1/mediastream/file", "&")
            return subtitleFiles.map(file => `${getServerBaseUrl()}/api/v1/mediastream/file?path=${encodeFilePath(file.path)}${fileToken}`)
        }
        catch (error) {
            logger("MEDIALINKS").warning("Failed to get local subtitle files", error)
            return []
        }
    }

    React.useEffect(() => {
        // On mount, when the anime entry is loaded, and the file path is set, play the media file
        if (animeEntry && filePath) {
            const handleMediaPlay = async () => {
                const episode = animeEntry?.episodes?.find(ep => ep.localFile?.path === filePath)
                logger("MEDIALINKS").info("Filepath", filePath, "Episode", episode)

                if (!episode) {
                    logger("MEDIALINKS").error("Episode not found.")
                    toast.error("Episode not found.")
                    return
                }

                if (episode.type !== "main") {
                    logger("MEDIALINKS").warning("Episode is not a main episode. Cannot track progress.")
                }

                if (!externalPlayerLink) {
                    logger("MEDIALINKS").error("External player link is not set.")
                    toast.warning("External player link is not set.")
                    return
                }

                const link = new ExternalPlayerLink(externalPlayerLink)
                link.setEpisodeNumber(episode.progressNumber)
                link.setMediaTitle(animeEntry.media?.title?.userPreferred)
                link.setSubtitleUrls(await getLocalSubtitleUrls(filePath))
                await link.to({
                    endpoint: "/api/v1/mediastream/file?path=" + encodeFilePath(filePath),
                    onTokenQueryParam: () => getHMACTokenQueryParam("/api/v1/mediastream/file", "&"),
                })
                openTab(link.getFullUrl())
                setCurrentExternalPlayerLink(link.getFullUrl())

                if (episode?.progressNumber && episode.type === "main") {
                    logger("MEDIALINKS").error("Starting manual tracking")
                    // Start manual tracking
                    React.startTransition(() => {
                        startManualTracking({
                            mediaId: animeEntry.mediaId,
                            episodeNumber: episode?.progressNumber,
                            clientId: clientId || "",
                        })
                    })
                } else {
                    logger("MEDIALINKS").warning("No manual tracking, progress number is not set.")
                }

                // Clear the file path
                setFilePath(undefined)
            }

            handleMediaPlay()
        }
    }, [animeEntry, filePath, externalPlayerLink, getHMACTokenQueryParam, encodePath])

    return <MedialinksPhone entry={animeEntry} loading={animeEntryLoading} onPlay={setFilePath} />

}
