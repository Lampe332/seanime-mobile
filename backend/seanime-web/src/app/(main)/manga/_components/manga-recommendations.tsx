import { AL_MangaDetailsById_Media, Manga_Entry, Nullish } from "@/api/generated/types"
import { MediaCardGrid } from "@/app/(main)/_features/media/_components/media-card-grid"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { MediaEntryDetailsSkeleton } from "@/app/(main)/_features/media/_components/media-entry-page-loading-display"
import { Translate, useTr } from "@/lib/app-language"
import capitalize from "lodash/capitalize"
import React from "react"

const RELATION_DE: Record<string, string> = {
    ADAPTATION: "Adaption", SOURCE: "Vorlage", ALTERNATIVE: "Alternative", SPIN_OFF: "Spin-off", SIDE_STORY: "Nebengeschichte",
    SEQUEL: "Fortsetzung", PREQUEL: "Vorgeschichte", PARENT: "Hauptgeschichte", SUMMARY: "Zusammenfassung", COMPILATION: "Zusammenschnitt",
    CONTAINS: "Enthält", CHARACTER: "Gleiche Figuren", OTHER: "Sonstiges",
}

function relationLabel(relationType: string | undefined, isMovie: boolean, t: Translate) {
    const type = relationType || ""
    return `${t(capitalize(type).replace("_", " "), RELATION_DE[type] ?? capitalize(type).replace("_", " "))}${isMovie ? t(" (Movie)", " (Film)") : ""}`
}

type MangaRecommendationsProps = {
    entry: Nullish<Manga_Entry>
    details: Nullish<AL_MangaDetailsById_Media>
    loading?: boolean
    maxCol?: number
}

export function MangaRecommendations(props: MangaRecommendationsProps) {

    const {
        entry,
        details,
        loading,
        maxCol,
        ...rest
    } = props

    const anime = details?.relations?.edges?.filter(Boolean)?.filter(edge => edge?.node?.type === "ANIME" &&
        (edge?.node?.format === "TV" || edge?.node?.format === "MOVIE" || edge?.node?.format === "TV_SHORT"))?.slice(0, 3)

    const recommendations = details?.recommendations?.edges?.map(edge => edge?.node?.mediaRecommendation)?.filter(Boolean)?.slice(0, 6) || []

    // Headings and relation labels in the app language
    const t = useTr()

    if (loading && !details) return <MediaEntryDetailsSkeleton isMangaPage showCharacters={false} />
    if (!entry || !details) return null

    return (
        <div className="space-y-4 animate-in fade-in-0 duration-200" data-manga-recommendations-container>
            {!!anime?.length && (
                <>
                    <h2>{t("Relations", "Als Anime")}</h2>
                    <MediaCardGrid maxCol={maxCol}>
                        {anime?.toSorted((a, b) => (a.node?.format === "TV" && b.node?.format !== "TV")
                            ? -1
                            : (a.node?.format !== "TV" && b.node?.format === "TV") ? 1 : 0).map(edge => {
                            return <div key={edge?.node?.id!} className="col-span-1">
                                <MediaEntryCard
                                    media={edge?.node!}
                                    showLibraryBadge
                                    showTrailer
                                    overlay={<p
                                        className="font-semibold text-white bg-gray-950 z-[-1] absolute right-0 w-fit px-4 py-1.5 text-center !bg-opacity-90 text-sm lg:text-base rounded-none rounded-bl-lg"
                                        data-manga-relation-label
                                    >{relationLabel(edge.relationType, edge?.node?.format === "MOVIE", t)}</p>}
                                    type="anime"
                                />
                            </div>
                        })}
                    </MediaCardGrid>
                </>
            )}
            {recommendations.length > 0 && <>
                <h2>{t("Recommendations", "Empfehlungen")}</h2>
                <MediaCardGrid maxCol={maxCol}>
                    {recommendations.map(media => {
                        return <div key={media.id} className="col-span-1">
                            <MediaEntryCard
                                media={media!}
                                type="manga"
                            />
                        </div>
                    })}
                </MediaCardGrid>
            </>}
        </div>
    )
}

