import { isAndroidPhone } from "@/app/(main)/_features/video-core/video-core-menu"
import { LuffyError } from "@/components/shared/luffy-error"
import { Button } from "@/components/ui/button"
import { useTr } from "@/lib/app-language"
import { Link } from "@tanstack/react-router"
import React from "react"

export function NotFound() {
    const t = useTr()
    if (isAndroidPhone()) return (
        <div className="ps-empty luffy-phone" data-not-found>
            <p>{t("This page doesn't exist", "Diese Seite gibt es nicht")}</p>
            <p>{t("The link may be old, or the page is only in Seanime on a computer.", "Der Link ist vielleicht alt, oder die Seite gibt es nur in Seanime am Computer.")}</p>
            <div className="ps-empty-actions"><Link to="/" className="ps-primary">{t("Go to Home", "Zur Startseite")}</Link></div>
        </div>
    )
    return (
        <div className="p-4 flex flex-col items-center justify-center h-full">
            <LuffyError title="Page Not Found">
                <p className="text-[--muted] mb-4">
                    The page you are looking for does not exist.
                </p>
                <Link to="/">
                    <Button>Go Home</Button>
                </Link>
            </LuffyError>
        </div>
    )
}
