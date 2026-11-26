/**
 * The app's toasts with sonner's call shape (`toast.success("…")`), so the API hooks copied from seanime-web call it
 * unchanged. <Toaster /> (toaster.tsx) draws them; this file has no React Native import so logic tests can load it.
 */
import { pageTop } from "@/components/shared/page-top"
import { MINI_CARD, type MiniFrame } from "@/main/_features/player/player-chrome"

export type ToastType = "default" | "success" | "error" | "warning" | "info"

export type ToastOptions = {
    id?: string | number
    description?: string
    /** ms; sonner's default is 4000 */
    duration?: number
    action?: { label: string, onClick: () => void }
}

export type ToastItem = {
    id: string | number
    type: ToastType
    title: string
    description?: string
    duration: number
    action?: ToastOptions["action"]
    createdAt: number
}

const DEFAULT_DURATION = 4000
/** sonner showed at most this many at once (toaster.tsx `visibleToasts: 4`) */
export const VISIBLE_TOASTS = 4

/**
 * How far under the page's top (page-top.ts) the toasts start: under the head's buttons on every page. The tallest head
 * is Home's (the "Seanime Mobile" line over the title): its 48dp buttons end about 53dp under the page's top (S22 15.11.); the
 * other heads (page-head.ts: the 32dp title line, the buttons overhanging it by 8dp) end theirs at 40dp. 16dp from the
 * top edge, as before, covered Refresh, Filter and the other head buttons.
 */
export const TOAST_TOP_UNDER_HEAD = 64

/** Room between the toasts and the mini player under them (tablet) */
export const TOAST_ABOVE_MINI = 12

export type ToasterFrame = { edge: "top" | "bottom", top?: number, bottom?: number, left?: number, right: number, width?: number }

/**
 * Where the toaster sits. Phone (sonner 2.0.7, `position="top-right"`): up to 600dp wide (its `max-width: 600px` rule)
 * the toasts span the width 16dp from the sides; wider they are 356dp, 24dp from the right; their top is under the page
 * head (TOAST_TOP_UNDER_HEAD). Tablet with the rail: 356dp at the bottom right, at the mini card's 20dp edges, and
 * TOAST_ABOVE_MINI over the mini player while it shows; at the top right they covered the detail page's tab row.
 */
export function toasterFrame(windowWidth: number, insets: { top: number, bottom: number, right: number },
    tablet?: { rail: boolean, mini: Pick<MiniFrame, "bottom" | "height"> | null }): ToasterFrame {
    if (tablet?.rail) {
        const floor = insets.bottom + MINI_CARD.edge
        const bottom = tablet.mini ? Math.max(floor, tablet.mini.bottom + tablet.mini.height + TOAST_ABOVE_MINI) : floor
        return { edge: "bottom", bottom, right: insets.right + MINI_CARD.edge, width: 356 }
    }
    const top = pageTop(insets.top) + TOAST_TOP_UNDER_HEAD
    return windowWidth <= 600 ? { edge: "top", top, left: 16, right: 16 } : { edge: "top", top, right: 24, width: 356 }
}

/**
 * sonner's collapsed stack: the newest toast (index 0) in front, each older one 14dp (GAP) further back and 5% smaller
 * behind it, as tall as the front one with its own content hidden. Back is down for top toasts, up for bottom ones.
 */
export function stackedToast(index: number, edge: "top" | "bottom" = "top"): { translateY: number, scale: number, contentOpacity: number } {
    "worklet"
    return { translateY: (edge === "top" ? 1 : -1) * index * 14, scale: 1 - index * 0.05, contentOpacity: index === 0 ? 1 : 0 }
}

let toasts: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
    for (const listener of listeners) listener()
}

function show(type: ToastType, title: unknown, options?: ToastOptions) {
    const id = options?.id ?? nextId++
    const item: ToastItem = {
        id,
        type,
        title: String(title ?? ""),
        description: options?.description,
        duration: options?.duration ?? DEFAULT_DURATION,
        action: options?.action,
        createdAt: Date.now(),
    }
    // Same id replaces the toast in place (sonner's update behaviour)
    toasts = [...toasts.filter(t => t.id !== id), item]
    emit()
    return id
}

function dismiss(id?: string | number) {
    toasts = id === undefined ? [] : toasts.filter(t => t.id !== id)
    emit()
}

type ToastFn = ((title: unknown, options?: ToastOptions) => string | number) & {
    success: (title: unknown, options?: ToastOptions) => string | number
    error: (title: unknown, options?: ToastOptions) => string | number
    warning: (title: unknown, options?: ToastOptions) => string | number
    info: (title: unknown, options?: ToastOptions) => string | number
    dismiss: (id?: string | number) => void
}

export const toast: ToastFn = Object.assign((title: unknown, options?: ToastOptions) => show("default", title, options), {
    success: (title: unknown, options?: ToastOptions) => show("success", title, options),
    error: (title: unknown, options?: ToastOptions) => show("error", title, options),
    warning: (title: unknown, options?: ToastOptions) => show("warning", title, options),
    info: (title: unknown, options?: ToastOptions) => show("info", title, options),
    dismiss,
})

export function subscribeToasts(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function getToasts() {
    return toasts
}
