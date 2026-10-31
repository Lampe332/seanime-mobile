import { AL_BaseAnime, AL_BaseManga, Anime_EntryListData, Manga_EntryListData, Nullish } from "@/api/generated/types"
import { useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { useGetMangaEntry } from "@/api/hooks/manga.hooks"
import { FORMAT_LABELS, MEDIA_STATUS_LABELS, PhoneSheet, seasonYearLabel } from "@/app/(main)/_features/phone-screen/phone-screen"
import { AnilistMediaEntryModal } from "@/app/(main)/_features/media/_containers/anilist-media-entry-modal"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { Translate, useTr } from "@/lib/app-language"
import React from "react"
import { LuArrowUpRight } from "react-icons/lu"
import "./media-preview-phone.css"

/**
 * The long-press "Preview" on Android phones: a sheet with the cover, what it is, where the user is with it, the genres
 * and the synopsis, and the page one tap away; instead of the desktop modal with the whole entry page inside.
 */

const LIST_STATUS: Record<string, { anime: [string, string], manga: [string, string] }> = {
    CURRENT: { anime: ["Watching", "Schaue ich"], manga: ["Reading", "Lese ich"] },
    PLANNING: { anime: ["Planning", "Geplant"], manga: ["Planning", "Geplant"] },
    COMPLETED: { anime: ["Completed", "Fertig"], manga: ["Completed", "Fertig"] },
    PAUSED: { anime: ["Paused", "Pausiert"], manga: ["Paused", "Pausiert"] },
    DROPPED: { anime: ["Dropped", "Abgebrochen"], manga: ["Dropped", "Abgebrochen"] },
    REPEATING: { anime: ["Rewatching", "Schaue ich erneut"], manga: ["Rereading", "Lese ich erneut"] },
}

/** AniList's synopsis is HTML; the sheet shows its text with the line breaks kept. */
function synopsis(html?: string) {
    if (!html) return ""
    const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n"), "text/html")
    return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim()
}

function Preview({ t, type, media, listData, listStatus, progress, loading, onClose }: {
    t: Translate
    type: "anime" | "manga"
    media: Nullish<AL_BaseAnime | AL_BaseManga>
    /** Status, progress and score on the list, to change them right here */
    listData?: Anime_EntryListData | Manga_EntryListData
    listStatus?: string
    progress?: number
    loading: boolean
    onClose: () => void
}) {
    const [more, setMore] = React.useState(false)
    if (loading && !media) return <p className="ps-sheet-note" role="status">{t("Loading…", "Wird geladen…")}</p>
    if (!media) return <p className="ps-sheet-note">{t("This title could not be loaded.", "Dieser Titel konnte nicht geladen werden.")}</p>
    const anime = type === "anime" ? media as AL_BaseAnime : undefined
    const manga = type === "manga" ? media as AL_BaseManga : undefined
    const total = anime?.episodes ?? manga?.chapters
    const facts = [
        media.format ? t(...(FORMAT_LABELS[media.format] ?? [media.format, media.format])) : "",
        seasonYearLabel(t, media),
        total ? (anime ? t(`${total} episodes`, `${total} Folgen`) : t(`${total} chapters`, `${total} Kapitel`)) : "",
        media.status ? t(...(MEDIA_STATUS_LABELS[media.status] ?? [media.status, media.status])) : "",
    ].filter(Boolean).join(" · ")
    const status = listStatus ? LIST_STATUS[listStatus]?.[type] : undefined
    const text = synopsis(media.description)
    const trailer = anime?.trailer?.site === "youtube" && anime.trailer.id ? `https://www.youtube.com/watch?v=${anime.trailer.id}` : null
    return <>
        <div className="mpp-head">
            <span className="mpp-cover">{!!media.coverImage?.large && <SeaImage src={media.coverImage.large} alt="" fill sizes="7rem" className="object-cover" />}</span>
            <div className="mpp-text">
                <p className="mpp-facts">{facts}</p>
                {!!status && <p className="mpp-status" data-preview-status>{t(...status)}{progress ? ` · ${progress}${total ? ` / ${total}` : ""}` : ""}</p>}
                {!!media.genres?.length && <p className="mpp-genres">{media.genres.slice(0, 4).join(" · ")}</p>}
            </div>
        </div>
        {!!text && <div className="mpp-synopsis">
            <p data-open={more} data-preview-synopsis>{text}</p>
            {text.length > 220 && <button type="button" className="ps-text-action" aria-expanded={more} onClick={() => setMore(v => !v)}>
                {more ? t("Less", "Weniger") : t("More", "Mehr")}
            </button>}
        </div>}
        <div className="ps-sheet-actions">
            <AnilistMediaEntryModal mobileEntry listData={listData} media={media} type={type} />
            {!!trailer && <a href={trailer} target="_blank" rel="noreferrer" className="ps-secondary" data-preview-trailer>{t("Trailer", "Trailer")}<LuArrowUpRight aria-hidden /></a>}
            <SeaLink href={type === "anime" ? `/entry?id=${media.id}` : `/manga/entry?id=${media.id}`} className="ps-primary" onClick={onClose} data-preview-open>
                {t("Open page", "Seite öffnen")}
            </SeaLink>
        </div>
    </>
}

export function MediaPreviewPhoneSheet({ info, onClose }: { info: { mediaId: number, type: "anime" | "manga" } | undefined, onClose: () => void }) {
    const t = useTr()
    const anime = useGetAnimeEntry(info?.type === "anime" ? info.mediaId : null)
    const manga = useGetMangaEntry(info?.type === "manga" ? info.mediaId : null)
    const entry = info?.type === "manga" ? manga : anime
    const media = entry.data?.media
    const title = media?.title?.userPreferred || media?.title?.english || media?.title?.romaji || t("Preview", "Vorschau")
    return <PhoneSheet title={title} open={!!info} onOpenChange={open => !open && onClose()} className="mpp-sheet" data-media-preview-phone>
        {!!info && <Preview key={`${info.type}-${info.mediaId}`} t={t} type={info.type} media={media} listData={entry.data?.listData} listStatus={entry.data?.listData?.status}
            progress={entry.data?.listData?.progress} loading={entry.isLoading} onClose={onClose} />}
    </PhoneSheet>
}
