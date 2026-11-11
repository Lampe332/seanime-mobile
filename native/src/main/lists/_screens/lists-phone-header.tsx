import { PhoneHeadTray } from "@/components/shared/phone-screen"
import { HEAD_ACTIONS_STYLE } from "@/components/shared/page-head"
import { cn } from "@/components/ui/core/styling"
import { Heading, Muted, Text } from "@/components/ui/text/text"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import React from "react"
import { Pressable, View } from "react-native"
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated"

type Icon = React.ComponentType<{ size?: number, color?: string }>

/** `.ps-header` of My lists: the title, its facts line under it and the actions on the right. */
export function ListsHeader({ title, facts, children }: { title: string, facts: string, children?: React.ReactNode }) {
    return (
        <View className="flex-row flex-wrap items-center justify-between gap-x-2 pt-1">
            <Heading className="min-w-0 flex-1">{title}</Heading>
            {/* the buttons overhang the title's line, so this head is as tall as Discover's (page-head.ts) */}
            {children ? <View className="-mr-2 flex-row items-center" style={HEAD_ACTIONS_STYLE}><PhoneHeadTray />{children}</View>
                : <View style={HEAD_ACTIONS_STYLE}><PhoneHeadTray /></View>}
            <Muted className="mt-[3px] w-full" style={{ fontVariant: ["tabular-nums"] }}>{facts}</Muted>
        </View>
    )
}

/** The refresh icon turns while AniList refreshes (`.ps-spin`); reduced motion keeps it still. */
function Spinning({ active, children }: { active: boolean, children: React.ReactNode }) {
    const turn = useSharedValue(0)
    React.useEffect(() => {
        if (!active) {
            turn.set(0)
            return
        }
        turn.set(withRepeat(withTiming(360, { duration: 900, easing: Easing.linear, reduceMotion: ReduceMotion.System }), -1, false))
    }, [active, turn])
    const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }))
    return <Animated.View style={style}>{children}</Animated.View>
}

/**
 * `.ps-icon-button` with its TabletLabel: a 48dp icon on the phone, icon and word as one pill on the tablet. `pressed`
 * (the stats switch) takes the accent; `square` is the 56dp tile beside Anime | Manga (`.pl-switch > .ps-icon-button`).
 */
export function ListsAction({ icon: IconComponent, label, accessibilityLabel, onPress, pressed, disabled, dot, spinning, square }: {
    icon: Icon
    label: string
    accessibilityLabel?: string
    onPress: () => void
    pressed?: boolean
    disabled?: boolean
    dot?: boolean
    spinning?: boolean
    square?: boolean
}) {
    const { rail } = useTabletLayout()
    // the tablet shows the word in the tile beside Anime | Manga too (2.0.33: "Stats" there), the tile then grows to fit
    const withLabel = rail
    const color = pressed ? colors.smAccent : colors.smTextMuted
    return (
        <Pressable
            accessibilityRole={pressed === undefined ? "button" : "togglebutton"}
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled: !!disabled, busy: !!spinning, ...(pressed !== undefined ? { checked: pressed } : null) }}
            disabled={disabled}
            onPress={onPress}
            className={cn("flex-row items-center justify-center",
                square ? cn("h-14 rounded-surface-sm", withLabel ? "min-w-14" : "w-14") : "h-12 min-w-12 rounded-full",
                square && !pressed && "bg-sm-surface-sunken",
                pressed ? "bg-sm-accent-soft" : "active:bg-sm-surface-control",
                withLabel && "gap-2 pl-3.5 pr-[18px]",
                disabled && "opacity-50")}
        >
            <Spinning active={!!spinning}><IconComponent size={withLabel ? 18 : 22} color={color} /></Spinning>
            {withLabel && <Text className={cn("text-sm font-semibold", pressed ? "text-sm-accent" : "text-sm-text-muted")}>{label}</Text>}
            {dot && <View style={withLabel ? { top: 10, left: 29 } : { top: 11, right: 11 }} className="absolute h-2 w-2 rounded-full bg-sm-accent" />}
        </Pressable>
    )
}
