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
import { imageShimmer } from "@/components/shared/image-helpers"
import { SeaImage } from "@/components/shared/sea-image"
import { AppLayoutStack } from "@/components/ui/app-layout"
import { Button } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { defineSchema, Field, Form, InferType } from "@/components/ui/form"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Modal } from "@/components/ui/modal"
import { Separator } from "@/components/ui/separator"
import { Tooltip } from "@/components/ui/tooltip"
import { useRouter } from "@/lib/navigation"
import { useTr } from "@/lib/app-language"
import React from "react"
import { FiSearch } from "react-icons/fi"
import { LuChevronRight } from "react-icons/lu"
import { toast } from "sonner"

const IS_ANDROID_APP = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile"

type MangaManualMappingModalProps = {
    entry: Manga_Entry
    children: React.ReactElement
}

export function MangaManualMappingModal(props: MangaManualMappingModalProps) {

    const {
        children,
        entry,
        ...rest
    } = props

    const t = useTr()

    // Android: same bottom sheet as the anime page's manual match.
    if (IS_ANDROID_APP) return (
        <Modal
            data-manga-manual-mapping-modal
            title={t("Manual match", "Manuell zuordnen")}
            description={t("Pick the matching title from the selected source.", "Wähle den passenden Titel der gewählten Quelle.")}
            trigger={children}
            contentClass="mobile-anime-dialog mobile-download-sheet mobile-match-sheet"
        >
            <MobileContent entry={entry} />
        </Modal>
    )

    return (
        <>
            <Modal
                data-manga-manual-mapping-modal
                title="Manual match"
                description="Match this manga to a search result"
                trigger={children}
                contentClass="max-w-4xl"
            >
                <Content entry={entry} />
            </Modal>
        </>
    )
}

const searchSchema = defineSchema(({ z }) => z.object({
    query: z.string().min(1),
}))

