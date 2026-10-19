import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { LuArrowLeft, LuX } from "react-icons/lu"
import { useTr } from "@/lib/app-language"
import { cn } from "@/components/ui/core/styling"
import "./mobile-workspace.css"

/** Opt-in surface for mobile workflows; independent of document scroll and native modal patches. */
export function MobileWorkspace({ open, onOpenChange, title, subtitle, children, footer, onBack, className, trigger }: {
    open: boolean; onOpenChange: (open: boolean) => void; title: React.ReactNode; subtitle?: React.ReactNode
    children: React.ReactNode; footer?: React.ReactNode; onBack?: () => void; className?: string; trigger?: React.ReactElement
}) {
    const tr = useTr()
    const content = React.useRef<HTMLDivElement>(null)
    const returnFocus = React.useRef<HTMLElement | null>(null)
    React.useLayoutEffect(() => {
        if (!open) return
        returnFocus.current = document.activeElement as HTMLElement
        const viewport = window.visualViewport
        const resize = () => {
            const native = (window as Window & { __seanimeInsets?: { bottom: number; top: number } }).__seanimeInsets
            const nativeInset = Math.max(0, (native?.bottom || 0) / window.devicePixelRatio - Math.max(0, window.screen.height - window.innerHeight))
            const visualInset = Math.max(0, window.innerHeight - (viewport?.height || window.innerHeight) - (viewport?.offsetTop || 0))
            content.current?.style.setProperty("--workspace-bottom", `${Math.max(nativeInset, visualInset)}px`)
            content.current?.style.setProperty("--workspace-height", `${(viewport?.height || window.innerHeight) - Math.max(0, nativeInset - visualInset)}px`)
            content.current?.style.setProperty("--workspace-top", `${(native?.top || 0) / window.devicePixelRatio}px`)
        }
        resize(); viewport?.addEventListener("resize", resize); window.addEventListener("seanime:window-insets", resize)
        return () => { viewport?.removeEventListener("resize", resize); window.removeEventListener("seanime:window-insets", resize) }
    }, [open])
    React.useEffect(() => {
        if (!open) return
        const back = (event: Event) => {
            const dialogs = document.querySelectorAll('[role="dialog"][data-state="open"]')
            if (dialogs[dialogs.length - 1] !== content.current) return
            const transient = document.querySelector('[role="listbox"][data-state="open"], [role="menu"][data-state="open"]')
            event.preventDefault()
            if (transient) { transient.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return }
            if (onBack) onBack(); else onOpenChange(false)
        }
        window.addEventListener("seanime:android-back", back)
        return () => window.removeEventListener("seanime:android-back", back)
    }, [open, onBack, onOpenChange])
    return <Dialog.Root open={open} onOpenChange={onOpenChange}>
        {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
        <Dialog.Portal>
            <Dialog.Overlay className="mobile-workspace-overlay UI-Modal__overlay" />
            <Dialog.Content ref={content} className={cn("mobile-workspace UI-Modal__content", className)} aria-describedby={undefined}
                onOpenAutoFocus={e => { e.preventDefault(); content.current?.querySelector<HTMLButtonElement>(".mobile-workspace-close")?.focus({ preventScroll: true }) }}
                onCloseAutoFocus={e => { e.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }) }}
                onEscapeKeyDown={e => { if (onBack) { e.preventDefault(); onBack() } }}
                onInteractOutside={e => e.preventDefault()}>
                <div className="mobile-workspace-header">
                    {onBack && <button type="button" className="mobile-workspace-back" aria-label={tr("Back", "Zurück")} onClick={onBack}><LuArrowLeft aria-hidden="true" /></button>}
                    <div className="mobile-workspace-identity"><Dialog.Title>{title}</Dialog.Title>{subtitle && <p>{subtitle}</p>}</div>
                    <button type="button" className="mobile-workspace-close" aria-label={tr("Close", "Schließen")} onClick={() => onOpenChange(false)}><LuX aria-hidden="true" /></button>
                </div>
                <div className="mobile-workspace-body">{children}</div>
                {footer && <div className="mobile-workspace-footer">{footer}</div>}
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>
}
