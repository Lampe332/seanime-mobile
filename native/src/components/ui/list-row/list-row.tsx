import { cn } from "@/components/ui/core/styling"
import { Muted, Text } from "@/components/ui/text/text"
import { colors } from "@/lib/theme/tokens"
import React from "react"
import { Pressable, View } from "react-native"
import Svg, { Path } from "react-native-svg"

/*
 * List rows (Listenzeile) of the phone kit (phone-screen.css):
 *   ListGroup  `.ps-list`: rows 2dp apart in one block with 16dp corners
 *   ListRow    `.ps-list-row`: one tap target per line, at least 76dp with a cover or 56dp without; leading cover or
 *              icon, title (2 lines) and meta, a side value or a chevron; pressed it lights up one step
 */
export function ListGroup({ children, className }: { children: React.ReactNode, className?: string }) {
    return <View className={cn("gap-0.5 overflow-hidden rounded-surface", className)}>{children}</View>
}

export type ListRowProps = {
    title: string
    meta?: string
    /** a cover (2:3, 44dp wide) or an icon */
    leading?: React.ReactNode
    /** a short value on the right (`.ps-list-side`) */
    side?: string
    /** a chevron when the row opens a page */
    chevron?: boolean
    trailing?: React.ReactNode
    onPress?: () => void
    disabled?: boolean
    className?: string
}

function ChevronRight() {
    return (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.smTextSubtle} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m9 6 6 6-6 6" />
        </Svg>
    )
}

export function ListRow({ title, meta, leading, side, chevron, trailing, onPress, disabled, className }: ListRowProps) {
    const content = (
        <>
            {leading}
            <View className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={2} className="text-[15px] font-semibold leading-[20px]">{title}</Text>
                {!!meta && <Muted numberOfLines={2}>{meta}</Muted>}
            </View>
            {!!side && <Text className="text-[13px] font-semibold text-sm-text-muted">{side}</Text>}
            {trailing}
            {chevron && <ChevronRight />}
        </>
    )
    const rowClass = cn("w-full flex-row items-center gap-3.5 bg-sm-surface-raised py-2.5 pl-4 pr-4", leading ? "min-h-[76px]" : "min-h-14", className)
    if (!onPress) return <View className={rowClass}>{content}</View>
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={meta ? `${title}, ${meta}` : title}
            disabled={disabled}
            onPress={onPress}
            className={cn(rowClass, "active:bg-sm-surface-control", disabled && "opacity-60")}
        >
            {content}
        </Pressable>
    )
}

/** `.ps-list-cover`: a small 2:3 cover slot (expo-image goes inside once the screens show pictures) */
export function ListCover({ children }: { children?: React.ReactNode }) {
    return <View className="aspect-[2/3] w-11 overflow-hidden rounded-[8px] bg-sm-surface-control">{children}</View>
}

/** An icon tile for rows that lead with an icon (the settings areas, the menu) */
export function ListIcon({ children }: { children: React.ReactNode }) {
    return <View className="h-10 w-10 items-center justify-center rounded-surface-sm bg-sm-surface-control">{children}</View>
}
