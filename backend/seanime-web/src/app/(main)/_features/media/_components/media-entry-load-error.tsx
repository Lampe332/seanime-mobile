import { SeaError } from "@/api/client/requests"
import { Button } from "@/components/ui/button"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import React from "react"

/** Shown instead of silently leaving an anime/manga page when it could not load (offline, server busy). */
export function MediaEntryLoadError({ error, onRetry, retrying }: { error: SeaError | null, onRetry: () => void, retrying: boolean }) {
    const t = useTr()
    const router = useRouter()
    const offline = !error?.response

    return (
        <div data-media-entry-load-error role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center">
            <h2 className="text-xl font-semibold">
                {offline ? t("No connection to the server", "Keine Verbindung zum Server") : t("This page could not load", "Diese Seite konnte nicht geladen werden")}
            </h2>
            <p className="max-w-sm text-sm text-[--muted]">
                {offline
                    ? t("Check your Wi-Fi or mobile data and try again.", "Prüfe WLAN oder mobile Daten und versuche es erneut.")
                    : (error?.response?.data?.error || t("The server returned an error.", "Der Server hat einen Fehler gemeldet."))}
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
                <Button className="min-h-11" loading={retrying} onClick={onRetry}>{t("Try again", "Erneut versuchen")}</Button>
                <Button className="min-h-11" intent="gray-subtle" onClick={() => window.history.length > 1 ? window.history.back() : router.push("/")}>
                    {t("Back", "Zurück")}
                </Button>
            </div>
        </div>
    )
}
