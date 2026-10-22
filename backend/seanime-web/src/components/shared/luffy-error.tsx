import { isAndroidPhone } from "@/app/(main)/_features/video-core/video-core-menu"
import { SeaImage } from "@/components/shared/sea-image"
import { Button } from "@/components/ui/button/button"
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

    const { children, reset, className, title = "Oops!", showRefreshButton = false, imageContainerClass, ...rest } = props

    // Phones: the phone kit's empty block (what is missing, why, a way on), as the redesigned screens show it
    if (isAndroidPhone()) return <LuffyErrorPhone {...props} />


    return (
        <>
            <div data-luffy-error className={cn("w-full flex flex-col items-center mt-10 space-y-4", className)}>
                {<div
                    data-luffy-error-image-container
                    className={cn("size-[8rem] mx-auto flex-none rounded-[--radius-md] object-cover object-center relative overflow-hidden",
                        imageContainerClass)}
                >
                    <SeaImage
                        data-luffy-error-image
                        src="/luffy-01.png"
                        alt={""}
                        fill
                        priority
                        sizes="10rem"
                        className="object-contain object-top"
                    />
                </div>}
                <div data-luffy-error-content className="text-center space-y-4">
                    {!!title && <h3 data-luffy-error-title>{title}</h3>}
                    <div data-luffy-error-content-children>{children}</div>
                    <div data-luffy-error-content-buttons>
                        {(showRefreshButton && !reset) && (
                            <Button
                                data-luffy-error-content-button-refresh
                                intent="warning-subtle"
                                onClick={() => window.location.reload()}
                            >Retry</Button>
                        )}
                        {!!reset && (
                            <Button data-luffy-error-content-button-reset intent="warning-subtle" onClick={reset}>Retry</Button>
                        )}
                    </div>
                </div>
            </div>
        </>
    )

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
