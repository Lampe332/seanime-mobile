import type { AL_BaseAnime, AL_BaseManga, Anime_EntryListData, Manga_EntryListData, Nullish } from "@/api/generated/types"
import { useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { useGetMangaEntry } from "@/api/hooks/manga.hooks"
import { FORMAT_LABELS } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { usePathname, useRouter } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { colors } from "@/lib/theme/tokens"
import { AnilistMediaEntryButton } from "@/main/_features/media/_containers/anilist-media-entry-sheet"
import { MEDIA_STATUS_LABELS, seasonYearLabel, synopsisText } from "@/main/_features/media/_lib/media-labels"
import { openInAppBrowser } from "@/lib/helpers/browser"
import { Image } from "expo-image"
import { atom, useAtom, useSetAtom } from "jotai"
import { mediaEntryHref } from "@/main/_features/media/_lib/media-card"
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right"
import React from "react"
import { View } from "react-native"

/*
 * The long-press "Preview" (media-preview-phone.tsx + media-preview-modal.tsx): a sheet with the cover, what it is, where
 * the user is with it, the genres and the synopsis, and the page one tap away.
 */

const LIST_STATUS: Record<string, { anime: [string, string], manga: [string, string] }> = {
    CURRENT: { anime: ["Watching", "Schaue ich"], manga: ["Reading", "Lese ich"] },
    PLANNING: { anime: ["Planning", "Geplant"], manga: ["Planning", "Geplant"] },
    COMPLETED: { anime: ["Completed", "Fertig"], manga: ["Completed", "Fertig"] },
    PAUSED: { anime: ["Paused", "Pausiert"], manga: ["Paused", "Pausiert"] },
    DROPPED: { anime: ["Dropped", "Abgebrochen"], manga: ["Dropped", "Abgebrochen"] },
    REPEATING: { anime: ["Rewatching", "Schaue ich erneut"], manga: ["Rereading", "Lese ich erneut"] },
}

type PreviewInfo = { mediaId: number, type: "anime" | "manga" }
const __mediaPreview_mediaIdAtom = atom<PreviewInfo | undefined>(undefined)

export function useMediaPreviewModal() {
    const setInfo = useSetAtom(__mediaPreview_mediaIdAtom)
    return { setPreviewModalMediaId: (mediaId: number, type: "anime" | "manga") => setInfo({ mediaId, type }) }
}

function Preview({ t, type, media, listData, loading, onOpenPage }: {
    t: Translate
    type: "anime" | "manga"
    media: Nullish<AL_BaseAnime | AL_BaseManga>
    listData?: Anime_EntryListData | Manga_EntryListData
    loading: boolean
    onOpenPage?: () => void
}) {
    const [more, setMore] = React.useState(false)
    if (loading && !media) return <Muted accessibilityRole="progressbar">{t("Loading…", "Wird geladen…")}</Muted>
    if (!media) return <Muted>{t("This title could not be loaded.", "Dieser Titel konnte nicht geladen werden.")}</Muted>
    const anime = type === "anime" ? media as AL_BaseAnime : undefined
    const manga = type === "manga" ? media as AL_BaseManga : undefined
    const total = anime?.episodes ?? manga?.chapters
    const facts = [
        media.format ? t(...(FORMAT_LABELS[media.format] ?? [media.format, media.format])) : "",
        seasonYearLabel(t, media),
        total ? (anime ? t(`${total} episodes`, `${total} Folgen`) : t(`${total} chapters`, `${total} Kapitel`)) : "",
        media.status ? t(...(MEDIA_STATUS_LABELS[media.status] ?? [media.status, media.status])) : "",
    ].filter(Boolean).join(" · ")
    const status = listData?.status ? LIST_STATUS[listData.status]?.[type] : undefined
    const progress = listData?.progress
    const text = synopsisText(media.description)
    const trailer = anime?.trailer?.site === "youtube" && anime.trailer.id ? `https://www.youtube.com/watch?v=${anime.trailer.id}` : null
    return <>
        <View className="flex-row flex-wrap items-start gap-4">
            <View className="aspect-[2/3] w-[104px] overflow-hidden rounded-surface-sm bg-sm-surface-control">
                {!!media.coverImage?.large && <Image source={getImageUrl(media.coverImage.large)} contentFit="cover" style={{ position: "absolute", inset: 0 }} accessibilityIgnoresInvertColors />}
            </View>
            <View className="min-w-[176px] flex-1 gap-1.5 pt-0.5">
                <Text className="text-sm leading-[20px] text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>{facts}</Text>
                {!!status && <Text className="text-[15px] font-semibold text-sm-accent">{t(...status)}{progress ? ` · ${progress}${total ? ` / ${total}` : ""}` : ""}</Text>}
                {!!media.genres?.length && <Text className="text-[13px] leading-[19px] text-sm-text-subtle">{media.genres.slice(0, 4).join(" · ")}</Text>}
            </View>
        </View>
        {!!text && <View className="items-start gap-1">
            <Text numberOfLines={more ? undefined : 5} className="text-[15px] leading-[24px]">{text}</Text>
            {text.length > 220 && <Button intent="text" className="-ml-2" accessibilityState={{ expanded: more }} onPress={() => setMore(v => !v)}>
                {more ? t("Less", "Weniger") : t("More", "Mehr")}
            </Button>}
        </View>}
        <View className="flex-row flex-wrap gap-2">
            <AnilistMediaEntryButton media={media} listData={listData} type={type} variant="action" />
            {!!trailer && <Button intent="secondary" rightIcon={<ArrowUpRight size={18} color={colors.smText} />} onPress={() => openInAppBrowser(trailer)}>Trailer</Button>}
            {!!onOpenPage && <Button wrapperClassName="min-w-[160px] flex-1" onPress={onOpenPage}>{t("Open page", "Seite öffnen")}</Button>}
        </View>
    </>
}

/** Mounted once in the main layout; any card's long-press menu opens it. "Open page" leads to the anime or manga page. */
export function MediaPreviewModal() {
    const t = useTr()
    const router = useRouter()
    const [info, setInfo] = useAtom(__mediaPreview_mediaIdAtom)
    const anime = useGetAnimeEntry(info?.type === "anime" ? info.mediaId : null)
    const manga = useGetMangaEntry(info?.type === "manga" ? info.mediaId : null)
    const entry = info?.type === "manga" ? manga : anime
    const media = entry.data?.media
    const title = media?.title?.userPreferred || media?.title?.english || media?.title?.romaji || t("Preview", "Vorschau")
    const close = () => setInfo(undefined)
    // Moving to another page closes it (media-preview-modal.tsx)
    const pathname = usePathname()
    React.useEffect(() => {
        setInfo(undefined)
    }, [pathname, setInfo])
    return <Sheet title={title} open={!!info} onOpenChange={open => !open && close()}>
        {!!info && <Preview key={`${info.type}-${info.mediaId}`} t={t} type={info.type} media={media} listData={entry.data?.listData}
            loading={entry.isLoading} onOpenPage={() => {
                close()
                router.push(mediaEntryHref(info.type, info.mediaId))
            }} />}
    </Sheet>
}
