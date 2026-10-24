import { cn } from "@/components/ui/core/styling"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import * as React from "react"
import { Drawer as VaulPrimitive } from "vaul"

const Vaul = ({
    shouldScaleBackground = true,
    ...props
}: React.ComponentProps<typeof VaulPrimitive.Root>) => (
    <VaulPrimitive.Root
        shouldScaleBackground={shouldScaleBackground}
        {...props}
    />
)
Vaul.displayName = "Vaul"

const VaulOverlay = React.forwardRef<
    React.ElementRef<typeof VaulPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof VaulPrimitive.Overlay>
>(({ className, ...props }, ref) => {
    const ts = useThemeSettings()
    return (
        <VaulPrimitive.Overlay
            ref={ref}
            className={cn(
                "fixed inset-0 z-50 bg-black/80",
                ts.enableBlurringEffects && "bg-gray-950/70 backdrop-blur-sm firefox:backdrop-blur-none",
                className)}
            {...props}
        />
    )
})
VaulOverlay.displayName = VaulPrimitive.Overlay.displayName

const VaulContent = React.forwardRef<
    React.ElementRef<typeof VaulPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof VaulPrimitive.Content> & { overlayClass?: string }
>(({ className, title, children, overlayClass, ...props }, ref) => {
    return (
        <VaulPrimitive.Portal>
            <VaulOverlay className={overlayClass} />
            <VaulPrimitive.Content
                ref={ref}
                className={cn(
                    "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-2xl border border-b-0 bg-[var(--background)]",
                    "select-none focus:outline-none outline-none outline-0 focus:outline-0",
                    className,
                )}
                {...props}
            >
                {!title ? (
                    <VisuallyHidden>
                        <VaulPrimitive.Title>Drawer</VaulPrimitive.Title>
                    </VisuallyHidden>
                ) : <VaulTitle>
                    {title}
                </VaulTitle>}
                {children}
            </VaulPrimitive.Content>
        </VaulPrimitive.Portal>
    )
})
VaulContent.displayName = "VaulContent"

const VaulTitle = React.forwardRef<
    React.ElementRef<typeof VaulPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof VaulPrimitive.Title>
>(({ className, ...props }, ref) => {
    return (
        <VaulPrimitive.Title
            ref={ref}
            className={cn(
                "text-2xl font-semibold leading-none tracking-tight",
                className,
            )}
            {...props}
        />
    )
})
VaulTitle.displayName = VaulPrimitive.Title.displayName

export { Vaul, VaulContent }
