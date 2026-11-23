import type { Manga_PageContainer } from "@/api/generated/types"
import { DEFAULT_PAGE_RATIO, isNearStripEnd, stripPageSize, stripPageTops, stripScrollPage } from "@/main/manga/_lib/chapter-reader"
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

type PageSize = { width: number, height: number }

/** Screens drawn ahead while opening: one more step each time the app is idle, so the pages ahead do not all mount in one frame */
const DRAW_STEPS = [0, 0.5, 1, 2]

/** One page of the strip; memoized, so a page that loads elsewhere does not draw the visible ones again. */
const StripCell = React.memo(function StripCell({ index, url, headers, width, height, gapAfter, onPress, onSize, onLoaded }: {
    index: number
    url: string | undefined
    headers: Record<string, string> | undefined
    width: number
    height: number
    gapAfter: number
    onPress: () => void
    onSize: (index: number, size: PageSize) => void
    onLoaded: (index: number) => void
}) {
    return <Pressable accessible={false} onPress={onPress}
        style={{ height: height + gapAfter, alignItems: "center", paddingHorizontal: 16 }}>
        <ChapterPage url={url} headers={headers} index={index} width={width} height={height} recycle
            onSize={onSize} onLoaded={onLoaded} />
    </Pressable>
})

/*
 * Long strip (chapter-vertical-reader.tsx) as a FlashList: only the pages near the screen are drawn, each at its real shape
 * once its picture has loaded (a usual page shape until then, or the server's page sizes). The current page is the one
 * under the reading line (120dp, or a quarter of a short screen); the chapter counts as read past 1000dp and less than
 * 1500dp from the end (only then the progress may be saved). A tap shows or hides the controls; with "Hide controls while
 * scrolling down" they slide away reading down and come back scrolling up. Opening restores the saved page: the strip jumps
 * there again as the pages above it load, until the reader touches it; only then the page index follows the scroll (the
 * jump lands on guessed page heights, and a wrong index would be saved). The page under the line comes from the list's
 * own layout, the one the scroll offset belongs to.
 */
export function MangaVerticalReader({ pageContainer, pageUrl, pageHeaders, initialPageIndex, width, height }: {
    pageContainer: Manga_PageContainer | undefined
    pageUrl: (index: number) => string | undefined
    pageHeaders?: (index: number) => Record<string, string> | undefined
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
    // every page's size once per change; the cells and the scroll handler only look them up
    const pageSizes = React.useMemo(() => indexes.map(sizeOf), [indexes, sizeOf])
    const heights = React.useMemo(() => pageSizes.map(size => size.height), [pageSizes])
    const widest = React.useMemo(() => pageSizes.reduce((max, size) => Math.max(max, size.width), 0), [pageSizes])
    const gap = pageGap ? GAP : 0
    // opening: only the pages on the screen at first, the ones ahead step by step once the app is idle (after the opening animation)
    const [drawStep, setDrawStep] = React.useState(0)
    React.useEffect(() => {
        if (drawStep >= DRAW_STEPS.length - 1) return
        const task = requestIdleCallback(() => setDrawStep(step => step + 1), { timeout: 600 })
        return () => cancelIdleCallback(task)
    }, [drawStep])

    // a new chapter: not read yet, restore its page
    React.useEffect(() => {
        setIsLastPage(false)
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

    const onLoaded = React.useCallback((index: number) => handlePageLoad(index), [handlePageLoad])
    // pages loading together report their sizes in one update per frame, not one strip render each
    const sizeQueue = React.useRef<Record<number, PageSize> | null>(null)
    const sizeFrame = React.useRef<number | null>(null)
    const onSize = React.useCallback((index: number, size: PageSize) => {
        sizeQueue.current = { ...sizeQueue.current, [index]: size }
        if (sizeFrame.current !== null) return
        sizeFrame.current = requestAnimationFrame(() => {
            sizeFrame.current = null
            const queued = sizeQueue.current
            sizeQueue.current = null
            if (!queued) return
            setSizes(prev => {
                let next = prev
                for (const [key, value] of Object.entries(queued)) {
                    const at = Number(key)
                    if (next[at]?.width === value.width && next[at]?.height === value.height) continue
                    if (next === prev) next = { ...prev }
                    next[at] = value
                }
                return next
            })
        })
    }, [])
    React.useEffect(() => () => {
        if (sizeFrame.current !== null) cancelAnimationFrame(sizeFrame.current)
    }, [])

    // a page's headers stay the same object, so its cell is not drawn again
    const pageHeadersList = React.useMemo(() => indexes.map(index => pageHeaders?.(index)), [indexes, pageHeaders])
    const onPress = React.useCallback(() => {
        if (tapToggleControls) setHideBar(prev => !prev)
    }, [tapToggleControls, setHideBar])

    // jotai skips setting an unchanged value; while the saved page is restored nothing but "last page" is worked out
    const onScroll = (offset: number) => {
        setIsLastPage(isNearStripEnd(offset, height, contentHeight.current, count > 0))
        if (pending.current !== null) return
        const tops = stripPageTops(heights, gap, index => list.current?.getLayout(index)?.y)
        const page = stripScrollPage({ restoring: false, tops, offset, line: Math.min(120, height / 4) })
        if (page === null) return
        setCurrentPageIndex(page)
        // hide the controls while reading down, bring them back scrolling up
        const delta = offset - lastOffset.current
        if (autoHideControls && Math.abs(delta) > 24) {
            setHideBar(delta > 0 && offset > 200)
            lastOffset.current = offset
        } else if (!autoHideControls) {
            lastOffset.current = offset
        }
    }

    const strip = <FlashList
        ref={list}
        data={indexes}
        keyExtractor={index => `${index}-${pageContainer?.pages?.[index]?.url}`}
        extraData={pageSizes}
        initialScrollIndex={initialPageIndex > 0 && initialPageIndex < count ? initialPageIndex : undefined}
        renderItem={({ item: index }) => <StripCell index={index} url={pageUrl(index)} headers={pageHeadersList[index]}
            width={(pageSizes[index] ?? sizeOf(index)).width} height={(pageSizes[index] ?? sizeOf(index)).height} gapAfter={index < count - 1 ? gap : 0} onPress={onPress} onSize={onSize} onLoaded={onLoaded} />}
        // a long chapter loads the next pages before they reach the screen (after the opening, see `drawStep`)
        drawDistance={height * DRAW_STEPS[drawStep]}
        onScrollBeginDrag={() => { pending.current = null }}
        onScroll={event => onScroll(event.nativeEvent.contentOffset.y)}
        onContentSizeChange={(_, h) => {
            contentHeight.current = h
            // pages above the saved one were drawn or measured: jump to it again
            if (pending.current !== null) void list.current?.scrollToIndex({ index: pending.current, animated: false })
        }}
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
