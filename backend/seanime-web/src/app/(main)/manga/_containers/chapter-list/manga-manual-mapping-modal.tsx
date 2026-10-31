import { HibikeManga_SearchResult, Manga_Entry } from "@/api/generated/types"
import {
    useGetMangaMapping,
    useMangaManualMapping,
    useMangaManualSearch,
    usePreviewMangaMapping,
    useRemoveMangaMapping,
} from "@/api/hooks/manga.hooks"
import { useSelectedMangaProvider } from "@/app/(main)/manga/_lib/handle-manga-selected-provider"
import { useMangaReaderUtils } from "@/app/(main)/manga/_lib/handle-manga-utils"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Modal } from "@/components/ui/modal"
import { useTr } from "@/lib/app-language"
import React from "react"
import { FiSearch } from "react-icons/fi"
import { LuChevronRight } from "react-icons/lu"
import { toast } from "sonner"

type MangaManualMappingModalProps = {
    entry: Manga_Entry
    /** The button that opens it; without one, open and onOpenChange control it (the chapter list's "More" sheet) */
    children?: React.ReactElement
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

export function MangaManualMappingModal(props: MangaManualMappingModalProps) {

    const {
        children,
        entry,
        open,
        onOpenChange,
    } = props

    const t = useTr()

    // Same bottom sheet as the anime page's manual match.
    return (
        <Modal
            data-manga-manual-mapping-modal
            title={t("Manual match", "Manuell zuordnen")}
            description={t("Pick the matching title from the selected source.", "Wähle den passenden Titel der gewählten Quelle.")}
            trigger={children}
            open={open}
            onOpenChange={onOpenChange}
            contentClass="mobile-anime-dialog mobile-download-sheet mobile-match-sheet"
        >
            <MobileContent entry={entry} />
        </Modal>
    )
}

/** Android: current match, a pre-filled search row and large result rows with the source's cover. */
function MobileContent({ entry }: { entry: Manga_Entry }) {
    const t = useTr()
    const { selectedProvider } = useSelectedMangaProvider(entry.mediaId)
    const { getChapterPageUrl, isReady: imageProxyReady } = useMangaReaderUtils()
    const { data: existingMapping, isLoading: mappingLoading } = useGetMangaMapping({ provider: selectedProvider || undefined, mediaId: entry.mediaId })
    const { mutate: search, data: searchResults, isPending: searchLoading, isSuccess, isError, reset } = useMangaManualSearch(entry.mediaId, selectedProvider)
    // Sources answer "no results" with an error, so both end in the same hint.
    const searched = isSuccess || isError
    const { mutate: match, isPending: isMatching } = useMangaManualMapping()
    const { mutate: previewMapping, data: mappingPreview, isPending: previewLoading, reset: resetPreview } = usePreviewMangaMapping()
    const { mutate: unmatch, isPending: isUnmatching } = useRemoveMangaMapping()
    const [query, setQuery] = React.useState((entry.media?.title?.english || entry.media?.title?.romaji || entry.media?.title?.userPreferred || "").split(/[:：]/)[0].trim())
    const [selectedResult, setSelectedResult] = React.useState<HibikeManga_SearchResult | null>(null)
    const image = (item: HibikeManga_SearchResult) => item.image && imageProxyReady ? getChapterPageUrl(item.image, false, item.imageHeaders) : undefined

    const confirmMatch = useConfirmationDialog({
        title: t("Use this title?", "Diesen Titel verwenden?"),
        description: selectedResult && mappingPreview ? (
            <div className="space-y-2 text-left">
                <p>{selectedResult.title}</p>
                <p className="text-sm text-[--muted]">{t(`${mappingPreview.chapterCount} chapters · latest ${mappingPreview.latest || "unknown"}`,
                    `${mappingPreview.chapterCount} Kapitel · neuestes ${mappingPreview.latest || "unbekannt"}`)}</p>
                {!!mappingPreview.languages?.length && <p className="text-sm text-[--muted]">{mappingPreview.languages.join(", ")}</p>}
            </div>
        ) : t("Chapters of this manga will be loaded from the selected title.", "Die Kapitel dieses Manga werden vom gewählten Titel geladen."),
        actionText: t("Use title", "Titel verwenden"),
        actionIntent: "primary",
        onCancel: () => {
            resetPreview()
            setSelectedResult(null)
        },
        onConfirm: () => {
            if (!selectedResult || !selectedProvider) return
            match({ provider: selectedProvider, mediaId: entry.mediaId, mangaId: selectedResult.id })
            reset()
            resetPreview()
            setSelectedResult(null)
        },
    })

    const pick = (item: HibikeManga_SearchResult) => {
        if (!selectedProvider || previewLoading) return
        setSelectedResult(item)
        previewMapping({ provider: selectedProvider, mangaId: item.id }, {
            onSuccess: preview => {
                if (!preview?.chapterCount) {
                    toast.error(t("No chapters were found for this result", "Für diesen Treffer wurden keine Kapitel gefunden"))
                    setSelectedResult(null)
                    resetPreview()
                    return
                }
                React.startTransition(() => confirmMatch.open())
            },
            onError: () => setSelectedResult(null),
        })
    }

    return (
        <div className="mobile-match" data-mobile-manual-match>
            <div className="mobile-match-current" aria-live="polite">
                {mappingLoading ? <LoadingSpinner className="h-6 w-6" /> : existingMapping?.mangaId ? <>
                    <div className="min-w-0">
                        <span>{t("Matched to", "Zugeordnet zu")}</span>
                        <strong>{existingMapping.mangaId}</strong>
                    </div>
                    <button type="button" className="mobile-match-remove" disabled={isUnmatching || !selectedProvider}
                        onClick={() => selectedProvider && unmatch({ provider: selectedProvider, mediaId: entry.mediaId })}>
                        {t("Remove", "Entfernen")}
                    </button>
                </> : <div><span>{t("Currently", "Aktuell")}</span><strong>{t("Automatic match", "Automatische Zuordnung")}</strong></div>}
            </div>

            <form className="mobile-match-search" role="search" onSubmit={e => {
                e.preventDefault()
                if (selectedProvider && query.trim()) search({ provider: selectedProvider, query: query.trim() })
            }}>
                <FiSearch aria-hidden />
                <input value={query} onChange={e => setQuery(e.target.value)} enterKeyHint="search" aria-label={t("Title", "Titel")}
                    placeholder={t("Search title", "Titel suchen")} onKeyDown={e => e.stopPropagation()} />
                <button type="submit" disabled={!query.trim() || !selectedProvider || searchLoading || isMatching}>{t("Search", "Suchen")}</button>
            </form>

            {searchLoading ? <LoadingSpinner /> : searched && !searchResults?.length ? (
                <p className="mobile-match-empty">{t("No titles found. Try a shorter or English title.", "Keine Titel gefunden. Versuche einen kürzeren oder englischen Titel.")}</p>
            ) : !!searchResults?.length && (
                <ul className="mobile-match-results" aria-label={t("Search results", "Suchergebnisse")}>
                    {searchResults.map(item => <li key={item.id}>
                        <button type="button" onClick={() => pick(item)} disabled={previewLoading}>
                            {image(item) ? <img src={image(item)} alt="" className="mobile-match-thumb" loading="lazy" /> : <span className="mobile-match-thumb" aria-hidden />}
                            <span className="mobile-match-title">{item.title}{item.year ? <small>{item.year}</small> : null}</span>
                            {previewLoading && selectedResult?.id === item.id ? <LoadingSpinner className="h-5 w-5" /> : <LuChevronRight aria-hidden />}
                        </button>
                    </li>)}
                </ul>
            )}
            <ConfirmationDialog {...confirmMatch} />
        </div>
    )
}
