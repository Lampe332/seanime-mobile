import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { Translate } from "@/lib/app-language"
import React from "react"

/** Asks before a torrent starts loading over mobile data (the app reports a metered network); on Wi-Fi it starts right away. */
export function useMeteredGuard(t: Translate) {
    const pending = React.useRef<(() => void) | null>(null)
    const dialog = useConfirmationDialog({
        title: t("Use mobile data?", "Mobile Daten nutzen?"),
        description: t("You are not on Wi-Fi. A torrent can use several gigabytes of mobile data.",
            "Du bist nicht im WLAN. Ein Torrent kann mehrere Gigabyte mobile Daten verbrauchen."),
        actionText: t("Continue", "Fortfahren"),
        actionIntent: "warning",
        onConfirm: () => {
            pending.current?.()
            pending.current = null
        },
    })

    function guard(action: () => void) {
        let metered = false
        try { metered = !!window.SeanimeAndroid?.isMeteredNetwork?.() } catch { /* Older app builds have no bridge method. */ }
        if (!metered) return action()
        pending.current = action
        dialog.open()
    }

    return { guard, dialog: <ConfirmationDialog {...dialog} /> }
}
