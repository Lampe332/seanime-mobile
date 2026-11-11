/**
 * The app's toasts with sonner's call shape (`toast.success("…")`), so the API hooks copied from seanime-web call it
 * unchanged. <Toaster /> (toaster.tsx) draws them; this file has no React Native import so logic tests can load it.
 */
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
 * Where the toaster sits (sonner 2.0.7, `position="top-right"`). Up to 600dp wide (its `max-width: 600px` rule) the
 * toasts span the width 16dp from the sides and 16dp from the top edge; wider they are 356dp, 24dp from the top right.
 * The old WebView drew under the status bar and the camera cutout, so the top inset is not added (S22 10.11.: the toast
 * sat 27dp lower than in 2.0.32).
 */
export function toasterFrame(windowWidth: number): { top: number, left?: number, right: number, width?: number } {
    return windowWidth <= 600 ? { top: 16, left: 16, right: 16 } : { top: 24, right: 24, width: 356 }
}

/**
 * sonner's collapsed stack: the newest toast (index 0) in front, each older one 14dp (GAP) lower and 5% smaller behind
 * it, as tall as the front one with its own content hidden.
 */
export function stackedToast(index: number): { translateY: number, scale: number, contentOpacity: number } {
    "worklet"
    return { translateY: index * 14, scale: 1 - index * 0.05, contentOpacity: index === 0 ? 1 : 0 }
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
