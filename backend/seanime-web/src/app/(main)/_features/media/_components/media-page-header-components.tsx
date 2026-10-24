import { AL_BaseAnime, AL_BaseManga, AL_MediaStatus, Anime_EntryListData, Manga_EntryListData, Nullish } from "@/api/generated/types"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/components/ui/core/styling"
import { getScoreColor } from "@/lib/helpers/score"
import React from "react"
import { BiSolidStar, BiStar } from "react-icons/bi"

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export type MediaPageHeaderEntryDetailsProps = {
    children?: React.ReactNode
    coverImage?: string
    color?: string
    title?: string
    englishTitle?: string
    romajiTitle?: string
    startDate?: { year?: number, month?: number }
    season?: string
    progressTotal?: number
    status?: AL_MediaStatus
    description?: string
    smallerTitle?: boolean

    listData?: Anime_EntryListData | Manga_EntryListData
    media: AL_BaseAnime | AL_BaseManga
    type: "anime" | "manga"
    offlineAnilistAnimeEntryModal?: React.ReactNode
    after?: React.ReactNode
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export function MediaPageHeaderScoreAndProgress({ score, progress, episodes }: {
    score: Nullish<number>,
    progress: Nullish<number>,
    episodes: Nullish<number>,
}) {

    return (
        <>
            {!!score && <Badge
                leftIcon={score >= 90 ? <BiSolidStar className="text-sm" /> : <BiStar className="text-sm" />}
                size="xl"
                intent="unstyled"
                className={getScoreColor(score, "user")}
                data-media-page-header-score-badge
            >
                {score / 10}
            </Badge>}
            <Badge
                size="xl"
                intent="basic"
                className="!text-xl font-bold !text-white px-0 gap-0 rounded-none"
                data-media-page-header-progress-badge
            >
                <span data-media-page-header-progress-badge-progress>{`${progress ?? 0}`}</span><span
                data-media-page-header-progress-total
                className={cn(
                    (!progress || progress !== episodes) && "opacity-60",
                )}
            >/{episodes || "-"}</span>
            </Badge>
        </>
    )

}
