import type { Manga_PageContainer } from "@/api/generated/types"
import { DEFAULT_PAGE_RATIO, isNearStripEnd, pageAtLine, stripPageSize } from "@/main/manga/_lib/chapter-reader"
import { useHandleChapterPageStatus, useHydrateMangaPaginationMap } from "@/main/manga/_lib/handle-chapter-reader"
import {
    __manga_autoHideControlsAtom,
    __manga_currentPageIndexAtom,
    __manga_hiddenBarAtom,
    __manga_isLastPageAtom,
    __manga_pageFitAtom,
    __manga_pageGapAtom,
    __manga_pageOverflowContainerWidthAtom,
    __manga_pageStretchAtom,
    __manga_pageZoomAtom,
    __manga_tapToggleControlsAtom,
    MangaPageFit,
} from "@/main/manga/_lib/manga-chapter-reader.atoms"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import { FlashList, type FlashListRef } from "@shopify/flash-list"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { Pressable, ScrollView, View } from "react-native"
import { ChapterPage } from "./chapter-page"

/** Bumped by the page slider: the strip scrolls to the current page (the web's ___manga_scrollSignalAtom). */
export const __manga_scrollSignalAtom = atom(0)

const GAP = 16

/*
 * Long strip (chapter-vertical-reader.tsx) as a FlashList: only the pages near the screen are drawn, each at its real shape
 * once its picture has loaded (a usual page shape until then, or the server's page sizes). The current page is the one
 * under the reading line (120dp, or a quarter of a short screen); the chapter counts as read past 1000dp and less than
 * 1500dp from the end (only then the progress may be saved). A tap shows or hides the controls; with "Hide controls while
 * scrolling down" they slide away reading down and come back scrolling up. Opening restores the saved page: the strip jumps
 * there again as the pages above it load, until the reader touches it.
 */
