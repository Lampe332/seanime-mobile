import { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { PhoneEmpty, PhoneHeader, PhoneIconLink, PhoneLoading, PhoneScreen, PhoneSection } from "@/app/(main)/_features/phone-screen/phone-screen"
import { SeaImage } from "@/components/shared/sea-image"
import { Translate, useTr } from "@/lib/app-language"
import React from "react"
import { LuArrowLeft, LuCheck, LuExternalLink } from "react-icons/lu"
import "./medialinks-phone.css"

/**
 * The external player's page on Android phones: the anime's downloaded episodes as rows; a tap opens one in the external
 * player (VLC, mpv …) and Seanime tracks it. Main episodes first, then specials and openings/endings.
 */

function EpisodeRow({ t, episode, watched, playing, onPlay }: { t: Translate, episode: Anime_Episode, watched: boolean, playing: boolean, onPlay: () => void }) {
    const meta = episode.episodeMetadata
    const image = meta?.image || episode.baseAnime?.coverImage?.large
    const facts = [meta?.length ? t(`${meta.length} min`, `${meta.length} Min.`) : "", meta?.isFiller ? t("Filler", "Filler") : "",
        episode.isInvalid ? t("No metadata", "Keine Metadaten") : ""].filter(Boolean).join(" · ")
    return <button type="button" className="pml-row" aria-current={playing || undefined} onClick={onPlay} data-medialinks-episode={episode.localFile?.path}>
        <span className="pml-thumb">{!!image && <SeaImage src={image} alt="" fill sizes="7rem" className="object-cover" />}
            {watched && <span className="pml-watched" aria-label={t("Watched", "Gesehen")} role="img"><LuCheck aria-hidden /></span>}</span>
        <span className="ps-list-text">
            <span className="ps-list-title">{episode.displayTitle}</span>
            {!!episode.episodeTitle && <span className="pml-episode-title">{episode.episodeTitle}</span>}
            <span className="ps-list-meta">{playing ? <span className="pml-playing">{t("Opened in your player", "Im Player geöffnet")}</span> : facts}</span>
        </span>
        <LuExternalLink className="pml-open" aria-hidden />
    </button>
}

export function MedialinksPhone({ entry, loading, onPlay }: {
    entry: Anime_Entry | undefined
    loading: boolean
    onPlay: (path: string) => void
}) {
    const t = useTr()
    // The episode last sent to the player, marked until another one is
    const [playingPath, setPlayingPath] = React.useState<string>()
    const episodes = (entry?.episodes ?? []).filter(episode => !!episode.localFile?.path)
    const groups: [string, string, Anime_Episode[]][] = [
        ["main", t("Episodes", "Folgen"), episodes.filter(episode => episode.type === "main")],
        ["special", t("Specials", "Specials"), episodes.filter(episode => episode.type === "special")],
        ["nc", t("Openings and endings", "Openings und Endings"), episodes.filter(episode => episode.type === "nc")],
    ]
    const progress = entry?.listData?.progress ?? 0
    return <PhoneScreen screen="medialinks">
        <PhoneHeader title={entry?.media?.title?.userPreferred || t("External player", "Externer Player")}
            facts={t("A tap opens the episode in your external player", "Ein Tipp öffnet die Folge in deinem externen Player")}>
            {!!entry && <PhoneIconLink href={`/entry?id=${entry.mediaId}`} label={t("Back to the anime", "Zurück zum Anime")} data-medialinks-back><LuArrowLeft aria-hidden /></PhoneIconLink>}
        </PhoneHeader>
        {loading ? <PhoneLoading label={t("Loading episodes", "Folgen werden geladen")} layout={["row", "row", "row", "row"]} />
            : !episodes.length ? <PhoneEmpty title={t("No downloaded episodes", "Keine heruntergeladenen Folgen")}
                    text={t("Only episodes on this phone can open in an external player.", "Nur Folgen auf diesem Handy lassen sich im externen Player öffnen.")} data-medialinks-empty />
                : groups.filter(([, , list]) => list.length).map(([key, title, list]) => <PhoneSection key={key} id={`pml-${key}`} title={title} count={list.length} data-medialinks-section={key}>
                    <div className="ps-list">
                        {list.map(episode => <EpisodeRow key={episode.localFile!.path} t={t} episode={episode} playing={episode.localFile!.path === playingPath}
                            watched={episode.type === "main" && progress >= episode.progressNumber && episode.progressNumber > 0} onPlay={() => {
                                setPlayingPath(episode.localFile!.path)
                                onPlay(episode.localFile!.path)
                            }} />)}
                    </div>
                </PhoneSection>)}
    </PhoneScreen>
}