function Content({ entry }: { entry: Manga_Entry }) {
    const router = useRouter()
    const { selectedProvider } = useSelectedMangaProvider(entry.mediaId)
    const { getChapterPageUrl, isReady: imageProxyReady } = useMangaReaderUtils()

    // Get current mapping
    const { data: existingMapping, isLoading: mappingLoading } = useGetMangaMapping({
        provider: selectedProvider || undefined,
        mediaId: entry.mediaId,
    })

    // Search
    const { mutate: search, data: searchResults, isPending: searchLoading, reset } = useMangaManualSearch(entry.mediaId, selectedProvider)

    function handleSearch(data: InferType<typeof searchSchema>) {
        if (selectedProvider) {
            search({
                provider: selectedProvider,
                query: data.query,
            })
        }
    }

    const getSearchResultImageUrl = React.useCallback((image: string | undefined, headers?: Record<string, string>) => {
        if (!image) return "/no-cover.png"
        return imageProxyReady ? getChapterPageUrl(image, false, headers) : "/no-cover.png"
    }, [getChapterPageUrl, imageProxyReady])

    // Match
    const { mutate: match, isPending: isMatching } = useMangaManualMapping()
    const {
        mutate: previewMapping,
        data: mappingPreview,
        isPending: previewLoading,
        reset: resetPreview,
    } = usePreviewMangaMapping()

    // Unmatch
    const { mutate: unmatch, isPending: isUnmatching } = useRemoveMangaMapping()

    const [selectedResult, setSelectedResult] = React.useState<HibikeManga_SearchResult | null>(null)
    const confirmMatch = useConfirmationDialog({
        title: "Manual match",
        description: selectedResult && mappingPreview ? (
            <div className="space-y-3 text-left">
                <p>Match this entry to <span className="font-medium">{selectedResult.title}</span>?</p>
                <div className="grid grid-cols-2 gap-3 rounded-[--radius-md] border p-3 text-sm">
                    <div>
                        <p className="text-[--muted]">Distinct chapters</p>
                        <p className="font-medium">{mappingPreview.chapterCount}</p>
                    </div>
                    <div>
                        <p className="text-[--muted]">Latest chapter</p>
                        <p className="font-medium">{mappingPreview.latest || "Unknown"}</p>
                    </div>
                </div>
                {!!mappingPreview.languages?.length && (
                    <p className="text-sm"><span className="text-[--muted]">Languages:</span> {mappingPreview.languages.join(", ")}</p>
                )}
                {!!mappingPreview.scanlators?.length && (
                    <p className="text-sm"><span className="text-[--muted]">Scanlators:</span> {mappingPreview.scanlators.join(", ")}</p>
                )}
            </div>
        ) : "Review the provider result before saving this match.",
        actionText: "Confirm",
        actionIntent: "success",
        onCancel: () => {
            resetPreview()
            setSelectedResult(null)
        },
        onConfirm: () => {
            if (selectedResult && selectedProvider) {
                match({
                    provider: selectedProvider,
                    mediaId: entry.mediaId,
                    mangaId: selectedResult.id,
                })
                reset()
                resetPreview()
                setSelectedResult(null)
            }
        },
    })

    return (
        <>
            {mappingLoading ? (
                <LoadingSpinner />
            ) : (
                <AppLayoutStack>
                    <div className="text-center">
                        {!!existingMapping?.mangaId ? (
                            <AppLayoutStack>
                                <p>
                                    Current mapping: <span>{existingMapping.mangaId}</span>
                                </p>
                                <Button
                                    intent="alert-subtle" loading={isUnmatching} onClick={() => {
                                    if (selectedProvider) {
                                        unmatch({
                                            provider: selectedProvider,
                                            mediaId: entry.mediaId,
                                        })
                                    }
                                }}
                                >
                                    Remove mapping
                                </Button>
                            </AppLayoutStack>
                        ) : (
                            <p className="text-[--muted] italic">No manual match</p>
                        )}
                    </div>

                    <Separator />

                    <Form schema={searchSchema} onSubmit={handleSearch}>
                        <div className="flex gap-2 items-center">
                            <Field.Text
                                name="query"
                                placeholder="Enter a title..."
                                leftIcon={<FiSearch className="text-xl text-[--muted]" />}
                                fieldClass="w-full"
                            />

                            <Field.Submit
                                intent="white"
                                loading={isMatching || previewLoading || searchLoading || mappingLoading}
                                className=""
                            >Search</Field.Submit>
                        </div>
                    </Form>

                    {searchLoading ? <LoadingSpinner /> : (
                        <>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                                {searchResults?.map(item => (
                                    <div
                                        key={item.id}
                                        className={cn(
                                            "group/sr-item col-span-1 aspect-[6/7] rounded-[--radius-md] relative bg-[--background] cursor-pointer transition-opacity",
                                        )}
                                        onClick={() => {
                                            if (!selectedProvider || previewLoading) return
                                            setSelectedResult(item)
                                            previewMapping({ provider: selectedProvider, mangaId: item.id }, {
                                                onSuccess: preview => {
                                                    if (!preview?.chapterCount) {
                                                        toast.error("No chapters were found for this result")
                                                        setSelectedResult(null)
                                                        resetPreview()
                                                        return
                                                    }
                                                    React.startTransition(() => confirmMatch.open())
                                                },
                                                onError: () => setSelectedResult(null),
                                            })
                                        }}
                                    >

                                        {<SeaImage
                                            src={getSearchResultImageUrl(item.image, item.imageHeaders)}
                                            placeholder={imageShimmer(700, 475)}
                                            sizes="10rem"
                                            fill
                                            alt=""
                                            className={cn(
                                                "object-center object-cover lg:opacity-50 rounded-[--radius-md] transition-opacity lg:group-hover/sr-item:opacity-100",
                                            )}
                                        />}
                                        {/*<Badge intent="gray-solid" size="sm" className="absolute text-sm top-1 left-1">*/}
                                        {/*    {item.id}*/}
                                        {/*</Badge>*/}
                                        <Tooltip
                                            trigger={<p className="line-clamp-2 text-sm absolute m-2 bottom-0 font-semibold z-[10]">
                                                {item.title} {item.year && `(${item.year})`}
                                            </p>}
                                            className="z-[150]"
                                        >
                                            <p>
                                                {item.title} {item.year && `(${item.year})`}
                                            </p>
                                        </Tooltip>
                                        <div
                                            className="z-[5] absolute rounded-br-md rounded-bl-md bottom-0 w-full h-[80%] bg-gradient-to-t from-[--background] to-transparent"
                                        />
                                        {previewLoading && selectedResult?.id === item.id && (
                                            <LoadingSpinner containerClass="absolute inset-0 z-[20] bg-[--background]/70" />
                                        )}
                                        {/*<div*/}
                                        {/*    className={cn(*/}
                                        {/*        "z-[5] absolute top-0 w-full h-[80%] bg-gradient-to-b from-[--background] to-transparent transition-opacity",*/}
                                        {/*    )}*/}
                                        {/*/>*/}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                </AppLayoutStack>
            )}

            <ConfirmationDialog {...confirmMatch} />
        </>
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
