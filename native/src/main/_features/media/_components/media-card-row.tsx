import { FlashList } from "@shopify/flash-list"
import React from "react"
import { useWindowDimensions, View } from "react-native"

/*
 * One swipeable row of cards, as every list on Android Home (home-mobile.css: "a list of 25 or 169 titles no longer turns
 * Home into a wall of covers"): cards min(39vw, 10rem) wide, 12dp apart, snapping to their start; the full grids live in
 * My lists, Manga and the library. FlashList recycles the cards, so a long list stays cheap.
 */
export const CARD_GAP = 12

export function useCardWidth() {
    const { width } = useWindowDimensions()
    return Math.round(Math.min(width * 0.39, 160))
}

export function MediaCardRow<T>({ data, keyOf, renderCard, inset = 16 }: {
    data: readonly T[]
    keyOf: (item: T) => string
    renderCard: (item: T, width: number) => React.ReactElement
    /** the page gutter the row starts on (it scrolls to the screen edge) */
    inset?: number
}) {
    const width = useCardWidth()
    return (
        <FlashList
            horizontal
            data={data}
            keyExtractor={keyOf}
            renderItem={({ item }) => renderCard(item, width)}
            ItemSeparatorComponent={Gap}
            showsHorizontalScrollIndicator={false}
            snapToInterval={width + CARD_GAP}
            snapToAlignment="start"
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: inset, paddingBottom: 12 }}
            style={{ marginHorizontal: -inset }}
        />
    )
}

function Gap() {
    return <View style={{ width: CARD_GAP }} />
}

/** Loading placeholders at the size of the cards they stand for (cover plus two lines of text: 2:3.6) */
export function MediaCardRowSkeleton({ count = 3, inset = 16 }: { count?: number, inset?: number }) {
    const width = useCardWidth()
    return (
        <View style={{ marginHorizontal: -inset, paddingHorizontal: inset }} className="flex-row gap-3 overflow-hidden pb-3">
            {Array.from({ length: count }, (_, i) => (
                <View key={i} style={{ width, aspectRatio: 2 / 3.6 }} className="rounded-surface-sm bg-sm-surface-raised" />
            ))}
        </View>
    )
}
