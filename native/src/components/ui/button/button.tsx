import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { usePressScale } from "@/components/ui/core/press"
import { cva, type VariantProps } from "class-variance-authority"
import React from "react"
import { ActivityIndicator, Pressable, type PressableProps, View } from "react-native"
import Animated from "react-native-reanimated"

/*
 * The phone kit's buttons (phone-screen.css): `.ps-primary` (brand fill), `.ps-secondary` (control surface),
 * `.ps-text-action` (accent text), `.ps-icon-button` (48dp round icon). All are at least 48dp tall, pills, and give way
 * to scale .97 on press (motion.css) while their colour changes at once.
 */
const ButtonAnatomy = {
    root: cva("flex-row items-center justify-center gap-2 rounded-full", {
        variants: {
            intent: {
                primary: "bg-brand-500 active:bg-brand-600 px-5",
                secondary: "bg-sm-surface-control active:bg-sm-line-strong px-5",
                danger: "bg-sm-danger px-5",
                text: "px-2 active:bg-sm-surface-control",
                icon: "w-12 h-12 active:bg-sm-surface-control",
            },
            size: {
                md: "min-h-12",
                lg: "min-h-[52px]",
            },
            disabled: { true: "opacity-50" },
        },
        compoundVariants: [{ intent: "icon", size: "md", className: "min-h-12" }],
        defaultVariants: { intent: "primary", size: "md" },
    }),
    label: cva("text-[15px] text-center", {
        variants: {
            intent: {
                primary: "text-white font-semibold",
                secondary: "text-sm-text font-semibold",
                danger: "text-[#1a1a1d] font-semibold",
                text: "text-sm-accent font-semibold",
                icon: "text-sm-text-muted",
            },
        },
        defaultVariants: { intent: "primary" },
    }),
}

const SPINNER_COLOR = { primary: "#ffffff", secondary: "#ededf0", danger: "#1a1a1d", text: "rgb(199, 194, 255)", icon: "#b6b6bc" } as const

export type ButtonProps = Omit<PressableProps, "children"> & VariantProps<typeof ButtonAnatomy.root> & {
    className?: string
    /** classes of the outer (scaling) view, e.g. flex-1 in a row of actions */
    wrapperClassName?: string
    labelClassName?: string
    children?: React.ReactNode
    leftIcon?: React.ReactNode
    rightIcon?: React.ReactNode
    loading?: boolean
}

/** The size a Button takes when it sets none: a sheet's footer makes its buttons 52dp (`.ps-sheet-actions > *`) */
export const ButtonSizeContext = React.createContext<"md" | "lg">("md")

export function Button(props: ButtonProps) {
    const contextSize = React.useContext(ButtonSizeContext)
    const { intent = "primary", size = contextSize, className, wrapperClassName, labelClassName, children, leftIcon, rightIcon, loading, disabled, onPressIn, onPressOut, ...rest } = props
    const isDisabled = !!disabled || !!loading
    const { animatedStyle, pressIn, pressOut } = usePressScale()
    const resolvedIntent = intent ?? "primary"
    return (
        <Animated.View style={animatedStyle} className={wrapperClassName}>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: isDisabled, busy: !!loading }}
                disabled={isDisabled}
                onPressIn={e => {
                    pressIn()
                    onPressIn?.(e)
                }}
                onPressOut={e => {
                    pressOut()
                    onPressOut?.(e)
                }}
                className={cn(ButtonAnatomy.root({ intent, size, disabled: isDisabled }), className)}
                {...rest}
            >
                {loading ? <ActivityIndicator size="small" color={SPINNER_COLOR[resolvedIntent]} /> : leftIcon}
                {typeof children === "string"
                    ? <Text numberOfLines={1} className={cn(ButtonAnatomy.label({ intent }), labelClassName)}>{children}</Text>
                    : children ? <View>{children}</View> : null}
                {rightIcon}
            </Pressable>
        </Animated.View>
    )
}
