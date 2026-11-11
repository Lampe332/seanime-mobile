import { useGetMangaEntryPages, useUpdateMangaProgress } from "@/api/hooks/manga.hooks"
import { PhoneEmpty } from "@/components/shared/phone-cards"
import { Button } from "@/components/ui/button/button"
import { useCloseOnBack } from "@/components/ui/core/back-handler"
import { Slider } from "@/components/ui/slider/slider"
import { Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import { releaseOrientation } from "@/main/_features/player/player-system"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { mapIndexForPage, secondPageLabel, shouldUpdateMangaProgress } from "@/main/manga/_lib/chapter-reader"
import {
    __manga_readerSourceAtom,
    __manga_selectedChapterAtom,
    type MangaReaderSource,
    useEffectiveReadingMode,
    useHandleChapterPagination,
} from "@/main/manga/_lib/handle-chapter-reader"
import { getChapterNumberFromChapter, useMangaReaderUtils } from "@/main/manga/_lib/handle-manga-utils"
import {
    __manga_currentPageIndexAtom,
    __manga_currentPaginationMapIndexAtom,
    __manga_hiddenBarAtom,
    __manga_isLastPageAtom,
    __manga_keepScreenOnAtom,
    __manga_paginationMapAtom,
    __manga_readerBackgroundAtom,
    __manga_readerBrightnessAtom,
    __manga_readingDirectionAtom,
    __manga_readingModeAtom,
    __manga_resumeLocationsAtom,
    cleanupMangaResumeLocations,
    MangaReadingDirection,
    MangaReadingMode,
} from "@/main/manga/_lib/manga-chapter-reader.atoms"
import { shouldForceLandscape } from "@/main/manga/_lib/reader-mode"
import { useMangaChapterTotal } from "@/main/manga/_lib/use-manga-chapter-total"
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake"
import * as ScreenOrientation from "expo-screen-orientation"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import ChevronLeft from "lucide-react-native/icons/chevron-left"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import PanelBottomOpen from "lucide-react-native/icons/panel-bottom-open"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import Settings from "lucide-react-native/icons/settings"
import X from "lucide-react-native/icons/x"
import React from "react"
import { ActivityIndicator, AppState, Pressable, useWindowDimensions, View } from "react-native"
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ChapterReaderSettings, __manga_readerSettingsOpenAtom, useEntryReaderSettings } from "./chapter-reader-settings"
import { MangaHorizontalReader } from "./chapter-horizontal-reader"
import { __manga_scrollSignalAtom, MangaVerticalReader } from "./chapter-vertical-reader"

/*
 * The chapter reader (chapter-reader-drawer.tsx + manga-reader-bar.tsx), mounted once in the main layout over the page and
 * the bar; a manga page or the Downloads tab hands it its chapters (__manga_readerSourceAtom) and opens it by choosing a
 * chapter. It loads the chapter's pages, restores the saved page and saves the place while reading
 * ("sea-manga-resume-locations"), keeps the screen on, turns a phone sideways for an explicit double page, and offers
 * "Update progress" only once the chapter is really read: on its last page (paged) or near the end of the strip. With
 * "Auto update progress" on (Settings › Manga) it saves by itself at that point, once per chapter, as before.
 * The bar: close, previous / chapter / next (mirrored right to left), the pages, the settings; a page slider above it.
 * Back closes the settings first, then the reader. Not here: Discord presence (desktop) and the keyboard shortcuts.
 */

const READER_BACKGROUNDS: Record<string, string> = { black: "#000", gray: "#1c1c1f", white: "#f4f4f5" }
const BAR_HEIGHT = 56
const BAR_EASE = { duration: 240 }

export function MangaReader() {
    const source = useAtomValue(__manga_readerSourceAtom)
    const currentChapter = useAtomValue(__manga_selectedChapterAtom)
    if (!source || !currentChapter) return null
    return <Reader source={source} />
}

