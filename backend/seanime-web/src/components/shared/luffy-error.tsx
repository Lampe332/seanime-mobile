import { cn } from "@/components/ui/core/styling"
import { useTr } from "@/lib/app-language"
import React from "react"
import "@/components/shared/mobile-surface.css"
import "@/app/(main)/_features/phone-screen/phone-screen.css"

interface LuffyErrorProps {
    children?: React.ReactNode
    className?: string
    reset?: () => void
    title?: string | null
    showRefreshButton?: boolean
    imageContainerClass?: string
}

export const LuffyError: React.FC<LuffyErrorProps> = (props) => {
    // Phones: the phone kit's empty block (what is missing, why, a way on), as the redesigned screens show it
    return <LuffyErrorPhone {...props} />
}

function LuffyErrorPhone({ children, reset, className, title = "Oops!", showRefreshButton = false }: LuffyErrorProps) {
    const t = useTr()
    const retry = reset ?? (showRefreshButton ? () => window.location.reload() : undefined)
    return <div data-luffy-error className={cn("ps-empty luffy-phone", className)}>
        {!!title && <p data-luffy-error-title>{title}</p>}
        {!!children && <div className="luffy-phone-text" data-luffy-error-content-children>{children}</div>}
        {!!retry && <div className="ps-empty-actions">
            <button type="button" className="ps-secondary" onClick={retry} data-luffy-error-content-button-reset>{t("Try again", "Nochmal versuchen")}</button>
        </div>}
    </div>
}