export function MangaVerticalReader({ pageContainer, pageUrl, initialPageIndex, width, height }: {
    pageContainer: Manga_PageContainer | undefined
    pageUrl: (index: number) => string | undefined
    initialPageIndex: number
    width: number
    height: number
}) {
    const list = React.useRef<FlashListRef<number>>(null)
    const setIsLastPage = useSetAtom(__manga_isLastPageAtom)
    const pageFit = useAtomValue(__manga_pageFitAtom)
    const pageStretch = useAtomValue(__manga_pageStretchAtom)
    const pageGap = useAtomValue(__manga_pageGapAtom)
    const overflowWidth = useAtomValue(__manga_pageOverflowContainerWidthAtom)
    const pageZoom = useAtomValue(__manga_pageZoomAtom)
    const [currentPageIndex, setCurrentPageIndex] = useAtom(__manga_currentPageIndexAtom)
    const setHideBar = useSetAtom(__manga_hiddenBarAtom)
    const tapToggleControls = useAtomValue(__manga_tapToggleControlsAtom)
    const autoHideControls = useAtomValue(__manga_autoHideControlsAtom)
    const scrollSignal = useAtomValue(__manga_scrollSignalAtom)
    const [sizes, setSizes] = React.useState<Record<number, { width: number, height: number }>>({})
    const pending = React.useRef<number | null>(initialPageIndex)
    const loaded = React.useRef(new Set<number>())
    const lastOffset = React.useRef(0)
    const contentHeight = React.useRef(0)

    useHydrateMangaPaginationMap(pageContainer)
    const { handlePageLoad } = useHandleChapterPageStatus(pageContainer)

    const count = pageContainer?.pages?.length ?? 0
    const indexes = React.useMemo(() => Array.from({ length: count }, (_, i) => i), [count])
    const inner = Math.max(1, width - 32)
    // tablet.css (from 600px): Whole page as a 48rem column
    const tabletColumn = useIsTabletScreen() && width >= 600
    const sizeOf = React.useCallback((index: number) => {
        const natural = sizes[index] ?? pageContainer?.pageDimensions?.[index]
        const ratio = natural?.width ? natural.height / natural.width : DEFAULT_PAGE_RATIO
        return stripPageSize({ fit: pageFit, stretch: pageStretch, zoom: pageZoom, overflowWidth, width: inner, height, ratio, naturalWidth: natural?.width ?? 0, tabletColumn })
    }, [sizes, pageContainer?.pageDimensions, pageFit, pageStretch, pageZoom, overflowWidth, inner, height, tabletColumn])
    const heights = React.useMemo(() => indexes.map(i => sizeOf(i).height), [indexes, sizeOf])
    const widest = React.useMemo(() => indexes.reduce((max, i) => Math.max(max, sizeOf(i).width), 0), [indexes, sizeOf])
    const gap = pageGap ? GAP : 0

    // a new chapter: not read yet, restore its page
    React.useEffect(() => {
        setIsLastPage(false)
        loaded.current = new Set()
        pending.current = initialPageIndex
        if (initialPageIndex > 0) void list.current?.scrollToIndex({ index: initialPageIndex, animated: false })
    }, [pageContainer?.pages, initialPageIndex, setIsLastPage])

    // the page slider moved: go to its page (only the signal moves the strip; the index alone changes while reading)
    const firstSignal = React.useRef(scrollSignal)
    const pageIndex = React.useRef(currentPageIndex)
    React.useEffect(() => {
        pageIndex.current = currentPageIndex
    }, [currentPageIndex])
    React.useEffect(() => {
        if (scrollSignal === firstSignal.current) return
        pending.current = null
        void list.current?.scrollToIndex({ index: pageIndex.current, animated: false })
    }, [scrollSignal])

    const onLoaded = React.useCallback((index: number) => {
        handlePageLoad(index)
        loaded.current.add(index)
        const target = pending.current
        if (target === null || index > target) return
        // the pages above the saved one changed height: jump to it again, until all of them are there
        void list.current?.scrollToIndex({ index: target, animated: false })
        if (Array.from({ length: target + 1 }, (_, i) => i).every(i => loaded.current.has(i))) {
            pending.current = null
            setCurrentPageIndex(target)
        }
    }, [handlePageLoad, setCurrentPageIndex])
    const onSize = React.useCallback((index: number, size: { width: number, height: number }) => {
        setSizes(prev => prev[index]?.width === size.width && prev[index]?.height === size.height ? prev : { ...prev, [index]: size })
    }, [])

    const onScroll = (offset: number) => {
        if (pending.current !== null) return
        // hide the controls while reading down, bring them back scrolling up
        const delta = offset - lastOffset.current
        if (autoHideControls && Math.abs(delta) > 24) {
            setHideBar(delta > 0 && offset > 200)
            lastOffset.current = offset
        } else if (!autoHideControls) {
            lastOffset.current = offset
        }
        setIsLastPage(isNearStripEnd(offset, height, contentHeight.current, count > 0))
        setCurrentPageIndex(pageAtLine(heights, gap, offset, Math.min(120, height / 4)))
    }

    const strip = <FlashList
        ref={list}
        data={indexes}
        keyExtractor={index => `${index}-${pageContainer?.pages?.[index]?.url}`}
        extraData={sizeOf}
        initialScrollIndex={initialPageIndex > 0 && initialPageIndex < count ? initialPageIndex : undefined}
        renderItem={({ item: index }) => {
            const size = sizeOf(index)
            return <Pressable accessible={false} onPress={() => { if (tapToggleControls) setHideBar(prev => !prev) }}
                style={{ height: size.height + (index < count - 1 ? gap : 0), alignItems: "center", paddingHorizontal: 16 }}>
                <ChapterPage url={pageUrl(index)} index={index} width={size.width} height={size.height} recycle
                    contentFit={pageFit === MangaPageFit.TRUE_SIZE ? "none" : "contain"} onSize={onSize} onLoaded={onLoaded} />
            </Pressable>
        }}
        // a long chapter loads the next pages before they reach the screen
        drawDistance={height * 2}
        onScrollBeginDrag={() => { pending.current = null }}
        onScroll={event => onScroll(event.nativeEvent.contentOffset.y)}
        onContentSizeChange={(_, h) => { contentHeight.current = h }}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
        maintainVisibleContentPosition={{ disabled: true }}
    />

    // The Zoom setting makes pages wider than the reader: the strip scrolls sideways too
    if (pageZoom > 1 && widest + 32 > width) {
        return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ width: widest + 32 }}>
            <View style={{ width: widest + 32, height }}>{strip}</View>
        </ScrollView>
    }
    return <View style={{ width, height }}>{strip}</View>
}
