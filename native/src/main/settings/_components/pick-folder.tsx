import { Button } from "@/components/ui/button/button"
import { toast } from "@/components/ui/toast/toast-store"
import type { Translate } from "@/lib/app-language"
import { folderPickProblemText } from "@/lib/folder-path"
import { pickServerFolder } from "@/lib/folder-picker"
import { colors } from "@/lib/theme/tokens"
import { serverAuthTokenAtom } from "@/main/_atoms/server-status.atoms"
import { useAtomValue } from "jotai"
import FolderOpen from "lucide-react-native/icons/folder-open"
import React from "react"
import { Platform } from "react-native"

/** Opens the system folder picker (lib/folder-picker); the path goes to the caller, a problem to a toast (web usePickFolder). */
export function usePickFolder(t: Translate) {
    const password = useAtomValue(serverAuthTokenAtom)
    const [picking, setPicking] = React.useState(false)
    const pick = React.useCallback(async (): Promise<string | null> => {
        setPicking(true)
        try {
            const result = await pickServerFolder(password)
            if ("path" in result) return result.path
            const problem = folderPickProblemText(result.problem, t)
            if (problem) toast.error(problem)
            return null
        }
        finally {
            setPicking(false)
        }
    }, [password, t])
    return { pick, picking, available: Platform.OS === "android" }
}

/** "Choose folder" inside a path sheet: fills the field with the picked folder; typing stays possible. */
export function PickFolderButton({ t, onPicked }: { t: Translate, onPicked: (path: string) => void }) {
    const { pick, picking, available } = usePickFolder(t)
    if (!available) return null
    return <Button intent="secondary" disabled={picking} leftIcon={<FolderOpen size={18} color={colors.smText} />}
        onPress={async () => {
            const path = await pick()
            if (path) onPicked(path)
        }}>
        {picking ? t("Choosing…", "Wird gewählt …") : t("Choose folder", "Ordner wählen")}
    </Button>
}
