import { fitRowWidth, ROW_GAP, ROW_GUTTER, rowCardWidth, snappedOffset, snapRow } from "@/components/shared/cover-layout"
import { useCardSizeFactor } from "@/lib/card-size-setting"
import { FlashList, type FlashListRef } from "@shopify/flash-list"
import React from "react"
import { type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, PixelRatio, useWindowDimensions, View } from "react-native"

/*
 * One swipeable row of cards, as every list on Android Home (home-mobile.css: "a list of 25 or 169 titles no longer turns
 * Home into a wall of covers"): cards about min(39vw, 10rem) wide (times the card size), a gutter apart, snapping to their
 * start; the full grids live in My lists, Manga and the library. FlashList recycles the cards, so a long list stays cheap.
 * The width is fitted to the row (fitRowWidth): whole cards and a clear peek of the next, never a sliver on the left.
 * The step card to card is on whole device pixels (snapRow), so a row snaps on the gutter after any number of swipes.
 */
export const CARD_GAP = ROW_GAP

export function useCardWidth() {
    const { width } = useWindowDimensions()
    return snapRow(fitRowWidth(rowCardWidth(width, useCardSizeFactor()), width), PixelRatio.get()).width
}

/**
 * A row's card width fitted to the row's own width (the screen until it is measured, the measured width beside a rail),
 * with the step and snap interval on whole device pixels. `onLayout` goes on a view as wide as the row's viewport.
 */
export function useRowFit(desired: number, inset = ROW_GUTTER) {
    const { width: screen } = useWindowDimensions()
    const [viewport, setViewport] = React.useState(0)
    const onLayout = React.useCallback((e: LayoutChangeEvent) => setViewport(Math.round(e.nativeEvent.layout.width)), [])
    return { ...snapRow(fitRowWidth(desired, viewport || screen, inset), PixelRatio.get()), onLayout }
}

export function MediaCardRow<T>({ data, keyOf, renderCard, inset = ROW_GUTTER, desired, restartKey, bottom = 12 }: {
    data: readonly T[]
    keyOf?: (item: T) => string
    renderCard: (item: T, width: number) => React.ReactElement
    /** the page gutter the row starts on (it scrolls to the screen edge) */
    inset?: number
    /** the card width before fitting; Home's row card at the card size by default (Discover passes its cover width) */
    desired?: number
    /** a change starts the row at its first card again (Discover's genre) */
    restartKey?: string | null
    bottom?: number
}) {
    const { width: screen } = useWindowDimensions()
    const home = rowCardWidth(screen, useCardSizeFactor())
    const { width, step, snapInterval, onLayout } = useRowFit(desired ?? home, inset)
    const list = React.useRef<FlashListRef<T>>(null)
    // where the row settled, to put it back on a card when the card size (the step) changes
    const offset = React.useRef(0)
    const lastStep = React.useRef(step)
    const onSettled = React.useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.x }, [])
    React.useEffect(() => {
        const from = lastStep.current
        lastStep.current = step
        if (from === step || offset.current <= 0) return
        offset.current = snappedOffset(offset.current, from, step)
        list.current?.scrollToOffset({ offset: offset.current, animated: false })
    }, [step])
    React.useEffect(() => {
        offset.current = 0
        list.current?.scrollToOffset({ offset: 0, animated: false })
    }, [restartKey])
    const renderItem = React.useCallback(({ item }: { item: T }) => renderCard(item, width), [renderCard, width])
    return (
        <View onLayout={onLayout} style={{ marginHorizontal: -inset }}>
            <FlashList
                ref={list}
                horizontal
                data={data}
                keyExtractor={keyOf}
                renderItem={renderItem}
                ItemSeparatorComponent={Gap}
                showsHorizontalScrollIndicator={false}
                snapToInterval={snapInterval}
                snapToAlignment="start"
                decelerationRate="fast"
                onMomentumScrollEnd={onSettled}
                onScrollEndDrag={onSettled}
                // the row keeps its own place (snapped, see above), not an anchored card's old pixel offset
                maintainVisibleContentPosition={{ disabled: true }}
                contentContainerStyle={{ paddingHorizontal: inset, paddingBottom: bottom }}
            />
        </View>
    )
}

function Gap() {
    return <View style={{ width: CARD_GAP }} />
}

/** Loading placeholders at the size of the cards they stand for (cover plus two lines of text: 2:3.6) */
export function MediaCardRowSkeleton({ count = 3, inset = ROW_GUTTER }: { count?: number, inset?: number }) {
    const width = useCardWidth()
    return (
        <View style={{ marginHorizontal: -inset, paddingHorizontal: inset, gap: CARD_GAP }} className="flex-row overflow-hidden pb-3">
            {Array.from({ length: count }, (_, i) => (
                <View key={i} style={{ width, aspectRatio: 2 / 3.6 }} className="rounded-surface-sm bg-sm-surface-raised" />
            ))}
        </View>
    )
}
