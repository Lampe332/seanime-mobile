import { Translate } from "@/lib/app-language"

/** Why no folder came back, or null when the user just cancelled. */
export function folderPickProblem(t: Translate, error: unknown): string | null {
    switch (error instanceof Error ? error.message : "") {
        case "cancelled":
            return null
        case "not-primary":
            return t("Only folders on the internal storage can be used.", "Nur Ordner im internen Speicher sind möglich.")
        case "permission":
            return t("Allow \"All files access\" for Seanime, then choose the folder again.", "Erlaube Seanime den Zugriff auf alle Dateien und wähle den Ordner dann erneut.")
        default:
            return t("The folder picker is not available.", "Die Ordnerauswahl ist nicht verfügbar.")
    }
}
