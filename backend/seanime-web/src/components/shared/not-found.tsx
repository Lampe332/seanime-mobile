import { useTr } from "@/lib/app-language"
import { Link } from "@tanstack/react-router"
import React from "react"

export function NotFound() {
    const t = useTr()
    return (
        <div className="ps-empty luffy-phone" data-not-found>
            <p>{t("This page doesn't exist", "Diese Seite gibt es nicht")}</p>
            <p>{t("The link may be old, or the page is only in Seanime on a computer.", "Der Link ist vielleicht alt, oder die Seite gibt es nur in Seanime am Computer.")}</p>
            <div className="ps-empty-actions"><Link to="/" className="ps-primary">{t("Go to Home", "Zur Startseite")}</Link></div>
        </div>
    )
}
