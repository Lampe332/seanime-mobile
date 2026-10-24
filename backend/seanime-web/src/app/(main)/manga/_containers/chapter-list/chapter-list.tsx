import { AL_MangaDetailsById_Media, HibikeManga_ChapterDetails, Manga_Entry, Manga_MediaDownloadData } from "@/api/generated/types"
import { useGetMangaSourceRefresh, useStartMangaSourceRefresh } from "@/api/hooks/manga.hooks"
import { SeaCommandInjectableItem, useSeaCommandInject } from "@/app/(main)/_features/sea-command/use-inject"
import { manga_downloadedChapterContainerAtom, MobileDownloadedChapters } from "@/app/(main)/manga/_containers/chapter-list/downloaded-chapter-list"
import { useMangaEntryDownloadedChapters } from "@/app/(main)/manga/_lib/handle-manga-downloads"
import { MangaManualMappingModal } from "@/app/(main)/manga/_containers/chapter-list/manga-manual-mapping-modal"
import { ChapterReaderDrawer } from "@/app/(main)/manga/_containers/chapter-reader/chapter-reader-drawer"
import { __manga_selectedChapterAtom } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import { __manga_resumeLocationsAtom } from "@/app/(main)/manga/_lib/manga-chapter-reader.atoms"
import { __manga_continueIntentAtom, getMangaResumeChapter, isMangaContinueIntentFor } from "@/app/(main)/manga/_lib/manga-continue"
import { useHandleMangaChapters } from "@/app/(main)/manga/_lib/handle-manga-chapters"
import { useHandleDownloadMangaChapter } from "@/app/(main)/manga/_lib/handle-manga-downloads"
import { __manga_preferencesHydratedAtom } from "@/app/(main)/manga/_lib/handle-manga-selected-provider"
import { getChapterNumberFromChapter, useMangaChapterListRowSelection, useMangaDownloadDataUtils } from "@/app/(main)/manga/_lib/handle-manga-utils"
import { LANGUAGES_LIST } from "@/app/(main)/manga/_lib/language-map"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { LuffyError } from "@/components/shared/luffy-error"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Select } from "@/components/ui/select"
import { useAtom, useAtomValue, useSetAtom } from "jotai/react"
import React from "react"
import { FaRedo } from "react-icons/fa"
import { LuDownload } from "react-icons/lu"
import { LuSearch } from "react-icons/lu"
import { MdOutlineOfflinePin } from "react-icons/md"
import { toast } from "sonner"
import { useTr } from "@/lib/app-language"
import { mobileMangaReadActionAtom } from "@/app/(main)/entry/_components/mobile-anime-header"
import { LuCheck, LuChevronDown } from "react-icons/lu"

const MOBILE_PAGE_SIZE = 30

type ChapterListProps = {
    mediaId: string | null
    entry: Manga_Entry
    details: AL_MangaDetailsById_Media | undefined
    downloadData: Manga_MediaDownloadData | undefined
    downloadDataLoading: boolean
}

