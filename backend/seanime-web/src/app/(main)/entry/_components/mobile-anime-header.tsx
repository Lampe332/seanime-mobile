import { AnilistMediaEntryModal } from "@/app/(main)/_features/media/_containers/anilist-media-entry-modal"
import { MediaPageHeaderEntryDetailsProps, MediaPageHeaderScoreAndProgress } from "@/app/(main)/_features/media/_components/media-page-header-components"
import { SeaImage } from "@/components/shared/sea-image"
import { getImageUrl } from "@/lib/server/assets"
import { tr } from "@/lib/app-language"
import { atom, useAtomValue } from "jotai"
import React from "react"
import { IoBookOutline } from "react-icons/io5"
import "./mobile-anime.css"

/** Manga: the chapter list publishes its read action (start / continue / resume) for the header. */
export type MobileReadAction = { label: string, detail?: string, onClick: () => void }
export const mobileMangaReadActionAtom = atom<MobileReadAction | null>(null)

function MobileMangaReadAction() {
    const action = useAtomValue(mobileMangaReadActionAtom)
    if (!action) return null
    return <button type="button" className="mobile-anime-episodes-link mobile-read-action" data-mobile-read-action onClick={action.onClick}>
        <IoBookOutline aria-hidden />
        <span>{action.label}{action.detail && <small>{action.detail}</small>}</span>
    </button>
}

// Android owns this header. No banner, scroll subscription or DOM reparenting.
export function MobileAnimeHeaderShell({ children }: { children?: React.ReactNode, backgroundImage?: string, coverImage?: string }) {
    return <header className="mobile-anime-header">{children}</header>
}
export function MobileAnimeHeaderContainer({ children }: { children?: React.ReactNode }) {
    return <div className="mobile-anime-header-inner">{children}</div>
}
export function MobileAnimeHeaderDetails(props: MediaPageHeaderEntryDetailsProps) {
    const { coverImage, title, englishTitle, romajiTitle, startDate, status, description, listData, media, type, progressTotal, children, after } = props
    const manga = type === "manga"
    return <>
        <div className="mobile-anime-identity">
            <div className="mobile-anime-cover">
                {coverImage ? <SeaImage src={getImageUrl(coverImage)} alt={title || (manga ? tr("Manga cover", "Manga-Cover") : tr("Anime cover", "Anime-Cover"))} fill sizes="96px" className="object-contain" /> : <span aria-label={tr("No cover", "Kein Cover")}>◇</span>}
            </div>
            <div className="mobile-anime-title">
                <h1>{title || romajiTitle || englishTitle || (manga ? "Manga" : "Anime")}</h1>
                <p>{[startDate?.year, status?.replaceAll("_", " ").toLowerCase()].filter(Boolean).join(" · ")}</p>
            </div>
        </div>
        <div className="mobile-anime-progress">
            <div><span>{tr("Your progress", "Dein Fortschritt")}</span><div><MediaPageHeaderScoreAndProgress score={listData?.score} progress={listData?.progress} episodes={progressTotal} /></div></div>
            <AnilistMediaEntryModal mobileEntry listData={listData} media={media} type={type} />
            {listData?.status && <p>{listData.status.replaceAll("_", " ").toLowerCase()}{listData.repeat ? ` · ${listData.repeat} ${manga ? tr("rereads", "Wiederholungen") : tr("rewatches", "Wiederholungen")}` : ""}</p>}
        </div>
        {manga ? <MobileMangaReadAction /> : <a className="mobile-anime-episodes-link" href="#anime-episodes">
            {tr("Episodes & playback", "Episoden & Wiedergabe")} <span aria-hidden>↓</span>
        </a>}
        <details className="mobile-anime-details">
            <summary>{manga ? tr("About this manga", "Über diesen Manga") : tr("About this anime", "Über diesen Anime")}</summary>
            <p>{title}</p>
            {englishTitle && englishTitle !== title && <p>{englishTitle}</p>}
            {romajiTitle && romajiTitle !== title && romajiTitle !== englishTitle && <p>{romajiTitle}</p>}
            <p>{description?.replace(/(<([^>]+)>)/ig, "") || tr("No description available.", "Keine Beschreibung verfügbar.")}</p>
            {children}
            {after}
        </details>
    </>
}
