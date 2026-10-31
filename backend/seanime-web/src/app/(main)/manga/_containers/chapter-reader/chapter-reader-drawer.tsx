import { AL_BaseManga, Manga_ChapterContainer, Manga_EntryListData } from "@/api/generated/types"
import { useGetMangaEntryPages, useUpdateMangaProgress } from "@/api/hooks/manga.hooks"
import { useSeaCommandInject } from "@/app/(main)/_features/sea-command/use-inject"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { MangaHorizontalReader } from "@/app/(main)/manga/_containers/chapter-reader/_components/chapter-horizontal-reader"
import { MangaVerticalReader } from "@/app/(main)/manga/_containers/chapter-reader/_components/chapter-vertical-reader"
import { MangaReaderActionDisplay } from "@/app/(main)/manga/_containers/chapter-reader/manga-reader-action-display"
import { MangaReaderBar } from "@/app/(main)/manga/_containers/chapter-reader/manga-reader-bar"
import { __manga__readerSettingsDrawerOpen } from "@/app/(main)/manga/_containers/chapter-reader/chapter-reader-settings"
import {
    useCurrentChapter,
    useEffectiveReadingMode,
    useHandleChapterPagination,
    useSetCurrentChapter,
    useSwitchSettingsWithKeys,
} from "@/app/(main)/manga/_lib/handle-chapter-reader"
import { useDiscordMangaPresence } from "@/app/(main)/manga/_lib/handle-discord-manga-presence"
import {
    __manga_currentPageIndexAtom,
    __manga_currentPaginationMapIndexAtom,
    __manga_hiddenBarAtom,
    __manga_isLastPageAtom,
    __manga_kbsChapterLeft,
    __manga_kbsChapterRight,
    __manga_paginationMapAtom,
    __manga_readingDirectionAtom,
    __manga_readingModeAtom,
    __manga_resumeLocationsAtom,
    cleanupMangaResumeLocations,
    MangaReadingDirection,
    MangaReadingMode,
} from "@/app/(main)/manga/_lib/manga-chapter-reader.atoms"
import { PhoneEmpty } from "@/app/(main)/_features/phone-screen/phone-screen"
import { Button, IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { Drawer } from "@/components/ui/drawer"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { useAtom, useAtomValue, useSetAtom } from "jotai/react"
import mousetrap from "mousetrap"
import React from "react"
import { LuRefreshCw } from "react-icons/lu"
import { TbLayoutBottombarExpandFilled } from "react-icons/tb"
import { __manga_keepScreenOnAtom, __manga_readerBackgroundAtom, __manga_readerBrightnessAtom } from "@/app/(main)/manga/_lib/manga-chapter-reader.atoms"

const READER_BACKGROUNDS = { black: "#000", gray: "#1c1c1f", white: "#f4f4f5" }
import { toast } from "sonner"
import { shouldForceLandscape } from "@/app/(main)/manga/_lib/reader-mode"
import { useTr } from "@/lib/app-language"
import { IS_TABLET_UI } from "@/lib/tablet-ui"

type ChapterDrawerProps = {
    entry: { media?: AL_BaseManga | undefined, mediaId: number, listData?: Manga_EntryListData }
    chapterContainer: Manga_ChapterContainer
    chapterIdToNumbersMap: Map<string, number>
}


export function ChapterReaderDrawer(props: ChapterDrawerProps) {

    const {
        entry,
        chapterContainer,
        chapterIdToNumbersMap,
        ...rest
    } = props

    const serverStatus = useServerStatus()
    const t = useTr()

    // Discord rich presence
    useDiscordMangaPresence(entry)

    const currentChapter = useCurrentChapter()
    const setCurrentChapter = useSetCurrentChapter()

    const [cursorHidden, setCursorHidden] = React.useState(false)

    React.useEffect(() => {
        setCursorHidden(false)
        if (!currentChapter) return

        let timer: ReturnType<typeof setTimeout>
        const reset = (event?: PointerEvent) => {
            clearTimeout(timer)
            setCursorHidden(false)
            if (!event?.buttons) {
                timer = setTimeout(() => setCursorHidden(true), 1_000)
            }
        }

        reset()
        window.addEventListener("pointermove", reset)
        window.addEventListener("pointerdown", reset)
        window.addEventListener("pointerup", reset)
        return () => {
            clearTimeout(timer)
            window.removeEventListener("pointermove", reset)
            window.removeEventListener("pointerdown", reset)
            window.removeEventListener("pointerup", reset)
        }
    }, [currentChapter])

    const currentPageIndex = useAtomValue(__manga_currentPageIndexAtom)
    const setCurrentPageIndex = useSetAtom(__manga_currentPageIndexAtom)
    const setCurrentPaginationMapIndex = useSetAtom(__manga_currentPaginationMapIndexAtom)
    const setIsLastPage = useSetAtom(__manga_isLastPageAtom)

    const [readingMode, setReadingMode] = useAtom(__manga_readingModeAtom)
    // "Automatic" (tablet) lays out a double page in wide landscape and a single page otherwise, without turning the device
    const effectiveMode = useEffectiveReadingMode()
    const [settingsOpen, setSettingsOpen] = useAtom(__manga__readerSettingsDrawerOpen)

    React.useEffect(() => {
        const bridge = (window as any).OrientationBridge
        // Phones turn to landscape for a double page; tablets never get turned
        bridge?.setLandscape?.(!!currentChapter && shouldForceLandscape(readingMode, IS_TABLET_UI))
        return () => bridge?.setLandscape?.(false)
    }, [!!currentChapter, readingMode])

    React.useEffect(() => {
        if (!currentChapter) return
        const onAndroidBack = (event: Event) => {
            event.preventDefault()
            if (settingsOpen) setSettingsOpen(false)
            else setCurrentChapter(undefined)
        }
        window.addEventListener("seanime:android-back", onAndroidBack)
        return () => window.removeEventListener("seanime:android-back", onAndroidBack)
    }, [currentChapter, settingsOpen, setCurrentChapter, setSettingsOpen])
    const isLastPage = useAtomValue(__manga_isLastPageAtom)
    const kbsChapterLeft = useAtomValue(__manga_kbsChapterLeft)
    const kbsChapterRight = useAtomValue(__manga_kbsChapterRight)
    const paginationMap = useAtomValue(__manga_paginationMapAtom)
    const readingDirection = useAtomValue(__manga_readingDirectionAtom)

    const [hiddenBar, setHideBar] = useAtom(__manga_hiddenBarAtom)
    const keepScreenOn = useAtomValue(__manga_keepScreenOnAtom)
    const readerBackground = useAtomValue(__manga_readerBackgroundAtom)
    const readerBrightness = useAtomValue(__manga_readerBrightnessAtom)

    // Android: keep the screen on while a chapter is open (Screen Wake Lock); the lock is released when Android
    // hides the app, so it is requested again whenever the reader becomes visible.
    React.useEffect(() => {
        if (!keepScreenOn || !currentChapter || !("wakeLock" in navigator)) return
        let lock: { release: () => Promise<void> } | null = null
        let cancelled = false
        const request = () => {
            if (document.visibilityState !== "visible") return
            ;(navigator as any).wakeLock.request("screen").then((l: any) => {
                if (cancelled) l.release()
                else lock = l
            }).catch(() => {})
        }
        request()
        document.addEventListener("visibilitychange", request)
        return () => {
            cancelled = true
            document.removeEventListener("visibilitychange", request)
            lock?.release().catch(() => {})
        }
    }, [keepScreenOn, !!currentChapter])

    // resume locations
    const [resumeLocations, setResumeLocations] = useAtom(__manga_resumeLocationsAtom)

    const currentMediaResumeKey = React.useMemo(() => {
        if (!currentChapter) return undefined
        return String(currentChapter.mediaId)
    }, [currentChapter])

    const currentChapterResumeKey = React.useMemo(() => {
        if (!currentChapter) return undefined
        return `${currentChapter.mediaId}:${currentChapter.provider}:${currentChapter.chapterId}`
    }, [currentChapter])

    const currentResumeLocation = React.useMemo(() => {
        if (!currentMediaResumeKey) return undefined
        return resumeLocations[currentMediaResumeKey]
    }, [currentMediaResumeKey, resumeLocations])

    const shouldRestoreSavedPage = React.useMemo(() => {
        if (!currentChapter || !currentResumeLocation) return false
        return (
            currentResumeLocation.chapterId === currentChapter.chapterId
            && currentResumeLocation.provider === currentChapter.provider
        )
    }, [currentChapter, currentResumeLocation])

    const restoredChapterResumeKeyRef = React.useRef<string | null>(null)

    useSwitchSettingsWithKeys()

    React.useEffect(() => {
        setResumeLocations(prev => cleanupMangaResumeLocations(prev))
    }, [])

    const { inject, remove } = useSeaCommandInject()

    /**
     * Get the pages
     */
    const {
        data: pageContainer,
        isLoading: pageContainerLoading,
        isError: pageContainerError,
        refetch: retryFetchPageContainer,
    } = useGetMangaEntryPages({
        mediaId: entry?.media?.id,
        chapterId: currentChapter?.chapterId,
        // provider: chapterContainer.provider as Manga_Provider,
        provider: currentChapter?.provider,
        doublePage: effectiveMode === MangaReadingMode.DOUBLE_PAGE,
    })

    /**
     * Update the progress when the user confirms
     */
    const { mutate: updateProgress, isPending: isUpdatingProgress } = useUpdateMangaProgress(entry.mediaId)

    /**
     * Switch back to PAGED mode if the page dimensions could not be fetched efficiently
     */
    React.useEffect(() => {
        if (currentChapter) {
            if (
                readingMode === MangaReadingMode.DOUBLE_PAGE &&
                !pageContainerLoading &&
                !pageContainerError &&
                (!pageContainer?.pageDimensions || Object.keys(pageContainer.pageDimensions).length === 0)
            ) {
                toast.error(t("Could not get page dimensions from this provider. Switching to single page.", "Seitengrößen von dieser Quelle nicht verfügbar. Wechsle zu Einzelseite."))
                setReadingMode(MangaReadingMode.PAGED)
            }
        }
    }, [currentChapter, pageContainer, pageContainerLoading, pageContainerError, readingMode])


    /**
     * Get the previous and next chapters
     * Either can be undefined
     */
    const { previousChapter, nextChapter, goToChapter } = useHandleChapterPagination(entry.mediaId, chapterContainer)

    /**
     * Check if the progress should be updated
     * i.e. User progress is less than the current chapter number
     */
    const shouldUpdateProgress = React.useMemo(() => {
        const currentChapterNumber = chapterIdToNumbersMap.get(currentChapter?.chapterId || "")
        if (!currentChapterNumber) return false
        if (!entry.listData?.progress) return true
        return currentChapterNumber > entry.listData.progress
    }, [chapterIdToNumbersMap, entry, currentChapter])

    const handleUpdateProgress = (goToNext: boolean = true) => {
        if (shouldUpdateProgress && !isUpdatingProgress) {

            updateProgress({
                chapterNumber: chapterIdToNumbersMap.get(currentChapter?.chapterId || "") || 0,
                mediaId: entry.mediaId,
                malId: entry.media?.idMal || undefined,
                totalChapters: entry.media?.chapters || 0,
            }, {
                onSuccess: () => {
                    if (goToNext) {
                        goToChapter("next")
                    }
                },
            })

        }
    }

    /**
     * Handle auto-updating progress
     */
    const lastUpdatedChapterRef = React.useRef<string | null>(null)
    React.useEffect(() => {
            if (
                serverStatus?.settings?.manga?.mangaAutoUpdateProgress
                && currentChapter?.chapterId
                && shouldUpdateProgress
                && !pageContainerLoading
                && !pageContainerError
                && isLastPage
            ) {
                if (lastUpdatedChapterRef.current !== currentChapter?.chapterId) {
                    handleUpdateProgress(false)
                    lastUpdatedChapterRef.current = currentChapter?.chapterId
                }
            }
        },
        [currentChapter, serverStatus?.settings?.manga?.mangaAutoUpdateProgress, shouldUpdateProgress, isLastPage, pageContainerError,
            pageContainerLoading])

    /**
     * Restore the saved page when the user opens a chapter
     * This runs before the new page container settles so horizontal mode can hydrate the right map index
     */
    React.useEffect(() => {
        if (!currentChapterResumeKey) {
            restoredChapterResumeKeyRef.current = null
            setIsLastPage(false)
            setCurrentPageIndex(0)
            setCurrentPaginationMapIndex(0)
            return
        }

        restoredChapterResumeKeyRef.current = null
        setIsLastPage(false)
        setCurrentPageIndex(shouldRestoreSavedPage ? currentResumeLocation?.pageIndex ?? 0 : 0)
        setCurrentPaginationMapIndex(0)
    }, [currentChapterResumeKey])

    /**
     * Clamp the restored page once the chapter pages are available
     * Providers can return a different page count between sessions
     */
    React.useEffect(() => {
        if (!currentChapterResumeKey || pageContainerLoading || pageContainerError || !pageContainer?.pages?.length) return
        if (restoredChapterResumeKeyRef.current === currentChapterResumeKey) return

        const maxPageIndex = pageContainer.pages.length - 1
        const savedPageIndex = shouldRestoreSavedPage ? currentResumeLocation?.pageIndex ?? 0 : 0
        const nextPageIndex = Math.min(savedPageIndex, maxPageIndex)

        // Wait for the restored index to reach the next render before enabling autosave.
        // Effects in this render still see the previous chapter's index (usually zero).
        if (currentPageIndex !== nextPageIndex) {
            setCurrentPageIndex(nextPageIndex)
            return
        }
        restoredChapterResumeKeyRef.current = currentChapterResumeKey

        if (savedPageIndex !== nextPageIndex && currentMediaResumeKey && currentChapter) {
            setResumeLocations(prev => cleanupMangaResumeLocations({
                ...prev,
                [currentMediaResumeKey]: {
                    chapterId: currentChapter.chapterId,
                    provider: currentChapter.provider,
                    pageIndex: nextPageIndex,
                    updatedAt: Date.now(),
                },
            }))
        }
    }, [
        currentChapterResumeKey,
        currentMediaResumeKey,
        currentResumeLocation,
        currentChapter,
        currentPageIndex,
        pageContainer?.pages,
        pageContainerError,
        pageContainerLoading,
        shouldRestoreSavedPage,
    ])

    /**
     * Autosave the current page after the chapter resume point has been restored
     */
    React.useEffect(() => {
        if (!currentChapterResumeKey || !currentMediaResumeKey || !currentChapter || pageContainerLoading || pageContainerError || !pageContainer?.pages?.length) return
        if (restoredChapterResumeKeyRef.current !== currentChapterResumeKey) return
        if (currentPageIndex < 0 || currentPageIndex > pageContainer.pages.length - 1) return

        setResumeLocations(prev => {
            const currentLocation = prev[currentMediaResumeKey]
            if (
                currentLocation?.chapterId === currentChapter.chapterId
                && currentLocation?.provider === currentChapter.provider
                && currentLocation?.pageIndex === currentPageIndex
            ) {
                return prev
            }

            return cleanupMangaResumeLocations({
                ...prev,
                [currentMediaResumeKey]: {
                    chapterId: currentChapter.chapterId,
                    provider: currentChapter.provider,
                    pageIndex: currentPageIndex,
                    updatedAt: Date.now(),
                },
            })
        })
    }, [
        currentChapterResumeKey,
        currentMediaResumeKey,
        currentChapter,
        currentPageIndex,
        pageContainer?.pages,
        pageContainerError,
        pageContainerLoading,
    ])

    // Progress update keyboard shortcuts
    React.useEffect(() => {
        mousetrap.bind("u", () => {
            handleUpdateProgress()
        })

        return () => {
            mousetrap.unbind("u")
        }
    }, [pageContainer?.pages, chapterContainer?.chapters, shouldUpdateProgress, isLastPage])

    // Hide bar shortcut
    React.useEffect(() => {
        mousetrap.bind("b", () => {
            setHideBar((prev) => !prev)
        })

        return () => {
            mousetrap.unbind("b")
        }
    }, [])

    // Navigation
    React.useEffect(() => {
        mousetrap.bind(kbsChapterLeft, () => {
            if (readingDirection === MangaReadingDirection.LTR) {
                goToChapter("previous")
            } else {
                goToChapter("next")
            }
        })
        mousetrap.bind(kbsChapterRight, () => {
            if (readingDirection === MangaReadingDirection.RTL) {
                goToChapter("previous")
            } else {
                goToChapter("next")
            }
        })

        return () => {
            mousetrap.unbind(kbsChapterLeft)
            mousetrap.unbind(kbsChapterRight)
        }
    }, [kbsChapterLeft, kbsChapterRight, paginationMap, readingDirection, chapterContainer, previousChapter, nextChapter])

    // Inject close reader command
    React.useEffect(() => {
        if (!currentChapter) return

        inject("close-manga-reader", {
            items: [{
                id: "close-reader",
                value: "Close reader",
                heading: "Reader",
                priority: 100,
                render: () => (
                    <div className="flex gap-1 items-center w-full">
                        <p>Close reader</p>
                    </div>
                ),
                onSelect: () => setCurrentChapter(undefined),
            }],
            filter: ({ item, input }) => {
                if (!input) return true
                return item.value.toLowerCase().includes(input.toLowerCase())
            },
            priority: 105,
        })

        return () => remove("close-manga-reader")
    }, [currentChapter])

    return (
        <Drawer
            data-chapter-reader-drawer
            open={!!currentChapter}
            onOpenChange={() => setCurrentChapter(undefined)}
            size="full"
            side="bottom"
            headerClass="absolute h-0"
            contentClass={cn(
                "p-0 pt-0 !m-0 !rounded-none overflow-hidden [--manga-controls-height:3.5rem] lg:[--manga-controls-height:3rem]",
                "w-full inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            )}
            hideCloseButton
            borderToBorder
        >

            <div
                data-chapter-reader-drawer-progress-container
                className={cn(
                    "fixed left-0 w-full z-[6] opacity-0 transition-opacity hidden duration-500",
                    "top-0 justify-center",
                    (shouldUpdateProgress && isLastPage && !pageContainerLoading && !pageContainerError) && "flex opacity-100",
                )}
                tabIndex={-1}
            >
                <Button
                    onClick={() => handleUpdateProgress()}
                    className="rounded-tl-none rounded-tr-none"
                    size="md"
                    intent="success"
                    loading={isUpdatingProgress}
                    disabled={isUpdatingProgress}
                >
                    {t("Update progress", "Fortschritt speichern")} ({chapterIdToNumbersMap.get(currentChapter?.chapterId || "")} / {entry?.media?.chapters || "-"})
                </Button>
            </div>

            {/*Exit fullscreen button*/}
            {hiddenBar && <div data-chapter-reader-drawer-exit-fullscreen-button className="fixed right-0 bottom-4 group/hiddenBarArea z-[10] px-4">
                <IconButton
                    rounded
                    icon={<TbLayoutBottombarExpandFilled />}
                    intent="white-outline"
                    size="sm"
                    onClick={() => setHideBar(false)}
                    aria-label="Show reading controls"
                    title="Show reading controls"
                    className="h-11 w-11 lg:opacity-0 opacity-80 group-hover/hiddenBarArea:opacity-100 transition-opacity duration-200"
                />
            </div>}

            <MangaReaderBar
                previousChapter={previousChapter}
                nextChapter={nextChapter}
                goToChapter={goToChapter}
                pageContainer={pageContainer}
                entry={entry}
            />


            {readerBrightness < 100 && <div data-reader-dim className="fixed inset-0 z-[9] pointer-events-none bg-black"
                style={{ opacity: (100 - readerBrightness) / 100 }} />}

            <div
                data-chapter-reader-drawer-content
                style={{ background: READER_BACKGROUNDS[readerBackground] ?? "#000" }}
                className={cn(
                    "max-h-[calc(100dvh-3.5rem)] lg:max-h-[calc(100dvh-3rem)] h-full overflow-hidden",
                    hiddenBar && "max-h-dvh",
                    cursorHidden && !pageContainerLoading && !pageContainerError && "cursor-none [&_*]:!cursor-none",
                )} tabIndex={-1}
            >
                <MangaReaderActionDisplay />

                {pageContainerError ? (
                    <div className="reader-error">
                        <PhoneEmpty title={t("Pages could not be loaded", "Seiten konnten nicht geladen werden")} data-reader-error
                            text={t("Try again, or change the source on the manga's page.", "Versuch es erneut oder wechsle auf der Seite des Manga die Quelle.")}>
                            <button type="button" className="ps-primary" onClick={() => retryFetchPageContainer()} data-reader-retry>
                                <LuRefreshCw aria-hidden />{t("Try again", "Erneut versuchen")}
                            </button>
                            <button type="button" className="ps-secondary" onClick={() => setCurrentChapter(undefined)} data-reader-error-close>
                                {t("Close chapter", "Kapitel schließen")}
                            </button>
                        </PhoneEmpty>
                    </div>
                ) : (pageContainerLoading)
                    ? (<LoadingSpinner containerClass="h-full" />)
                    : (effectiveMode === MangaReadingMode.LONG_STRIP
                        ? (<MangaVerticalReader pageContainer={pageContainer} initialPageIndex={shouldRestoreSavedPage ? currentResumeLocation?.pageIndex : currentPageIndex} />)
                        : (effectiveMode === MangaReadingMode.PAGED || effectiveMode === MangaReadingMode.DOUBLE_PAGE)
                            ? (<MangaHorizontalReader pageContainer={pageContainer} />) : null)}
            </div>
        </Drawer>
    )
}
