import type { Manga_PageContainer } from "@/api/generated/types"
import { DEFAULT_PAGE_RATIO, pagedPageSize, readerTapZone, stepPaginationMap } from "@/main/manga/_lib/chapter-reader"
import { useEffectiveReadingMode, useHandleChapterPageStatus, useHydrateMangaPaginationMap } from "@/main/manga/_lib/handle-chapter-reader"
import {
    __manga_currentPageIndexAtom,
    __manga_currentPaginationMapIndexAtom,
    __manga_hiddenBarAtom,
    __manga_isLastPageAtom,
    __manga_pageFitAtom,
    __manga_pageGapAtom,
    __manga_pageGapShadowAtom,
    __manga_pageOverflowContainerWidthAtom,
    __manga_pageZoomAtom,
    __manga_paginationMapAtom,
    __manga_readingDirectionAtom,
    __manga_tapToggleControlsAtom,
    MangaPageFit,
    MangaReadingMode,
} from "@/main/manga/_lib/manga-chapter-reader.atoms"
import { pageStepToSide } from "@/main/manga/_lib/reader-gestures"
import { useReaderGestures } from "@/main/manga/_lib/use-reader-gestures"
import { Image } from "expo-image"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { ScrollView, View } from "react-native"
import Animated from "react-native-reanimated"
import { ChapterPage } from "./chapter-page"

/*
 * Single and double page mode (chapter-horizontal-reader.tsx): the pages of the current step of the pagination map, a
 * pair side by side (right to left, as the web reader lays it out). Tap the outer 40 % to turn, the middle to show or hide
 * the controls; swipe to turn; pinch or double tap to zoom, a finger then moves the page (use-reader-gestures.ts). Fit
 * width, Overflow and Original scroll down a page taller than the screen, the Zoom setting scrolls both ways; while a
 * gesture zoom is on, the finger moves the page instead. The next pages are fetched ahead (the web kept every page
 * mounted and hidden for that).
 */
