import { AL_MangaDetailsById_Media, Manga_Entry } from "@/api/generated/types"
import {
    AnimeEntryRankings,
    MediaEntryAudienceScore,
    MediaEntryGenresList,
} from "@/app/(main)/_features/media/_components/media-entry-metadata-components"
import { MobileAnimeHeaderContainer, MobileAnimeHeaderDetails, MobileAnimeHeaderShell } from "@/app/(main)/entry/_components/mobile-anime-header"
import { PluginMangaPageButtons } from "@/app/(main)/_features/plugin/actions/plugin-actions"
import { MangaEntryPhoneMenu } from "@/app/(main)/manga/_components/manga-entry-phone-menu"
import { PluginWebviewSlot } from "@/app/(main)/_features/plugin/webview/plugin-webviews"
import { SeaLink } from "@/components/shared/sea-link"
import { IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { Skeleton } from "@/components/ui/skeleton"
import { getCustomSourceExtensionId, getCustomSourceMediaSiteUrl, isCustomSource } from "@/lib/server/utils"
import { ThemeMediaPageInfoBoxSize, useThemeSettings } from "@/lib/theme/theme-hooks"
import React from "react"
import { BiExtension } from "react-icons/bi"
import { LuExternalLink } from "react-icons/lu"
import { useTr } from "@/lib/app-language"
import { SiAnilist } from "react-icons/si"


export function MetaSection(props: { entry: Manga_Entry | undefined, details: AL_MangaDetailsById_Media | undefined, detailsLoading?: boolean }) {

    const { entry, details, detailsLoading } = props
    const ts = useThemeSettings()
    const tr = useTr()

    if (!entry?.media) return null

    // Same header as the anime page: cover, title, progress, one jump to the chapters
    return (
        <MobileAnimeHeaderShell>

            <MobileAnimeHeaderContainer>

                <MobileAnimeHeaderDetails
                    coverImage={entry.media?.coverImage?.extraLarge || entry.media?.coverImage?.large}
                    title={entry.media?.title?.userPreferred}
                    englishTitle={entry.media?.title?.english}
                    romajiTitle={entry.media?.title?.romaji}
                    startDate={entry.media?.startDate}
                    season={entry.media?.season}
                    color={entry.media?.coverImage?.color}
                    progressTotal={entry.media?.chapters}
                    status={entry.media?.status}
                    description={entry.media?.description}
                    listData={entry.listData}
                    media={entry.media}
                    type="manga"
                    after={<div className="w-full flex flex-wrap gap-4 items-center" data-manga-meta-section-buttons-container>

                        {isCustomSource(entry.mediaId) && <SeaLink href={`/custom-sources?provider=${getCustomSourceExtensionId(entry.media)}`}>
                            <IconButton size="sm" intent="gray-link" className="px-0" icon={<BiExtension className="text-lg" />}
                                aria-label={tr("Custom source", "Eigene Quelle")} />
                        </SeaLink>}

                        {!isCustomSource(entry.mediaId) && <SeaLink href={`https://anilist.co/manga/${entry.mediaId}`} target="_blank">
                            <IconButton size="sm" intent="gray-link" className="px-0" icon={<SiAnilist className="text-lg" />} aria-label="AniList" />
                        </SeaLink>}

                        {isCustomSource(entry.mediaId) && !!getCustomSourceMediaSiteUrl(entry.media) &&
                            <SeaLink href={getCustomSourceMediaSiteUrl(entry.media)!} target="_blank">
                                <IconButton size="sm" intent="gray-link" className="px-0" icon={<LuExternalLink className="text-lg" />}
                                    aria-label={tr("Open in website", "Auf der Website öffnen")} />
                            </SeaLink>}
                    </div>}
                >
                    <div
                        className={cn(
                            "flex gap-2 flex-wrap items-center",
                            ts.mediaPageBannerInfoBoxSize === ThemeMediaPageInfoBoxSize.Fluid && "justify-center lg:justify-start lg:max-w-[65vw]",
                        )}
                    >
                        <MediaEntryAudienceScore meanScore={entry.media?.meanScore} badgeClass="bg-transparent border-transparent px-0" />

                        {(detailsLoading && !details) ? <Skeleton className="h-6 w-52 rounded-full opacity-60" /> :
                            <MediaEntryGenresList genres={details?.genres} type="manga" />}
                    </div>

                    <AnimeEntryRankings rankings={details?.rankings} />
                </MobileAnimeHeaderDetails>

                <PluginWebviewSlot slot="after-media-entry-details" />

                <div className="mobile-entry-actions" data-manga-meta-section-buttons-row>
                    <PluginMangaPageButtons media={entry.media} />
                    <MangaEntryPhoneMenu entry={entry} />
                </div>

            </MobileAnimeHeaderContainer>
        </MobileAnimeHeaderShell>

    )

}
