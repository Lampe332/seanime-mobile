import type { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import type { Translate } from "@/lib/app-language"
import { utf8ToBase64 } from "@/lib/helpers/base64"

/* The external player's page (web medialinks/page.tsx + medialinks-phone.tsx) without the screen. */

export type EpisodeGroup = { key: "main" | "special" | "nc", title: string, episodes: Anime_Episode[] }

/** The anime's downloaded episodes: main episodes first, then specials and openings/endings; empty groups left out */
export function downloadedEpisodeGroups(entry: Anime_Entry | undefined, t: Translate): EpisodeGroup[] {
    const episodes = (entry?.episodes ?? []).filter(episode => !!episode.localFile?.path)
    const groups: EpisodeGroup[] = [
        { key: "main", title: t("Episodes", "Folgen"), episodes: episodes.filter(episode => episode.type === "main") },
        { key: "special", title: t("Specials", "Specials"), episodes: episodes.filter(episode => episode.type === "special") },
        { key: "nc", title: t("Openings and endings", "Openings und Endings"), episodes: episodes.filter(episode => episode.type === "nc") },
    ]
    return groups.filter(group => group.episodes.length > 0)
}

/** A main episode counts as watched once the list progress reaches it */
export function isWatched(episode: Anime_Episode, progress: number) {
    return episode.type === "main" && episode.progressNumber > 0 && progress >= episode.progressNumber
}

/** The small facts under an episode: length, filler, missing metadata */
export function episodeFacts(episode: Anime_Episode, t: Translate) {
    const meta = episode.episodeMetadata
    return [meta?.length ? t(`${meta.length} min`, `${meta.length} Min.`) : "", meta?.isFiller ? t("Filler", "Filler") : "",
        episode.isInvalid ? t("No metadata", "Keine Metadaten") : ""].filter(Boolean).join(" · ")
}

/** The file path in the stream URL: base64 when the player link asks for it, else URL-encoded */
export function encodeFilePath(path: string, base64: boolean) {
    return base64 ? utf8ToBase64(path) : encodeURIComponent(path)
}