export function ChapterList(props: ChapterListProps) {

    const {
        mediaId,
        entry,
        details,
        downloadData,
        downloadDataLoading,
        ...rest
    } = props

    /**
     * Find chapter container
     */
    const {
        selectedExtension,
        providerExtensionsLoading,
        // Selected provider
        providerOptions, // For dropdown
        selectedProvider, // Current provider (id)
        setSelectedProvider,
        // Filters
        selectedFilters,
        setSelectedLanguage,
        setSelectedScanlator,
        languageOptions,
        scanlatorOptions,
        // Chapters
        chapterContainer,
        chapterContainerLoading,
        chapterContainerError,
    } = useHandleMangaChapters(mediaId)


    // Keep track of chapter numbers as integers
    // This is used to filter the chapters
    // [id]: number
    const chapterIdToNumbersMap = React.useMemo(() => {
        const map = new Map<string, number>()

        for (const chapter of chapterContainer?.chapters ?? []) {
            map.set(chapter.id, getChapterNumberFromChapter(chapter.chapter))
        }

        return map
    }, [chapterContainer?.chapters])

    const [showUnreadChapter, setShowUnreadChapter] = React.useState(false)
    const [showDownloadedChapters] = React.useState(false)

    /**
     * Set selected chapter
     */
    const setSelectedChapter = useSetAtom(__manga_selectedChapterAtom)
    const { data: sourceRefreshJob } = useGetMangaSourceRefresh()
    const { mutate: startSourceRefresh, isPending: isStartingSourceRefresh } = useStartMangaSourceRefresh()
    const preferencesHydrated = useAtomValue(__manga_preferencesHydratedAtom)
    const sourceRefreshRunning = sourceRefreshJob?.status === "running" || sourceRefreshJob?.status === "stopping"
    const sourceRefreshEligible = entry.listData?.status === "CURRENT" || entry.listData?.status === "REPEATING"
    /**
     * Download chapter
     */
    const { downloadChapters, isSendingDownloadRequest } = useHandleDownloadMangaChapter(mediaId)
    /**
     * Download data utils
     */
    const {
        isChapterQueued,
        isChapterDownloaded,
        isChapterLocal,
    } = useMangaDownloadDataUtils(downloadData, downloadDataLoading)

    const { inject, remove } = useSeaCommandInject()
    const t = useTr()
    const [mobileVisible, setMobileVisible] = React.useState(MOBILE_PAGE_SIZE)
    // Android: online chapters and chapters on this device are two tabs, like Local library / Online streaming on anime pages.
    const [mobileTab, setMobileTab] = React.useState<"online" | "downloaded">("online")
    const savedChapters = useMangaEntryDownloadedChapters()

    /**
     * Function to filter unread chapters
     */
    const retainUnreadChapters = React.useCallback((chapter: HibikeManga_ChapterDetails) => {
        if (!entry.listData || !chapterIdToNumbersMap.has(chapter.id) || !entry.listData?.progress) return true

        const chapterNumber = chapterIdToNumbersMap.get(chapter.id)
        return !!chapterNumber && chapterNumber > entry.listData?.progress
    }, [chapterIdToNumbersMap, chapterContainer, entry])

    const unreadChapters = React.useMemo(() => chapterContainer?.chapters?.filter(ch => retainUnreadChapters(ch)) ?? [], [chapterContainer, entry])
    const resumeLocations = useAtomValue(__manga_resumeLocationsAtom)
    const resumeLocation = resumeLocations[String(mediaId)]
    const resumeChapter = React.useMemo(() => getMangaResumeChapter(unreadChapters, resumeLocation, selectedProvider, Date.now()),
        [resumeLocation, selectedProvider, unreadChapters])
    const readingChapter = resumeChapter || unreadChapters[0]
    const allChapters = React.useMemo(() => chapterContainer?.chapters?.toReversed() ?? [], [chapterContainer])
    const downloadableUnreadChapters = React.useMemo(() => unreadChapters.filter(chapter => {
        return !isChapterLocal(chapter) && !isChapterDownloaded(chapter) && !isChapterQueued(chapter)
    }), [unreadChapters, downloadData, isChapterDownloaded, isChapterLocal, isChapterQueued])

    const confirmDownloadUnread = useConfirmationDialog({
        title: "Download unread chapters",
        actionIntent: "primary",
        actionText: "Add to queue",
        description: `Add ${downloadableUnreadChapters.length} unread ${downloadableUnreadChapters.length === 1
            ? "chapter"
            : "chapters"} to the download queue?`,
        onConfirm: () => downloadChapters(downloadableUnreadChapters),
    })

    /**
     * Set "showUnreadChapter" state if there are unread chapters
     */
    React.useLayoutEffect(() => {
        setShowUnreadChapter(!!unreadChapters.length)
    }, [unreadChapters?.length])

    /**
     * Filter chapters based on state
     */
    const chapters = React.useMemo(() => {
        let d = showUnreadChapter ? unreadChapters : allChapters
        if (showDownloadedChapters) {
            d = d.filter(ch => isChapterDownloaded(ch) || isChapterQueued(ch))
        }
        return d
    }, [
        showUnreadChapter, unreadChapters, allChapters, showDownloadedChapters, downloadData, selectedExtension,
    ])

    const {
        resetRowSelection,
        // setSelectedChapters,
    } = useMangaChapterListRowSelection()

    React.useEffect(() => {
        resetRowSelection()
    }, [])

    // Inject chapter list command
    React.useEffect(() => {
        if (!chapterContainer?.chapters?.length) return

        const nextChapter = unreadChapters[0]
        const upcomingChapters = unreadChapters.slice(0, 10)

        const commandItems: SeaCommandInjectableItem[] = [
            // Next chapter
            ...(nextChapter ? [{
                data: nextChapter,
                id: `next-chapter-${nextChapter.id}`,
                value: `${nextChapter.chapter}`,
                heading: "Next Chapter",
                priority: 2,
                render: () => (
                    <div className="flex gap-1 items-center w-full">
                        <p className="max-w-[70%] truncate">Chapter {nextChapter.chapter}</p>
                        {nextChapter.scanlator && (
                            <p className="text-[--muted]">({nextChapter.scanlator})</p>
                        )}
                    </div>
                ),
                onSelect: ({ ctx }) => {
                    setSelectedChapter({
                        chapterId: nextChapter.id,
                        chapterNumber: nextChapter.chapter,
                        provider: nextChapter.provider,
                        mediaId: Number(mediaId),
                    })
                    ctx.close()
                },
            } as SeaCommandInjectableItem] : []),
            // Upcoming chapters
            ...upcomingChapters.map(chapter => ({
                data: chapter,
                id: `chapter-${chapter.id}`,
                value: `${chapter.chapter}`,
                heading: "Upcoming Chapters",
                priority: 1,
                render: () => (
                    <div className="flex gap-1 items-center w-full">
                        <p className="max-w-[70%] truncate">Chapter {chapter.chapter}</p>
                        {chapter.scanlator && (
                            <p className="text-[--muted]">({chapter.scanlator})</p>
                        )}
                    </div>
                ),
                onSelect: ({ ctx }) => {
                    setSelectedChapter({
                        chapterId: chapter.id,
                        chapterNumber: chapter.chapter,
                        provider: chapter.provider,
                        mediaId: Number(mediaId),
                    })
                    ctx.close()
                },
            } as SeaCommandInjectableItem)),
        ]

        inject("manga-chapters", {
            items: commandItems,
            filter: ({ item, input }) => {
                if (!input) return true
                return item.value.toLowerCase().includes(input.toLowerCase()) ||
                    (item.data.title?.toLowerCase() || "").includes(input.toLowerCase())
            },
            priority: 100,
        })

        return () => remove("manga-chapters")
    }, [chapterContainer?.chapters, unreadChapters, mediaId])

    const [downloadedChapterContainer] = useAtom(manga_downloadedChapterContainerAtom)

    // Android: the header shows this as the page's primary action.
    const setMobileReadAction = useSetAtom(mobileMangaReadActionAtom)
    React.useEffect(() => {
        setMobileReadAction(readingChapter ? {
            label: resumeChapter ? t("Resume reading", "Weiterlesen") : entry.listData?.progress ? t("Continue reading", "Weiterlesen") : t("Start reading", "Lesen beginnen"),
            detail: `${t("Chapter", "Kapitel")} ${readingChapter.chapter}${resumeChapter ? ` · ${t("Page", "Seite")} ${resumeLocation.pageIndex + 1}` : ""}`,
            onClick: () => setSelectedChapter({
                chapterId: readingChapter.id,
                chapterNumber: readingChapter.chapter,
                provider: readingChapter.provider,
                mediaId: Number(mediaId),
            }),
        } : null)
    }, [readingChapter, resumeChapter, resumeLocation, entry.listData?.progress, mediaId])
    React.useEffect(() => () => setMobileReadAction(null), [])

    // Android: "Continue reading" on the manga library opens the reading chapter once the source has answered.
    const [continueIntent, setContinueIntent] = useAtom(__manga_continueIntentAtom)
    React.useEffect(() => {
        if (!continueIntent) return
        // Another manga's or an expired intent never opens the reader here
        if (!isMangaContinueIntentFor(continueIntent, mediaId, Date.now())) return setContinueIntent(null)
        // Wait for the saved source (server preferences) and its chapters
        if (!preferencesHydrated || (!chapterContainer && !chapterContainerError)) return
        setContinueIntent(null)
        if (!readingChapter) return
        setSelectedChapter({
            chapterId: readingChapter.id,
            chapterNumber: readingChapter.chapter,
            provider: readingChapter.provider,
            mediaId: Number(mediaId),
        })
    }, [continueIntent, readingChapter, chapterContainer, chapterContainerError, preferencesHydrated, mediaId])
    React.useEffect(() => () => setContinueIntent(null), [])

    if (providerExtensionsLoading) return <LoadingSpinner />

    return (
        <div
            className="space-y-4"
            data-chapter-list-container
            data-selected-filters={JSON.stringify(selectedFilters)}
            data-selected-provider={JSON.stringify(selectedProvider)}
        >

            <div className="UI-StaticTabs__root mobile-manga-tabs" role="tablist" aria-label={t("Chapters", "Kapitel")}>
                {(["online", "downloaded"] as const).map(tab => <button key={tab} type="button" role="tab" className="UI-StaticTabs__trigger"
                    data-current={mobileTab === tab} aria-selected={mobileTab === tab} data-mobile-manga-tab={tab} onClick={() => setMobileTab(tab)}>
                    {tab === "online" ? t("Online reading", "Online lesen") : `${t("Downloaded", "Geladen")}${savedChapters.length ? ` · ${savedChapters.length}` : ""}`}
                </button>)}
            </div>

            {mobileTab === "downloaded" && <MobileDownloadedChapters entry={entry} />}

            {mobileTab === "online" && <section className="mobile-episode-options mobile-chapter-options" aria-label={t("Source & reading options", "Quelle & Leseoptionen")}>
                <div className="mobile-source-pair" role="group" aria-label={t("Source", "Quelle")}>
                    <Select
                        options={providerOptions}
                        value={selectedProvider || ""}
                        onValueChange={v => setSelectedProvider({ mId: mediaId, provider: v })}
                        disabled={sourceRefreshRunning}
                        aria-label={t("Source", "Quelle")}
                    />
                </div>
                {(selectedExtension?.settings?.supportsMultiLanguage || selectedExtension?.settings?.supportsMultiScanlator) &&
                    <div className="mobile-source-pair mobile-chapter-filter-pair" role="group" aria-label={t("Chapter filters", "Kapitelfilter")}>
                    {selectedExtension?.settings?.supportsMultiLanguage && <Select
                        options={languageOptions}
                        placeholder={t("All languages", "Alle Sprachen")}
                        value={selectedFilters.language}
                        onValueChange={v => setSelectedLanguage({ mId: mediaId, language: v })}
                        aria-label={t("Language", "Sprache")}
                    />}
                    {selectedExtension?.settings?.supportsMultiScanlator && <Select
                        options={scanlatorOptions}
                        placeholder={t("All scanlators", "Alle Scanlator")}
                        value={selectedFilters.scanlators[0] || ""}
                        onValueChange={v => setSelectedScanlator({ mId: mediaId, scanlators: [v] })}
                        aria-label={t("Scanlator", "Scanlator")}
                    />}
                </div>}
                <div className="mobile-source-more">
                    <Button
                        leftIcon={<FaRedo />}
                        intent="gray-basic"
                        size="sm"
                        onClick={() => {
                            if (mediaId) startSourceRefresh({ mode: "refresh_selected", mediaIds: [Number(mediaId)] }, {
                                onSuccess: () => toast.info(t("Source refresh started", "Quellen-Aktualisierung gestartet")),
                            })
                        }}
                        loading={isStartingSourceRefresh || sourceRefreshRunning}
                        disabled={!preferencesHydrated || !selectedExtension || !sourceRefreshEligible || sourceRefreshRunning}
                    >
                        {sourceRefreshRunning ? t("Refreshing …", "Wird aktualisiert …") : t("Refresh source", "Quelle aktualisieren")}
                    </Button>
                    <MangaManualMappingModal entry={entry}>
                        <Button leftIcon={<LuSearch />} intent="gray-basic" size="sm" disabled={!selectedExtension}>
                            {t("Manual match", "Manuell zuordnen")}
                        </Button>
                    </MangaManualMappingModal>
                </div>
            </section>}

            {mobileTab === "online" && !providerExtensionsLoading && !selectedExtension && (
                <Alert
                    intent="warning-basic"
                    title={selectedProvider ? "Saved source unavailable" : "No manga source available"}
                    description={selectedProvider
                        ? `The saved source “${selectedProvider}” is not currently installed. Install it again or choose another source to continue.`
                        : "Install or select a manga source to load chapters."}
                />
            )}

            {mobileTab === "downloaded" ? null : chapterContainerLoading ? <LoadingSpinner /> : (
                chapterContainerError ? <LuffyError title="No chapters found">
                    <MangaManualMappingModal entry={entry}>
                        <Button
                            leftIcon={<LuSearch className="text-lg" />}
                            intent="gray-outline"
                            size="md"
                        >
                            Manual match
                        </Button>
                    </MangaManualMappingModal>
                </LuffyError> : (
                    <>

                        {chapterContainer?.chapters?.length === 0 && (
                            <LuffyError title="No chapters found"><p>Try another source</p></LuffyError>
                        )}

                        {!!chapterContainer?.chapters?.length && (
                            <div className="mobile-chapters" data-mobile-chapters>
                                <div className="mobile-episode-heading">
                                    <h2>{t("Chapters", "Kapitel")} <span>{chapterContainer.chapters.length}</span></h2>
                                </div>
                                <div className="mobile-chapter-filters">
                                    <div className="mobile-source-segment" role="group" aria-label={t("Show chapters", "Kapitel anzeigen")}>
                                        <button type="button" aria-pressed={showUnreadChapter} onClick={() => { setShowUnreadChapter(true); setMobileVisible(MOBILE_PAGE_SIZE) }}>
                                            {t("Unread", "Ungelesen")} · {unreadChapters.length}
                                        </button>
                                        <button type="button" aria-pressed={!showUnreadChapter} onClick={() => { setShowUnreadChapter(false); setMobileVisible(MOBILE_PAGE_SIZE) }}>
                                            {t("All", "Alle")}
                                        </button>
                                    </div>
                                </div>
                                {!chapters.length && <p className="mobile-chapter-empty">{showDownloadedChapters
                                    ? t("No downloaded chapters here.", "Hier sind keine Kapitel geladen.")
                                    : t("All chapters are read.", "Alle Kapitel sind gelesen.")}</p>}
                                <ul className="mobile-chapter-list" aria-label={t("Chapters", "Kapitel")}>
                                    {chapters.slice(0, mobileVisible).map(chapter => {
                                        const downloaded = isChapterDownloaded(chapter)
                                        const queued = isChapterQueued(chapter)
                                        const canDownload = !isChapterLocal(chapter) && !downloaded && !queued
                                        const language = chapter.language ? LANGUAGES_LIST[chapter.language]?.nativeName || chapter.language : null
                                        return <li key={chapter.id} data-mobile-chapter={chapter.chapter} data-read={!retainUnreadChapters(chapter) || undefined}>
                                            <button type="button" className="mobile-chapter-open"
                                                onClick={() => setSelectedChapter({
                                                    chapterId: chapter.id,
                                                    chapterNumber: chapter.chapter,
                                                    provider: chapter.provider,
                                                    mediaId: Number(mediaId),
                                                })}>
                                                {/* Titles that only repeat the number ("Chapter 2") don't get the number again underneath. */}
                                                <span className="mobile-chapter-title">{chapter.title || `${t("Chapter", "Kapitel")} ${chapter.chapter}`}</span>
                                                <span className="mobile-chapter-meta">{[
                                                    !chapter.title || chapter.title.trim().toLowerCase().replace(/^(chapter|ch\.?|kapitel)\s*/, "") === String(chapter.chapter).toLowerCase()
                                                        ? null : `${t("Chapter", "Kapitel")} ${chapter.chapter}`,
                                                    chapter.scanlator, selectedExtension?.settings?.supportsMultiLanguage ? language : null,
                                                ].filter(Boolean).join(" · ")}</span>
                                            </button>
                                            {canDownload && <button type="button" className="mobile-chapter-action" disabled={isSendingDownloadRequest}
                                                aria-label={t(`Download chapter ${chapter.chapter}`, `Kapitel ${chapter.chapter} laden`)} onClick={() => downloadChapters([chapter])}>
                                                <LuDownload aria-hidden />
                                            </button>}
                                            {queued && <span className="mobile-chapter-state">{t("Queued", "Eingeplant")}</span>}
                                            {downloaded && <span className="mobile-chapter-state mobile-chapter-state-saved" aria-label={t("Downloaded", "Geladen")}><MdOutlineOfflinePin aria-hidden /></span>}
                                        </li>
                                    })}
                                </ul>
                                {chapters.length > mobileVisible && <button type="button" className="mobile-chapter-more" onClick={() => setMobileVisible(v => v + MOBILE_PAGE_SIZE)}>
                                    <LuChevronDown aria-hidden />{t(`Show more (${chapters.length - mobileVisible})`, `Mehr anzeigen (${chapters.length - mobileVisible})`)}
                                </button>}
                                {!downloadDataLoading && !!downloadableUnreadChapters.length && <button type="button" className="mobile-chapter-download-unread"
                                    disabled={isSendingDownloadRequest} onClick={() => confirmDownloadUnread.open()}>
                                    <LuDownload aria-hidden />{t(`Download unread (${downloadableUnreadChapters.length})`, `Ungelesene laden (${downloadableUnreadChapters.length})`)}
                                </button>}
                            </div>
                        )}
                    </>
                )
            )}

            {(chapterContainer || downloadedChapterContainer) && <ChapterReaderDrawer
                entry={entry}
                chapterContainer={chapterContainer || downloadedChapterContainer!}
                chapterIdToNumbersMap={chapterIdToNumbersMap}
            />}

            <ConfirmationDialog {...confirmDownloadUnread} />
        </div>
    )
}
