import { useTr } from "@/lib/app-language"
import React from "react"
import { useWindowDimensions, View } from "react-native"

/** While the episodes of a stream source load (stream-page-skeleton.tsx): the switch row, a card and the first rows */
export function StreamPageSkeleton() {
    const t = useTr()
    const { width } = useWindowDimensions()
    const cardWidth = Math.round(Math.min(width * 0.72, 300))
    return <View accessibilityRole="progressbar" accessibilityLabel={t("Loading episodes", "Folgen werden geladen")} className="mt-4 gap-6">
        <View className="h-[72px] rounded-surface bg-sm-surface-raised" />
        <View className="flex-row gap-3 overflow-hidden">
            {[0, 1].map(i => <View key={i} style={{ width: cardWidth }} className="aspect-video rounded-surface bg-sm-surface-raised" />)}
        </View>
        <View className="gap-3">
            {[0, 1, 2].map(i => <View key={i} className="flex-row items-center gap-3">
                <View className="h-14 w-24 rounded-[8px] bg-sm-surface-raised" />
                <View className="flex-1 gap-2">
                    <View className="h-3 w-16 rounded-full bg-sm-surface-raised" />
                    <View className="h-4 w-40 rounded-full bg-sm-surface-raised" />
                </View>
            </View>)}
        </View>
    </View>
}
