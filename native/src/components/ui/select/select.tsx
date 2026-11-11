import { popoverIn, popoverOut } from "@/components/ui/core/animations"
import { cn } from "@/components/ui/core/styling"
import { usePortalKey } from "@/components/ui/core/portal-key"
import { Text } from "@/components/ui/text/text"
import { MobileIcon } from "@/lib/mobile-icons"
import { colors } from "@/lib/theme/tokens"
import * as SelectPrimitive from "@rn-primitives/select"
import React from "react"
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native"
import Animated from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Path } from "react-native-svg"

/*
 * Select (Auswahl) on @rn-primitives/select. The trigger looks like `.ps-select` (phone-screen.css): 52dp, 16dp corners,
 * --sm-surface-raised, a chevron on the right. The list opens like the phone menus (`.ps-menu`): raised surface, 48dp
 * rows, the chosen row marked with the accent check.
 */
export type SelectOption = { value: string, label: string }

function Chevron() {
    return (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.smTextMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m6 9 6 6 6-6" />
        </Svg>
    )
}

export function Select({ value, onValueChange, options, placeholder, disabled, className, triggerClassName, valueClassName, accessibilityLabel }: {
    value: string | undefined
    onValueChange: (value: string) => void
    options: SelectOption[]
    placeholder: string
    disabled?: boolean
    className?: string
    /** e.g. the control surface of a select inside a raised settings row (`.pst-select .ps-select`) */
    triggerClassName?: string
    /** the shown value's text, e.g. the smaller `.mobile-source-fields` combobox */
    valueClassName?: string
    accessibilityLabel?: string
}) {
    const insets = useSafeAreaInsets()
    const { height } = useWindowDimensions()
    const [triggerWidth, setTriggerWidth] = React.useState(0)
    const portalKey = usePortalKey()
    const selected = options.find(o => o.value === value)

    return (
        <SelectPrimitive.Root
            value={selected ? { value: selected.value, label: selected.label } : undefined}
            onValueChange={option => {
                if (option) onValueChange(option.value)
            }}
            disabled={disabled}
            className={className}
        >
            <SelectPrimitive.Trigger
                accessibilityLabel={accessibilityLabel}
                onLayout={e => setTriggerWidth(e.nativeEvent.layout.width)}
                className={cn("min-h-[52px] flex-row items-center justify-between gap-2 rounded-surface bg-sm-surface-raised pl-4 pr-4",
                    "active:bg-sm-surface-control", disabled && "opacity-60", triggerClassName)}
            >
                <SelectPrimitive.Value
                    placeholder={placeholder}
                    numberOfLines={1}
                    className={cn("flex-1 font-sans text-[15px]", selected ? "text-sm-text" : "text-sm-text-subtle", valueClassName)}
                />
                <Chevron />
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Portal>
                <SelectPrimitive.Overlay key={portalKey} style={StyleSheet.absoluteFill}>
                    <SelectPrimitive.Content
                        sideOffset={6}
                        insets={{ top: insets.top + 8, bottom: insets.bottom + 8, left: 12, right: 12 }}
                    >
                        <Animated.View
                            entering={popoverIn}
                            exiting={popoverOut}
                            style={{ width: triggerWidth || undefined, maxHeight: Math.min(400, height * 0.5) }}
                            className="rounded-surface-sm bg-sm-surface-raised p-1.5 shadow-menu"
                        >
                            <ScrollView showsVerticalScrollIndicator={false}>
                                {options.map(option => (
                                    <SelectPrimitive.Item
                                        key={option.value}
                                        value={option.value}
                                        label={option.label}
                                        className="min-h-12 flex-row items-center gap-3 rounded-[8px] px-3 active:bg-sm-surface-control"
                                    >
                                        <SelectPrimitive.ItemText className="flex-1 font-sans text-[15px] text-sm-text" />
                                        <View className="h-5 w-5 items-center justify-center">
                                            <SelectPrimitive.ItemIndicator>
                                                <MobileIcon name="check" size={20} color={colors.smAccent} />
                                            </SelectPrimitive.ItemIndicator>
                                        </View>
                                    </SelectPrimitive.Item>
                                ))}
                            </ScrollView>
                        </Animated.View>
                    </SelectPrimitive.Content>
                </SelectPrimitive.Overlay>
            </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
    )
}

/** A labelled select row group like the settings pages: label above, the select under it. */
export function SelectField(props: React.ComponentProps<typeof Select> & { label: string }) {
    const { label, ...rest } = props
    return (
        <View className="gap-2">
            <Text className="text-[13px] font-medium text-sm-text-muted">{label}</Text>
            <Select {...rest} accessibilityLabel={rest.accessibilityLabel ?? label} />
        </View>
    )
}
