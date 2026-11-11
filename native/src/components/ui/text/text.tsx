import { cn } from "@/components/ui/core/styling"
import React from "react"
import { Text as RNText, type TextProps as RNTextProps } from "react-native"

export type TextProps = RNTextProps & { className?: string }

/**
 * Text in the app's face (Inter) and the phone kit's text colour (--sm-text). React Native does not inherit fonts or
 * colours from a parent view, so every text goes through this instead of the bare <Text>.
 */
export function Text({ className, ...props }: TextProps) {
    return <RNText className={cn("font-sans text-[15px] text-sm-text", className)} {...props} />
}

/** A page head like `.ps-header h1`: 28dp, bold, tight. */
export function Heading({ className, ...props }: TextProps) {
    return <Text accessibilityRole="header" className={cn("text-[28px] leading-[32px] font-bold tracking-[-0.84px]", className)} {...props} />
}

/** A section head like `.ps-section-head h2`: 20dp bold. */
export function SectionTitle({ className, ...props }: TextProps) {
    return <Text accessibilityRole="header" className={cn("text-xl leading-[27px] font-bold tracking-[-0.3px]", className)} {...props} />
}

/** Quiet secondary line (`.ps-header p`, `.ps-sheet-note`): 13dp in --sm-text-muted. */
export function Muted({ className, ...props }: TextProps) {
    return <Text className={cn("text-[13px] leading-[19px] text-sm-text-muted", className)} {...props} />
}
