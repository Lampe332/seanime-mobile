import { cva } from "class-variance-authority"
import * as React from "react"
import { Toaster as Sonner } from "sonner"
import { cn, defineStyleAnatomy } from "../core/styling"

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const ToasterAnatomy = defineStyleAnatomy({
    toaster: cva(["group toaster z-[150]"]),
    toast: cva([
        "group/toast",
        "select-none cursor-default",
        "group-[.toaster]:py-3 group-[.toaster]:px-4 group-[.toaster]:gap-3",
        "group-[.toaster]:text-sm group-[.toaster]:font-medium",
        "group-[.toaster]:rounded-xl group-[.toaster]:border group-[.toaster]:backdrop-blur-sm",
        // "group-[.toaster]:ring-1 group-[.toaster]:ring-inset",
        "group-[.toaster]:transition-all group-[.toaster]:duration-200",
        // Default/Base style
        // "group-[.toaster]:bg-gradient-to-br group-[.toaster]:from-[--paper] group-[.toaster]:to-[--paper]/80",
        "group-[.toaster]:text-[--foreground] group-[.toaster]:border-[--border]",
        "group-[.toaster]:ring-[--border]",
        // Success
        "group-[.toaster]:data-[type=success]:bg-green-800",
        // "group-[.toaster]:data-[type=success]:from-emerald-950/95 group-[.toaster]:data-[type=success]:to-emerald-900/60",
        "group-[.toaster]:data-[type=success]:text-emerald-100",
        "group-[.toaster]:data-[type=success]:border-green-700/50",
        "group-[.toaster]:data-[type=success]:ring-emerald-700/40",
        // Warning
        "group-[.toaster]:data-[type=warning]:bg-orange-800",
        // "group-[.toaster]:data-[type=warning]:from-orange-950/95 group-[.toaster]:data-[type=warning]:to-orange-900/60",
        "group-[.toaster]:data-[type=warning]:text-orange-100",
        "group-[.toaster]:data-[type=warning]:border-orange-700/50",
        "group-[.toaster]:data-[type=warning]:ring-orange-700/40",
        // Error
        "group-[.toaster]:data-[type=error]:bg-red-800",
        // "group-[.toaster]:data-[type=error]:from-red-950/95 group-[.toaster]:data-[type=error]:to-red-900/60",
        "group-[.toaster]:data-[type=error]:text-red-100",
        "group-[.toaster]:data-[type=error]:border-red-700/50",
        "group-[.toaster]:data-[type=error]:ring-red-700/40",
        // Info
        "group-[.toaster]:data-[type=info]:bg-blue-800",
        // "group-[.toaster]:data-[type=info]:from-blue-950/95 group-[.toaster]:data-[type=info]:to-blue-900/60",
        "group-[.toaster]:data-[type=info]:text-blue-100",
        "group-[.toaster]:data-[type=info]:border-blue-700/50",
        "group-[.toaster]:data-[type=info]:ring-blue-700/40",
    ]),
    description: cva([
        "group/toast:text-xs group/toast:font-normal group/toast:mt-1",
        "group/toast:opacity-80",
        "group-data-[type=success]/toast:text-emerald-300",
        "group-data-[type=warning]/toast:text-amber-300",
        "group-data-[type=error]/toast:text-red-300",
        "group-data-[type=info]/toast:text-blue-300",
        "cursor-default",
    ]),
    actionButton: cva([
        "group/toast:bg-[--subtle] group/toast:text-[--foreground]",
        "group/toast:rounded-lg group/toast:px-3 group/toast:py-1.5",
        "group/toast:text-xs group/toast:font-medium",
        "group/toast:transition-colors group/toast:hover:bg-[--subtle-hover]",
        "group/toast:ring-1 group/toast:ring-[--border]/20",
    ]),
    cancelButton: cva([
        "group/toast:bg-transparent group/toast:text-[--muted]",
        "group/toast:rounded-lg group/toast:px-3 group/toast:py-1.5",
        "group/toast:text-xs group/toast:font-medium",
        "group/toast:transition-colors group/toast:hover:bg-[--subtle]",
        "group/toast:ring-1 group/toast:ring-transparent group/toast:hover:ring-[--border]/20",
    ]),
})

/* -------------------------------------------------------------------------------------------------
 * Toaster
 * -----------------------------------------------------------------------------------------------*/

export type ToasterProps = React.ComponentProps<typeof Sonner>

const IS_ANDROID_APP = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile"

/**
 * After a touch, Android sends mouse events to whatever appears under the finger's last spot. Sonner takes them for
 * hovering and keeps its toasts until the next touch elsewhere, and the player's back button sits where toasts appear.
 * The app has no mouse, so they never reach the toaster (swipes and taps are pointer and click events and still do).
 */
function useNoHoverOnTouch() {
    React.useEffect(() => {
        if (!IS_ANDROID_APP) return
        const inToaster = (node: EventTarget | null) => !!(node as Element | null)?.closest?.("[data-sonner-toaster]")
        // React makes its mouseenter from a mouseover on the toaster and from a mouseout towards it
        const block = (event: Event) => {
            if (event.type === "mouseout" ? inToaster((event as MouseEvent).relatedTarget) : inToaster(event.target)) event.stopPropagation()
        }
        const types = ["mouseover", "mousemove", "mouseout"]
        types.forEach(type => window.addEventListener(type, block, true))
        return () => types.forEach(type => window.removeEventListener(type, block, true))
    }, [])
}

export const Toaster = ({ position = "top-right", ...props }: ToasterProps) => {
    useNoHoverOnTouch()

    const allProps = React.useMemo(() => ({
        position,
        visibleToasts: 4,
        className: cn(ToasterAnatomy.toaster()),
        toastOptions: {
            classNames: {
                // Android: the app's raised surface with a coloured icon (mobile-surface.css) instead of a coloured block
                toast: cn(ToasterAnatomy.toast(), import.meta.env.SEA_PUBLIC_PLATFORM === "mobile" && "sm-toast"),
                description: cn(ToasterAnatomy.description()),
                actionButton: cn(ToasterAnatomy.actionButton()),
                cancelButton: cn(ToasterAnatomy.cancelButton()),
            },
        },
        ...props,
    } as ToasterProps), [])

    return (
        <>
            <Sonner theme="dark" {...allProps} />
        </>
    )
}

Toaster.displayName = "Toaster"
