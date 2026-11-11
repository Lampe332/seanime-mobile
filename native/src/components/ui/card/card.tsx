import { cn } from "@/components/ui/core/styling"
import { Muted, Text } from "@/components/ui/text/text"
import React from "react"
import { View, type ViewProps } from "react-native"

/*
 * Cards of the phone kit (phone-screen.css): one lightness step above the page (--sm-surface-raised), 16dp radius.
 *   Card       `.ps-notice`: a block of text with optional actions
 *   EmptyState `.ps-empty`: centred, says what is missing and what to do
 */
export function Card({ className, ...props }: ViewProps & { className?: string }) {
    return <View className={cn("gap-1 rounded-surface bg-sm-surface-raised p-4", className)} {...props} />
}

export function CardTitle({ children, className }: { children: React.ReactNode, className?: string }) {
    return <Text accessibilityRole="header" className={cn("text-base font-bold", className)}>{children}</Text>
}

export function CardDescription({ children, className }: { children: React.ReactNode, className?: string }) {
    return <Muted className={cn("text-[15px] leading-[22px] text-sm-text", className)}>{children}</Muted>
}

export function EmptyState({ title, description, children, className }: {
    title: string
    description?: string
    children?: React.ReactNode
    className?: string
}) {
    return (
        <View className={cn("items-center gap-1.5 rounded-surface bg-sm-surface-raised px-4 py-6", className)}>
            <Text className="text-center text-[15px] font-semibold">{title}</Text>
            {!!description && <Muted className="max-w-[352px] text-center">{description}</Muted>}
            {!!children && <View className="mt-2 flex-row flex-wrap justify-center gap-2">{children}</View>}
        </View>
    )
}
