import { cn } from "@/components/ui/core/styling"
import { Muted, Text } from "@/components/ui/text/text"
import { haptic } from "@/lib/feedback"
import { DURATION, MOTION_EASE_OUT } from "@/lib/motion"
import { useThemeColors } from "@/lib/theme/appearance"
import * as SwitchPrimitive from "@rn-primitives/switch"
import React from "react"
import { Pressable, View } from "react-native"
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useDerivedValue, withTiming } from "react-native-reanimated"

/*
 * `.ps-toggle` (phone-screen.css): a 48×28 track with a 20dp knob. Off: control surface with a hairline ring and a muted
 * knob; on: the accent track and a white knob 20dp to the right. The knob slides on the strong ease-out in 180 ms
 * (transform); the colours follow in the same time. Reanimated moves only position and opacity: the colours are plain styles
 * of two layers that cross-fade, so a new palette shows at once.
 */
const KNOB_TRAVEL = 20
const TOGGLE_EASING = Easing.bezier(...MOTION_EASE_OUT)

export type SwitchProps = {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    disabled?: boolean
    accessibilityLabel?: string
    className?: string
}

export function Switch({ checked, onCheckedChange, disabled, accessibilityLabel, className }: SwitchProps) {
    const colors = useThemeColors()
    const progress = useDerivedValue(() => withTiming(checked ? 1 : 0, {
        duration: DURATION.toggle,
        easing: TOGGLE_EASING,
        reduceMotion: ReduceMotion.System,
    }), [checked])
    const onStyle = useAnimatedStyle(() => ({ opacity: progress.get() }))
    const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: progress.get() * KNOB_TRAVEL }] }))
    return (
        <SwitchPrimitive.Root
            checked={checked}
            onCheckedChange={value => {
                // every switch of the app ticks when it is flipped (lib/feedback.ts in the web app)
                haptic("tick")
                onCheckedChange(value)
            }}
            disabled={disabled}
            accessibilityLabel={accessibilityLabel}
            className={cn("h-7 w-12", disabled && "opacity-60", className)}
        >
            <View className="h-7 w-12 rounded-full border" style={{ backgroundColor: colors.smSurfaceControl, borderColor: colors.smLineStrong }} />
            <Animated.View className="absolute inset-0 rounded-full border" style={[{ backgroundColor: colors.smAccentStrong, borderColor: colors.smAccentClear }, onStyle]} />
            <SwitchPrimitive.Thumb asChild>
                <Animated.View style={knobStyle} className="absolute left-1 top-1 h-5 w-5 rounded-full">
                    <View className="absolute inset-0 rounded-full" style={{ backgroundColor: colors.smTextMuted }} />
                    <Animated.View className="absolute inset-0 rounded-full bg-white" style={onStyle} />
                </Animated.View>
            </SwitchPrimitive.Thumb>
        </SwitchPrimitive.Root>
    )
}

/**
 * `.ps-check`: a whole row toggles (min 52dp, label and optional note left, the switch right); pressed, the row lights up.
 */
export function SwitchRow({ label, description, checked, onCheckedChange, disabled, className }: {
    label: string
    description?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    disabled?: boolean
    className?: string
}) {
    return (
        <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked, disabled: !!disabled }}
            accessibilityLabel={label}
            disabled={disabled}
            onPress={() => {
                haptic("tick")
                onCheckedChange(!checked)
            }}
            className={cn("min-h-[52px] w-full flex-row items-center justify-between gap-3 bg-sm-surface-raised px-4 py-2.5 active:bg-sm-surface-control",
                disabled && "opacity-60", className)}
        >
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-[15px]">{label}</Text>
                {!!description && <Muted className="leading-[19px]">{description}</Muted>}
            </View>
            <View pointerEvents="none">
                <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
            </View>
        </Pressable>
    )
}
