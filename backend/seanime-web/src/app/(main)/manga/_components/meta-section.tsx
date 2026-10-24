import { AL_MangaDetailsById_Media, Manga_Entry } from "@/api/generated/types"
import {
    AnimeEntryRankings,
    MediaEntryAudienceScore,
    MediaEntryGenresList,
} from "@/app/(main)/_features/media/_components/media-entry-metadata-components"
import { MobileAnimeHeaderContainer, MobileAnimeHeaderDetails, MobileAnimeHeaderShell } from "@/app/(main)/entry/_components/mobile-anime-header"
import { PluginMangaPageButtons, PluginMangaPageDropdownItems } from "@/app/(main)/_features/plugin/actions/plugin-actions"
import { PluginWebviewSlot } from "@/app/(main)/_features/plugin/webview/plugin-webviews"
import { SeaLink } from "@/components/shared/sea-link"
import { IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { copyToClipboard, openTab } from "@/lib/helpers/browser"
import { getCustomSourceExtensionId, getCustomSourceMediaSiteUrl, isCustomSource } from "@/lib/server/utils"
import { ThemeMediaPageInfoBoxSize, useThemeSettings } from "@/lib/theme/theme-hooks"
import React from "react"
import { BiDotsVerticalRounded, BiExtension } from "react-icons/bi"
import { LuExternalLink } from "react-icons/lu"
import { useTr } from "@/lib/app-language"
import { SiAnilist, SiMyanimelist } from "react-icons/si"


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
                    <DropdownMenu
                        data-manga-entry-dropdown-menu
                        trigger={<button type="button" className="mobile-entry-icon" data-manga-entry-dropdown-menu-trigger
                            aria-label={tr("More options", "Weitere Optionen")} title={tr("More options", "Weitere Optionen")}>
                            <BiDotsVerticalRounded aria-hidden />
                        </button>}
                    >
                        {!isCustomSource(entry.mediaId) && <DropdownMenuItem onClick={() => openTab(`https://anilist.co/manga/${entry.mediaId}`)}>
                            <SiAnilist /> {tr("Open on AniList", "Auf AniList öffnen")}
                        </DropdownMenuItem>}
                        {!!entry.media.idMal && <DropdownMenuItem onClick={() => openTab(`https://myanimelist.net/manga/${entry.media?.idMal}`)}>
                            <SiMyanimelist /> {tr("Open on MAL", "Auf MAL öffnen")}
                        </DropdownMenuItem>}
                        {isCustomSource(entry.mediaId) && !!getCustomSourceMediaSiteUrl(entry.media) && <DropdownMenuItem
                            onClick={() => openTab(getCustomSourceMediaSiteUrl(entry.media)!)}>
                            <LuExternalLink /> {tr("Open in website", "Auf der Website öffnen")}
                        </DropdownMenuItem>}
                        {isCustomSource(entry.mediaId) && <DropdownMenuItem onClick={() => copyToClipboard(entry.mediaId.toString())}>
                            {tr("Copy ID", "ID kopieren")}
                        </DropdownMenuItem>}
                        <PluginMangaPageDropdownItems media={entry.media} />
                    </DropdownMenu>
                </div>

            </MobileAnimeHeaderContainer>
        </MobileAnimeHeaderShell>

    )

}