export function MangaHorizontalReader({ pageContainer, pageUrl, width, height }: {
    pageContainer: Manga_PageContainer | undefined
    pageUrl: (index: number) => string | undefined
    width: number
    height: number
}) {
    const readingMode = useEffectiveReadingMode()
    const setIsLastPage = useSetAtom(__manga_isLastPageAtom)
    const readingDirection = useAtomValue(__manga_readingDirectionAtom)
    const pageFit = useAtomValue(__manga_pageFitAtom)
    const pageGap = useAtomValue(__manga_pageGapAtom)
    const pageGapShadow = useAtomValue(__manga_pageGapShadowAtom)
    const overflowWidth = useAtomValue(__manga_pageOverflowContainerWidthAtom)
    const pageZoom = useAtomValue(__manga_pageZoomAtom)
    const setHideBar = useSetAtom(__manga_hiddenBarAtom)
    const tapToggleControls = useAtomValue(__manga_tapToggleControlsAtom)
    const setCurrentPageIndex = useSetAtom(__manga_currentPageIndexAtom)
    const paginationMap = useAtomValue(__manga_paginationMapAtom)
    const [currentMapIndex, setCurrentMapIndex] = useAtom(__manga_currentPaginationMapIndexAtom)
    const [sizes, setSizes] = React.useState<Record<number, { width: number, height: number }>>({})
    const scroll = React.useRef<React.ComponentRef<typeof ScrollView>>(null)
    const box = React.useRef<React.ComponentRef<typeof View>>(null)

    useHydrateMangaPaginationMap(pageContainer)
    const { handlePageLoad } = useHandleChapterPageStatus(pageContainer)

    const steps = Object.keys(paginationMap).length
    React.useEffect(() => {
        setIsLastPage(steps > 0 && currentMapIndex === steps - 1)
    }, [currentMapIndex, steps, setIsLastPage])

    const onPaginate = React.useCallback((side: "left" | "right") => {
        setCurrentMapIndex(current => stepPaginationMap(paginationMap, current, side, readingDirection))
    }, [paginationMap, readingDirection, setCurrentMapIndex])

    const onTap = React.useCallback((x: number) => {
        const zone = readerTapZone(x, width)
        if (zone !== "middle") onPaginate(zone)
        else if (tapToggleControls) setHideBar(prev => !prev)
    }, [onPaginate, tapToggleControls, setHideBar, width])

    const gestures = useReaderGestures({
        direction: readingDirection,
        settingZoomed: pageZoom !== 1,
        onSwipe: step => onPaginate(pageStepToSide(step, readingDirection)),
        onTap,
    })
    const { reset, updateFrame } = gestures

    // every page starts unzoomed and at its top; the page index follows the step
    React.useEffect(() => {
        reset()
        scroll.current?.scrollTo({ x: 0, y: 0, animated: false })
        updateFrame({ scrollX: 0, scrollY: 0 })
        const pages = paginationMap[currentMapIndex]
        if (pages && pageContainer?.pages?.length) setCurrentPageIndex(pages[0])
    }, [currentMapIndex, pageContainer?.pages, paginationMap, reset, updateFrame, setCurrentPageIndex])

    // fetch the next pages ahead, so turning shows them at once
    React.useEffect(() => {
        const ahead = [1, 2].flatMap(step => paginationMap[currentMapIndex + step] ?? []).map(pageUrl).filter((url): url is string => !!url)
        if (ahead.length) void Image.prefetch(ahead, "memory-disk")
    }, [currentMapIndex, paginationMap, pageUrl])

    const currentPages = paginationMap[currentMapIndex] ?? []
    const double = readingMode === MangaReadingMode.DOUBLE_PAGE && currentPages.length === 2
    const showShadows = double && pageGap && pageGapShadow && !(pageFit === MangaPageFit.COVER || pageFit === MangaPageFit.TRUE_SIZE)
    const scrolls = pageZoom !== 1 || pageFit === MangaPageFit.COVER || pageFit === MangaPageFit.TRUE_SIZE || pageFit === MangaPageFit.LARGER
    const inner = Math.max(1, width - 32)
    const pageSizes = currentPages.map(index => {
        const natural = sizes[index] ?? pageContainer?.pageDimensions?.[index]
        const ratio = natural?.width ? natural.height / natural.width : DEFAULT_PAGE_RATIO
        return pagedPageSize({ fit: pageFit, zoom: pageZoom, overflowWidth, width: inner - (double && pageGap ? 8 : 0), height, ratio, naturalWidth: natural?.width ?? 0, double })
    })
    const contentWidth = Math.max(width, pageSizes.reduce((sum, size) => sum + size.width, 0) + 32 + (double && pageGap ? 8 : 0))
    const contentHeight = Math.max(height, ...pageSizes.map(size => size.height))
    React.useEffect(() => {
        updateFrame({ width, height, contentWidth, contentHeight })
    }, [updateFrame, width, height, contentWidth, contentHeight])

    const onSize = React.useCallback((index: number, size: { width: number, height: number }) => {
        setSizes(prev => prev[index]?.width === size.width && prev[index]?.height === size.height ? prev : { ...prev, [index]: size })
    }, [])

    const pages = <Animated.View pointerEvents="box-none" style={[{ width: contentWidth, minHeight: contentHeight, transformOrigin: "top left" }, gestures.animatedStyle]}
        className={double ? "flex-row-reverse items-center justify-center" : "items-center justify-center"}>
        {currentPages.map((index, i) => <View key={`${index}-${pageContainer?.pages?.[index]?.url}`} style={double && pageGap ? { marginHorizontal: 4 } : undefined}>
            <ChapterPage url={pageUrl(index)} index={index} width={pageSizes[i].width} height={pageSizes[i].height}
                contentFit={pageFit === MangaPageFit.TRUE_SIZE ? "none" : "contain"} onSize={onSize} onLoaded={handlePageLoad} />
            {showShadows && <View pointerEvents="none" className="absolute bottom-0 top-0 w-[3%]"
                style={i === 0 ? { left: 0, backgroundImage: "linear-gradient(90deg, rgba(17,17,17,0.3) 0%, rgba(17,17,17,0) 100%)" }
                    : { right: 0, backgroundImage: "linear-gradient(-90deg, rgba(17,17,17,0.3) 0%, rgba(17,17,17,0) 100%)" }} />}
        </View>)}
    </Animated.View>

    return <View ref={box} className="flex-1" onLayout={() => box.current?.measureInWindow((x, y) => updateFrame({ left: x, top: y }))} {...gestures.handlers}>
        <ScrollView ref={scroll} scrollEnabled={scrolls && !gestures.zoomed} showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
            onScroll={event => updateFrame({ scrollY: event.nativeEvent.contentOffset.y })} scrollEventThrottle={32} contentContainerStyle={{ minHeight: height }}>
            {pageZoom !== 1
                ? <ScrollView horizontal scrollEnabled={!gestures.zoomed} showsHorizontalScrollIndicator={false} nestedScrollEnabled
                    onScroll={event => updateFrame({ scrollX: event.nativeEvent.contentOffset.x })} scrollEventThrottle={32}>{pages}</ScrollView>
                : pages}
        </ScrollView>
    </View>
}
