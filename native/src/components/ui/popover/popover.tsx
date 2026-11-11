import { popoverIn, popoverOut } from "@/components/ui/core/animations"
import { cn } from "@/components/ui/core/styling"
import { usePortalKey } from "@/components/ui/core/portal-key"
import * as PopoverPrimitive from "@rn-primitives/popover"
import React from "react"
import { StyleSheet } from "react-native"
import Animated from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * Popover on @rn-primitives/popover in the look of `.ps-menu` (phone-screen.css): --sm-surface-raised, 12dp corners,
 * the floating shadow; it opens out of what was tapped from 95 % in 180 ms and settles back in 120 ms
 * (mobile-surface.css). A tap outside or Back closes it.
 */
export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverClose = PopoverPrimitive.Close

export function PopoverContent({ children, className, align = "center", side = "bottom", sideOffset = 6 }: {
    children: React.ReactNode
    className?: string
    align?: "start" | "center" | "end"
    side?: "top" | "bottom"
    sideOffset?: number
}) {
    const insets = useSafeAreaInsets()
    const portalKey = usePortalKey()
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Overlay key={portalKey} style={StyleSheet.absoluteFill}>
                <PopoverPrimitive.Content
                    align={align}
                    side={side}
                    sideOffset={sideOffset}
                    insets={{ top: insets.top + 8, bottom: insets.bottom + 8, left: 12, right: 12 }}
                >
                    <Animated.View
                        entering={popoverIn}
                        exiting={popoverOut}
                        // it grows out of its trigger: the edge facing it, at the side it is aligned to
                        style={{ transformOrigin: `${align === "start" ? "0%" : align === "end" ? "100%" : "50%"} ${side === "bottom" ? "0%" : "100%"}` }}
                        className={cn("min-w-48 max-w-[352px] rounded-surface-sm bg-sm-surface-raised p-1.5 shadow-menu", className)}
                    >
                        {children}
                    </Animated.View>
                </PopoverPrimitive.Content>
            </PopoverPrimitive.Overlay>
        </PopoverPrimitive.Portal>
    )
}
