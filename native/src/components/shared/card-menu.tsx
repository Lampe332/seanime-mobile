import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { actionSheetIn, actionSheetInTablet, popoverOut } from "@/components/ui/core/animations"
import { Text } from "@/components/ui/text/text"
import { colors, sizes } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { cardMenuFrame } from "./card-menu-layout"
import { Portal } from "@rn-primitives/portal"
import React from "react"
import { BackHandler, Pressable, StyleSheet, useWindowDimensions } from "react-native"
import Animated from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * A card's long-press menu (PhoneCardMenu + CoverCardMenuItems in phone-screen.tsx, SeaContextMenu): the card's title as a
 * quiet label, then its items. A tap outside or Back closes it. The items are what exists natively: Preview, the caller's
 * items ("Open in library explorer", My lists' "Continue"), "Add to playlist" (2.14) and the plugins' items (2.17).
 * SeaContextMenu sets `data-phone-menu` on phones and tablets alike (mobile-surface.css): an action sheet at most 32rem
 * wide, raised surface, 6dp padding, the title on up to two lines, 48dp rows; it rises 1rem. Phone: docked .75rem above
 * the bottom bar with 1rem sides. Tablet (tablet.css): 1rem above the bottom edge, between the rail + 1rem and 1rem from
 * the right edge, centred there.
 */
export type CardMenuItem = { id: string, label: string, icon: React.ComponentType<{ size?: number, color?: string }>, onPress: () => void }
export type CardMenuAnchor = { x: number, y: number }

export function CardMenu({ anchor, title, items, onClose }: { anchor: CardMenuAnchor | null, title: string, items: CardMenuItem[], onClose: () => void }) {
    const { width, height } = useWindowDimensions()
    const { rail } = useTabletLayout()
    const barHeight = useNavBarHeight()
    const insets = useSafeAreaInsets()
    React.useEffect(() => {
        if (!anchor) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            onClose()
            return true
        })
        return () => sub.remove()
    }, [anchor, onClose])
    if (!anchor) return null
    const rows = items.map(item => (
        <Pressable key={item.id} accessibilityRole="menuitem" onPress={() => {
            onClose()
            item.onPress()
        }} className="min-h-12 flex-row items-center gap-3 rounded-lg px-3 active:bg-sm-surface-control">
            <item.icon size={20} color={colors.smTextMuted} />
            <Text className="text-[15px]">{item.label}</Text>
        </Pressable>
    ))
    const frame = cardMenuFrame(width, rail ? { width: sizes.tabletRail } : null, insets.bottom, barHeight)
    return (
        <Portal name="card-menu">
            <Pressable accessibilityLabel={title} onPress={onClose} style={StyleSheet.absoluteFill}>
                <Animated.View entering={rail ? actionSheetInTablet : actionSheetIn} exiting={popoverOut}
                    style={{ position: "absolute", ...frame, maxHeight: height - 160,
                        elevation: 16, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 12 } }}
                    className="overflow-hidden rounded-surface bg-sm-surface-raised p-1.5">
                    {/* `.UI-ContextMenu__label` (semibold) with the card menu's `my-2` around the phone padding */}
                    <Text numberOfLines={2} className="my-2 px-3 pb-1.5 pt-2.5 text-[13px] font-semibold leading-[18.2px] text-sm-text-muted">{title}</Text>
                    {rows}
                </Animated.View>
            </Pressable>
        </Portal>
    )
}
