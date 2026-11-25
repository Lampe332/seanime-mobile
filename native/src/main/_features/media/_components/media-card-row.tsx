import { fitRowWidth, ROW_GAP, ROW_GUTTER, rowCardWidth } from "@/components/shared/cover-layout"
import { useCardSizeFactor } from "@/lib/card-size-setting"
import { FlashList } from "@shopify/flash-list"
import React from "react"
import { type LayoutChangeEvent, useWindowDimensions, View } from "react-native"

/*
 * One swipeable row of cards, as every list on Android Home (home-mobile.css: "a list of 25 or 169 titles no longer turns
 * Home into a wall of covers"): cards about min(39vw, 10rem) wide (times the card size), a gutter apart, snapping to their
 * start; the full grids live in My lists, Manga and the library. FlashList recycles the cards, so a long list stays cheap.
 * The width is fitted to the row (fitRowWidth): whole cards and a clear peek of the next, never a sliver on the left.
 */
export const CARD_GAP = ROW_GAP

export function useCardWidth() {
    const { width } = useWindowDimensions()
    return fitRowWidth(rowCardWidth(width, useCardSizeFactor()), width)
}

/**
 * A row's card width fitted to the row's own width (the screen until it is measured, the measured width beside a rail).
 * `onLayout` goes on a view as wide as the row's viewport.
 */
export function useRowFit(desired: number, inset = ROW_GUTTER) {
    const { width: screen } = useWindowDimensions()
    const [viewport, setViewport] = React.useState(0)
    const onLayout = React.useCallback((e: LayoutChangeEvent) => setViewport(Math.round(e.nativeEvent.layout.width)), [])
    return { width: fitRowWidth(desired, viewport || screen, inset), onLayout }
}

export function MediaCardRow<T>({ data, keyOf, renderCard, inset = ROW_GUTTER }: {
    data: readonly T[]
    keyOf: (item: T) => string
    renderCard: (item: T, width: number) => React.ReactElement
    /** the page gutter the row starts on (it scrolls to the screen edge) */
    inset?: number
}) {
    const { width: screen } = useWindowDimensions()
    const { width, onLayout } = useRowFit(rowCardWidth(screen, useCardSizeFactor()), inset)
    const renderItem = React.useCallback(({ item }: { item: T }) => renderCard(item, width), [renderCard, width])
    return (
        <View onLayout={onLayout} style={{ marginHorizontal: -inset }}>
            <FlashList
                horizontal
                data={data}
                keyExtractor={keyOf}
                renderItem={renderItem}
                ItemSeparatorComponent={Gap}
                showsHorizontalScrollIndicator={false}
                snapToInterval={width + CARD_GAP}
                snapToAlignment="start"
                decelerationRate="fast"
                contentContainerStyle={{ paddingHorizontal: inset, paddingBottom: 12 }}
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
