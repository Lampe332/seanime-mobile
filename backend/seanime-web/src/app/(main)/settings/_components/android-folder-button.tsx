import { Button } from "@/components/ui/button"
import { canPickAndroidFolder, pickAndroidFolder } from "@/lib/android-folder-picker"
import { tr, Translate } from "@/lib/app-language"
import React from "react"
import { LuFolderOpen } from "react-icons/lu"
import { toast } from "sonner"

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

/** Android: picks a folder with the system picker (the server's directory browser cannot reach shared storage). */
export function AndroidFolderButton({ onPick, label = "Choose folder" }: { onPick: (path: string) => void, label?: string }) {
    const [picking, setPicking] = React.useState(false)
    if (!canPickAndroidFolder()) return null
    return <Button type="button" size="sm" intent="gray-outline" leftIcon={<LuFolderOpen />} loading={picking} data-android-folder-button
        onClick={async () => {
            setPicking(true)
            try {
                onPick(await pickAndroidFolder())
            }
            catch (error) {
                const problem = folderPickProblem(tr, error)
                if (problem) toast.error(problem)
            }
            finally {
                setPicking(false)
            }
        }}>
        {label}
    </Button>
}
