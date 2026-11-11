import { type Glide, GlidePill, GlideStandIn, useGlide } from "@/components/ui/core/glide"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { pressTourTarget, useTourTarget } from "@/main/_features/tour/tour-targets"
import * as TabsPrimitive from "@rn-primitives/tabs"
import React from "react"
import { type LayoutChangeEvent, ScrollView, View } from "react-native"

/*
 * Tabs in the two looks of the phone kit (phone-screen.css):
 *   segment  `.ps-segment`: two or three equal options on a sunken track (Anime / Schedule / Manga); the chosen one on the
 *            control surface in full text colour
 *   pills    `.ps-tabs`: pills with counts in a row that scrolls sideways on its own; the chosen one in the accent
 */
export type TabItem = { value: string, label: string, count?: number, /** a setup-tour target name (tour-targets.ts) */ tourTarget?: string }

export type TabsProps = {
    value: string
    onValueChange: (value: string) => void
    items: TabItem[]
    variant?: "segment" | "pills"
    className?: string
    children?: React.ReactNode
    /** a switch built anew for its own choice takes over its old bubble under this name, so it still glides (glide.tsx) */
    glideMemory?: string
}

const BUBBLE = { segment: "rounded-[8px] bg-sm-surface-control", pills: "rounded-full bg-sm-accent-soft" } as const

function TabTrigger({ item, selected, variant, onLayout, glide }: {
    item: TabItem, selected: boolean, variant: "segment" | "pills", onLayout: (event: LayoutChangeEvent) => void, glide: Glide
}) {
    const tourRef = useTourTarget(item.tourTarget ?? null)
    return (
        <TabsPrimitive.Trigger
            ref={tourRef}
            value={item.value}
            onPress={item.tourTarget ? () => pressTourTarget(item.tourTarget!) : undefined}
            onLayout={onLayout}
            accessibilityState={{ selected }}
            // the chosen option's background is the gliding bubble (GlidePill in Tabs)
            className={variant === "segment"
                ? "min-h-12 flex-1 items-center justify-center rounded-[8px] px-2 py-1"
                : cn("min-h-12 flex-row items-center gap-1.5 rounded-full px-4",
                    !selected && "bg-sm-surface-raised active:bg-sm-surface-control")}
        >
            <GlideStandIn glide={glide} optionKey={item.value} className={BUBBLE[variant]} />
            <Text
                numberOfLines={1}
                className={variant === "segment"
                    ? cn("text-[15px]", selected ? "font-semibold text-sm-text" : "font-medium text-sm-text-muted")
                    : cn("text-sm", selected ? "font-semibold text-sm-accent" : "font-medium text-sm-text-muted")}
            >
                {item.label}
            </Text>
            {variant === "pills" && item.count !== undefined && (
                <Text className={cn("text-sm", selected ? "font-semibold text-sm-accent" : "text-sm-text-subtle")}>{item.count}</Text>
            )}
        </TabsPrimitive.Trigger>
    )
}

export function Tabs({ value, onValueChange, items, variant = "segment", className, children, glideMemory }: TabsProps) {
    const glide = useGlide(items.some(item => item.value === value) ? value : null, glideMemory)
    const triggers = items.map(item => <TabTrigger key={item.value} item={item} selected={item.value === value} variant={variant}
        onLayout={glide.onOptionLayout(item.value)} glide={glide} />)

    return (
        <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={className}>
            {variant === "segment" ? (
                <TabsPrimitive.List className="flex-row gap-1 rounded-surface-sm bg-sm-surface-sunken p-1">
                    <GlidePill glide={glide} className={BUBBLE.segment} />
                    {triggers}
                </TabsPrimitive.List>
            ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4" contentContainerClassName="gap-2 px-4">
                    <TabsPrimitive.List className="flex-row gap-2">
                        <GlidePill glide={glide} className={BUBBLE.pills} />
                        {triggers}
                    </TabsPrimitive.List>
                </ScrollView>
            )}
            {children}
        </TabsPrimitive.Root>
    )
}

/** The panel of one tab; only the chosen tab's panel is mounted. */
export function TabPanel({ value, children, className }: { value: string, children: React.ReactNode, className?: string }) {
    return (
        <TabsPrimitive.Content value={value} className={className}>
            <View>{children}</View>
        </TabsPrimitive.Content>
    )
}
