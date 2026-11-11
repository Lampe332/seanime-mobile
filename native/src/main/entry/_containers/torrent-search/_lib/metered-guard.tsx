import { Button } from "@/components/ui/button/button"
import { Dialog } from "@/components/ui/sheet/sheet"
import type { Translate } from "@/lib/app-language"
import NetInfo from "@react-native-community/netinfo"
import React from "react"

/**
 * Asks before a torrent starts loading over mobile data; on Wi-Fi it starts right away (metered-guard.tsx). "Metered" is
 * Android's isActiveNetworkMetered, as in the old app's bridge (EpisodeDownloads.metered), here through NetInfo's
 * `isConnectionExpensive`.
 */
export function useMeteredGuard(t: Translate) {
    const pending = React.useRef<(() => void) | null>(null)
    const [open, setOpen] = React.useState(false)

    async function guard(action: () => void) {
        let metered = false
        try {
            const state = await NetInfo.fetch()
            metered = !!state.details && "isConnectionExpensive" in state.details && !!state.details.isConnectionExpensive
        }
        catch { /* No network state: start as on Wi-Fi, like the old app without its bridge method */ }
        if (!metered) return action()
        pending.current = action
        setOpen(true)
    }

    const close = () => {
        pending.current = null
        setOpen(false)
    }

    const dialog = <Dialog open={open} onOpenChange={value => !value && close()} title={t("Use mobile data?", "Mobile Daten nutzen?")}
        description={t("You are not on Wi-Fi. A torrent can use several gigabytes of mobile data.",
            "Du bist nicht im WLAN. Ein Torrent kann mehrere Gigabyte mobile Daten verbrauchen.")}
        footer={<>
            <Button intent="secondary" onPress={close}>{t("Cancel", "Abbrechen")}</Button>
            <Button onPress={() => {
                const action = pending.current
                close()
                action?.()
            }}>{t("Continue", "Fortfahren")}</Button>
        </>} />

    return { guard, dialog }
}