function Reader({ source }: { source: MangaReaderSource }) {
    const { entry, chapterContainer } = source
    const t = useTr()
    const serverStatus = useServerStatus()
    const insets = useSafeAreaInsets()
    const window = useWindowDimensions()
    const isTablet = useIsTabletScreen()
    const reduceMotion = useReducedMotion()
    const [currentChapter, setCurrentChapter] = useAtom(__manga_selectedChapterAtom)
    const [currentPageIndex, setCurrentPageIndex] = useAtom(__manga_currentPageIndexAtom)
    const setCurrentMapIndex = useSetAtom(__manga_currentPaginationMapIndexAtom)
    const [isLastPage, setIsLastPage] = useAtom(__manga_isLastPageAtom)
    const [readingMode, setReadingMode] = useAtom(__manga_readingModeAtom)
    const effectiveMode = useEffectiveReadingMode()
    const readingDirection = useAtomValue(__manga_readingDirectionAtom)
    const paginationMap = useAtomValue(__manga_paginationMapAtom)
    const [hiddenBar, setHideBar] = useAtom(__manga_hiddenBarAtom)
    const setSettingsOpen = useSetAtom(__manga_readerSettingsOpenAtom)
    const keepScreenOn = useAtomValue(__manga_keepScreenOnAtom)
    const readerBackground = useAtomValue(__manga_readerBackgroundAtom)
    const readerBrightness = useAtomValue(__manga_readerBrightnessAtom)
    const [resumeLocations, setResumeLocations] = useAtom(__manga_resumeLocationsAtom)
    const setScrollSignal = useSetAtom(__manga_scrollSignalAtom)
    const { getChapterPageUrl, isReady } = useMangaReaderUtils()
    useEntryReaderSettings(entry.mediaId)

    const close = React.useCallback(() => setCurrentChapter(undefined), [setCurrentChapter])
    // the settings sheet answers Back itself (it opened later); then Back closes the reader
    useCloseOnBack(true, close)

    // Phones turn sideways for an explicit double page; tablets are never turned
    React.useEffect(() => {
        if (!shouldForceLandscape(readingMode, isTablet)) return
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {})
        return () => releaseOrientation()
    }, [readingMode, isTablet])

    // Keep the screen on while a chapter is open; the lock is taken again when the app comes back
    React.useEffect(() => {
        if (!keepScreenOn) return
        const tag = "seanime-manga-reader"
        void activateKeepAwakeAsync(tag)
        const sub = AppState.addEventListener("change", state => { if (state === "active") void activateKeepAwakeAsync(tag) })
        return () => {
            sub.remove()
            void deactivateKeepAwake(tag)
        }
    }, [keepScreenOn])

    // The controls come back for every chapter, the settings close with the reader
    React.useEffect(() => () => {
        setHideBar(false)
        setSettingsOpen(false)
    }, [setHideBar, setSettingsOpen])

    React.useEffect(() => {
        setResumeLocations(prev => cleanupMangaResumeLocations(prev))
    }, [setResumeLocations])

    const { data: pageContainer, isLoading: pageContainerLoading, isError: pageContainerError, refetch: retryPages } = useGetMangaEntryPages({
        mediaId: entry.media?.id ?? entry.mediaId,
        chapterId: currentChapter?.chapterId,
        provider: currentChapter?.provider,
        doublePage: effectiveMode === MangaReadingMode.DOUBLE_PAGE,
    })

    // A source without page sizes cannot pair pages: back to single page
    React.useEffect(() => {
        if (readingMode === MangaReadingMode.DOUBLE_PAGE && !pageContainerLoading && !pageContainerError && pageContainer
            && (!pageContainer.pageDimensions || Object.keys(pageContainer.pageDimensions).length === 0)) {
            toast.error(t("Could not get page dimensions from this provider. Switching to single page.", "Seitengrößen von dieser Quelle nicht verfügbar. Wechsle zu Einzelseite."))
            setReadingMode(MangaReadingMode.PAGED)
        }
    }, [pageContainer, pageContainerLoading, pageContainerError, readingMode, setReadingMode, t])

    const { previousChapter, nextChapter, goToChapter } = useHandleChapterPagination(entry.mediaId, chapterContainer)

    // Chapter numbers of the list (the progress compares against them)
    const chapterNumber = React.useMemo(() => {
        const found = chapterContainer.chapters?.find(ch => ch.id === currentChapter?.chapterId)
        return getChapterNumberFromChapter(found?.chapter ?? currentChapter?.chapterNumber ?? "")
    }, [chapterContainer.chapters, currentChapter])
    const shouldUpdateProgress = shouldUpdateMangaProgress(chapterNumber, entry.listData?.progress)
    const total = useMangaChapterTotal(entry.mediaId, entry.media?.chapters, entry.listData?.progress)
    const { mutate: updateProgress, isPending: isUpdatingProgress } = useUpdateMangaProgress(entry.mediaId)
    const handleUpdateProgress = (goToNext: boolean) => {
        if (!shouldUpdateProgress || isUpdatingProgress) return
        updateProgress({
            chapterNumber,
            mediaId: entry.mediaId,
            malId: entry.media?.idMal || undefined,
            // AniList's own count: the server completes the entry with it
            totalChapters: entry.media?.chapters || 0,
        }, { onSuccess: () => { if (goToNext) goToChapter("next") } })
    }

    // Auto update: once per chapter, only when it is read (last page / end of the strip)
    const lastUpdatedChapter = React.useRef<string | null>(null)
    const pagesReady = !pageContainerLoading && !pageContainerError
    React.useEffect(() => {
        if (serverStatus?.settings?.manga?.mangaAutoUpdateProgress && currentChapter?.chapterId && shouldUpdateProgress && pagesReady && isLastPage
            && lastUpdatedChapter.current !== currentChapter.chapterId) {
            lastUpdatedChapter.current = currentChapter.chapterId
            updateProgress({ chapterNumber, mediaId: entry.mediaId, malId: entry.media?.idMal || undefined, totalChapters: entry.media?.chapters || 0 })
        }
    }, [serverStatus?.settings?.manga?.mangaAutoUpdateProgress, currentChapter?.chapterId, shouldUpdateProgress, pagesReady, isLastPage,
        chapterNumber, entry.mediaId, entry.media?.idMal, entry.media?.chapters, updateProgress])

    // Resume: open at the saved page of this chapter, then save the place while reading
    const mediaKey = String(entry.mediaId)
    const chapterKey = currentChapter ? `${currentChapter.mediaId}:${currentChapter.provider}:${currentChapter.chapterId}` : ""
    const saved = resumeLocations[mediaKey]
    const restoresSaved = !!currentChapter && saved?.chapterId === currentChapter.chapterId && saved?.provider === currentChapter.provider
    const [startPage, setStartPage] = React.useState(0)
    const [startFor, setStartFor] = React.useState("")
    const [restoredFor, setRestoredFor] = React.useState("")
    if (startFor !== chapterKey) {
        // a new chapter: not read, at its saved page or the first
        setStartFor(chapterKey)
        setStartPage(restoresSaved && saved ? saved.pageIndex : 0)
        setRestoredFor("")
    }
    React.useEffect(() => {
        setIsLastPage(false)
        setCurrentPageIndex(startPage)
        setCurrentMapIndex(0)
    }, [chapterKey, startPage, setIsLastPage, setCurrentPageIndex, setCurrentMapIndex])
    // providers can return a different page count between sessions: clamp once the pages are there; saving starts then
    // (the paged reader finds the step of the page itself when it builds its map)
    const pageCount = pageContainer?.pages?.length ?? 0
    const firstPage = Math.min(startPage, Math.max(0, pageCount - 1))
    if (chapterKey && pagesReady && pageCount > 0 && restoredFor !== chapterKey) setRestoredFor(chapterKey)
    React.useEffect(() => {
        if (restoredFor && restoredFor === chapterKey && firstPage !== startPage) setCurrentPageIndex(firstPage)
    }, [restoredFor, chapterKey, firstPage, startPage, setCurrentPageIndex])
    React.useEffect(() => {
        if (!currentChapter || restoredFor !== chapterKey || !pageCount || currentPageIndex < 0 || currentPageIndex > pageCount - 1) return
        setResumeLocations(prev => {
            const location = prev[mediaKey]
            if (location?.chapterId === currentChapter.chapterId && location?.provider === currentChapter.provider && location?.pageIndex === currentPageIndex) return prev
            return cleanupMangaResumeLocations({
                ...prev,
                [mediaKey]: { chapterId: currentChapter.chapterId, provider: currentChapter.provider, pageIndex: currentPageIndex, updatedAt: Date.now() },
            })
        })
    }, [currentChapter, chapterKey, restoredFor, pageCount, currentPageIndex, mediaKey, setResumeLocations])

    const pageUrl = React.useCallback((index: number) => {
        const page = pageContainer?.pages?.[index]
        if (!page || !isReady) return undefined
        return getChapterPageUrl(page.url, pageContainer?.isDownloaded, page.headers)
    }, [pageContainer, isReady, getChapterPageUrl])

    // The bar and slider slide away when hidden
    const barStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: withTiming(hiddenBar ? BAR_HEIGHT + 64 + insets.bottom : 0, reduceMotion ? { duration: 0 } : BAR_EASE) }],
    }), [hiddenBar, insets.bottom, reduceMotion])

    const paged = effectiveMode === MangaReadingMode.PAGED || effectiveMode === MangaReadingMode.DOUBLE_PAGE
    const reversed = readingDirection === MangaReadingDirection.RTL && effectiveMode !== MangaReadingMode.LONG_STRIP
    // 2.0.32 draws the page from the top edge, over the camera cutout (the WebView filled the screen); only the bar is kept free
    const readerHeight = window.height - (hiddenBar ? 0 : BAR_HEIGHT + insets.bottom)
    const showSave = shouldUpdateProgress && isLastPage && pagesReady

    const changePage = (index: number) => {
        setCurrentPageIndex(index)
        if (paged) setCurrentMapIndex(mapIndexForPage(paginationMap, index))
        else setScrollSignal(n => n + 1)
    }

    const previous = <BarButton label={t("Previous chapter", "Vorheriges Kapitel")} disabled={!previousChapter} onPress={() => goToChapter("previous")}>
        {reversed ? <ChevronRight size={20} color={colors.smText} /> : <ChevronLeft size={20} color={colors.smText} />}
    </BarButton>
    const next = <BarButton label={t("Next chapter", "Nächstes Kapitel")} disabled={!nextChapter} onPress={() => goToChapter("next")}>
        {reversed ? <ChevronLeft size={20} color={colors.smText} /> : <ChevronRight size={20} color={colors.smText} />}
    </BarButton>

    return <View style={{ position: "absolute", inset: 0, zIndex: 50, backgroundColor: READER_BACKGROUNDS[readerBackground] ?? "#000" }}
        accessibilityViewIsModal>
        <View style={{ height: readerHeight }} className="overflow-hidden">
            {pageContainerError ? <View className="flex-1 items-center justify-center p-4">
                <View className="w-full max-w-[416px]">
                    <PhoneEmpty title={t("Pages could not be loaded", "Seiten konnten nicht geladen werden")}
                        text={t("Try again, or change the source on the manga's page.", "Versuch es erneut oder wechsle auf der Seite des Manga die Quelle.")}>
                        <Button leftIcon={<RefreshCw size={18} color="#fff" />} onPress={() => void retryPages()}>{t("Try again", "Erneut versuchen")}</Button>
                        <Button intent="secondary" onPress={close}>{t("Close chapter", "Kapitel schließen")}</Button>
                    </PhoneEmpty>
                </View>
            </View> : pageContainerLoading || !pageContainer ? <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.smTextMuted} size="large" /></View>
                : effectiveMode === MangaReadingMode.LONG_STRIP
                    ? <MangaVerticalReader key={chapterKey} pageContainer={pageContainer} pageUrl={pageUrl} initialPageIndex={firstPage} width={window.width} height={readerHeight} />
                    : <MangaHorizontalReader key={chapterKey} pageContainer={pageContainer} pageUrl={pageUrl} width={window.width} height={readerHeight} />}
        </View>

        {readerBrightness < 100 && <View pointerEvents="none" style={{ position: "absolute", inset: 0, backgroundColor: "#000", opacity: (100 - readerBrightness) / 100 }} />}

        {/* "Update progress" at the top once the chapter is read */}
        {showSave && <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top, left: 0, right: 0 }} className="items-center">
            <Button size="lg" className="rounded-t-none bg-[#16a34a] active:bg-[#15803d]" loading={isUpdatingProgress} onPress={() => handleUpdateProgress(true)}>
                {t("Update progress", "Fortschritt speichern")} ({chapterNumber} / {total || "-"})
            </Button>
        </View>}

        {/* the controls hidden: a quiet button brings them back */}
        {hiddenBar && <View style={{ position: "absolute", right: 16, bottom: 16 + insets.bottom }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("Show reading controls", "Lese-Steuerung einblenden")} onPress={() => setHideBar(false)}
                className="h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-black/40 active:bg-black/60">
                <PanelBottomOpen size={20} color="#fff" />
            </Pressable>
        </View>}

        <Animated.View pointerEvents={hiddenBar ? "none" : "box-none"} style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, barStyle]}>
            {/* right to left: the first page sits at the right end. `.reader-page-slider`: .5rem + the 32px input + .25rem =
                44dp, the knob's middle 24dp from the top; the 48dp touch row reaches 4dp into the bar below */}
            {pageCount > 1 && <View style={{ height: 44 }} className="bg-[rgba(20,20,22,0.9)] px-4">
                <Slider min={0} max={pageCount - 1} step={1}
                    value={reversed ? pageCount - 1 - Math.min(currentPageIndex, pageCount - 1) : Math.min(currentPageIndex, pageCount - 1)}
                    onValueChange={value => changePage(reversed ? pageCount - 1 - value : value)}
                    accessibilityLabel={`${t("Page", "Seite")} ${currentPageIndex + 1} / ${pageCount}`} />
            </View>}
            <View style={{ height: BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }} className="flex-row items-center gap-2 bg-[rgba(20,20,22,0.96)] px-2">
                <BarButton label={t("Close reader", "Leser schließen")} onPress={close}><X size={16} strokeWidth={2.5} color={colors.smText} /></BarButton>
                <View accessibilityLabel={t("Chapter", "Kapitel")} className="flex-row items-center gap-1.5">
                    {reversed ? next : previous}
                    <Text className="min-w-14 text-center text-sm font-semibold" style={{ fontVariant: ["tabular-nums"] }}>{t("Ch.", "Kap.")} {currentChapter?.chapterNumber}</Text>
                    {reversed ? previous : next}
                </View>
                <View className="flex-1" />
                {pageCount > 0 && <Text accessibilityLiveRegion="polite" className="px-2 text-[15px] font-semibold" style={{ fontVariant: ["tabular-nums"] }}>
                    {currentPageIndex + 1}{secondPageLabel(paginationMap, currentPageIndex)}<Text className="font-medium text-sm-text-subtle"> / {pageCount}</Text>
                </Text>}
                <BarButton label={t("Reader settings", "Lese-Einstellungen")} onPress={() => setSettingsOpen(true)}><Settings size={20} color={colors.smText} /></BarButton>
            </View>
        </Animated.View>

        <ChapterReaderSettings />
    </View>
}

function BarButton({ label, disabled, onPress, children }: { label: string, disabled?: boolean, onPress: () => void, children: React.ReactNode }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
        className={`h-11 w-11 items-center justify-center rounded-full bg-sm-surface-raised active:bg-sm-surface-control ${disabled ? "opacity-45" : ""}`}>
        {children}
    </Pressable>
}
