// geschrieben nach: Plan „Account + Sync“ (Abschnitte 2, 6.4 Freigabe-Popup, 6.6 Import-Frage, 8 FLAG_SECURE) und settings/_components/backup-group.tsx (Sheet-Muster)

import { Button } from "@/components/ui/button/button"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import type { ApprovalRequest } from "@/core/account/client"
import type { ApproverTurn } from "@/core/account/devices"
import {
    accountAtom, answerApproval, approvalRequestsAtom, approveApproval, compareApproval, confirmWithDeviceLock, denyApproval, importDismissedAtom,
    importFromAccount, lastSyncAtom,
} from "@/lib/account/account-app"
import { accountErrorText, accountPhase, formatSas } from "@/lib/account/account-view"
import { useTr } from "@/lib/app-language"
import { reloadAppAsync } from "expo"
import { usePreventScreenCapture } from "expo-screen-capture"
import { useAtom, useAtomValue } from "jotai"
import React from "react"
import { View } from "react-native"

/*
 * The account's two questions that come up anywhere in the app: "Import your settings from your account?" on a device
 * that just signed in to an account with data, and "<device> wants to sign in" on a device that can approve a new one.
 */

export function AccountPrompts() {
    return <>
        <ImportQuestion />
        <ApprovalPopup />
    </>
}

/** No screenshots and no preview in Recents while mounted (Android FLAG_SECURE) */
export function NoScreenshots({ id }: { id: string }) {
    usePreventScreenCapture(id)
    return null
}

function ImportQuestion() {
    const t = useTr()
    const account = useAtomValue(accountAtom)
    const lastSync = useAtomValue(lastSyncAtom)
    const [dismissed, setDismissed] = useAtom(importDismissedAtom)
    const [busy, setBusy] = React.useState(false)
    const open = accountPhase({ loaded: account.loaded, signedIn: account.signedIn, hasKey: account.hasKey, lastResult: lastSync }) === "import" && !dismissed

    async function importNow() {
        setBusy(true)
        try {
            await importFromAccount()
            toast.success(t("Imported. The app starts again.", "Importiert. Die App startet neu."))
            setTimeout(() => void reloadAppAsync("account import"), 800)
        }
        catch (error) {
            setBusy(false)
            toast.error(accountErrorText(t, error))
        }
    }

    return <Sheet title={t("Import your settings from your account?", "Einstellungen aus deinem Konto importieren?")} open={open || busy}
        onOpenChange={next => !next && !busy && setDismissed(true)}
        footer={<>
            <Button intent="secondary" wrapperClassName="flex-1" disabled={busy} onPress={() => setDismissed(true)}>{t("Not now", "Nicht jetzt")}</Button>
            <Button intent="primary" wrapperClassName="flex-1" loading={busy} onPress={() => void importNow()}>{t("Import", "Importieren")}</Button>
        </>}>
        <Text className="text-[15px] leading-[23px] text-sm-text-muted">
            {t("Your settings, extensions, playlists, watch history and sign-ins from your account replace the ones on this device. A backup of this device is saved first, and Settings › App › Backup › Undo last restore brings it back.",
                "Einstellungen, Erweiterungen, Playlists, Verlauf und Anmeldungen aus deinem Konto ersetzen die auf diesem Gerät. Vorher wird dieses Gerät gesichert, und Einstellungen › App › Sicherung › Letzte Wiederherstellung rückgängig holt es zurück.")}
        </Text>
    </Sheet>
}

const POLL_MS = 2000

function ApprovalPopup() {
    const requests = useAtomValue(approvalRequestsAtom)
    const [skipped, setSkipped] = React.useState<string[]>([])
    const request = requests.find(item => !skipped.includes(item.id)) ?? null
    if (!request) return null
    return <ApprovalSheet key={request.id} request={request} onClose={() => setSkipped(ids => [...ids, request.id])} />
}

function ApprovalSheet({ request, onClose }: { request: ApprovalRequest, onClose: () => void }) {
    const t = useTr()
    const [turn, setTurn] = React.useState<ApproverTurn | null>(null)
    const [sas, setSas] = React.useState<string | null>(null)
    const [busy, setBusy] = React.useState(false)
    const [ended, setEnded] = React.useState<string | null>(null)

    // step 2: this device sends its random number, then waits until the new device revealed its own
    React.useEffect(() => {
        let alive = true
        let timer: ReturnType<typeof setTimeout> | null = null
        const poll = async (current: ApproverTurn) => {
            try {
                const progress = await compareApproval(current)
                if (!alive) return
                if (progress.state === "compare") return setSas(progress.sas)
                if (progress.state !== "waiting") return setEnded(progress.state)
            }
            catch (error) {
                if (alive) setEnded(accountErrorText(t, error))
                return
            }
            timer = setTimeout(() => void poll(current), POLL_MS)
        }
        void answerApproval(request).then(answered => {
            if (!alive) return
            setTurn(answered)
            void poll(answered)
        }, error => alive && setEnded(accountErrorText(t, error)))
        return () => {
            alive = false
            if (timer) clearTimeout(timer)
        }
    }, [request, t])

    async function approve() {
        if (!turn) return
        setBusy(true)
        try {
            if (!(await confirmWithDeviceLock(t(`Approve ${request.deviceName}`, `${request.deviceName} freigeben`)))) return
            await approveApproval(turn)
            toast.success(t(`${request.deviceName} can now use your account.`, `${request.deviceName} kann jetzt dein Konto nutzen.`))
            onClose()
        }
        catch (error) {
            toast.error(accountErrorText(t, error))
        }
        finally {
            setBusy(false)
        }
    }

    async function deny() {
        setBusy(true)
        try {
            await denyApproval(request.id)
            toast.success(t(`${request.deviceName} was denied.`, `${request.deviceName} wurde abgelehnt.`))
            onClose()
        }
        catch (error) {
            // M-1: a deny that did not reach the server must not look like one; the sheet stays open to try again
            toast.error(accountErrorText(t, error))
        }
        finally {
            setBusy(false)
        }
    }

    return <Sheet title={t(`${request.deviceName} wants to sign in`, `${request.deviceName} möchte sich anmelden`)} open onOpenChange={open => !open && onClose()}
        footer={ended ? <Button intent="secondary" wrapperClassName="flex-1" onPress={onClose}>{t("Close", "Schließen")}</Button> : <>
            <Button intent="secondary" wrapperClassName="flex-1" disabled={busy} onPress={() => void deny()}>{t("Deny", "Ablehnen")}</Button>
            <Button intent="primary" wrapperClassName="flex-1" disabled={!sas} loading={busy} onPress={() => void approve()}>{t("Approve", "Freigeben")}</Button>
        </>}>
        <NoScreenshots id="account-approve" />
        <View className="gap-3">
            {ended
                ? <Text className="text-[15px] leading-[23px] text-sm-text-muted">{endedText(t, ended)}</Text>
                : sas
                    ? <>
                        <Text accessibilityLabel={sas.split("").join(" ")} className="text-center text-[34px] font-bold tracking-[3px]">{formatSas(sas)}</Text>
                        <Text className="text-[15px] leading-[23px] text-sm-text-muted">
                            {t(`Does ${request.deviceName} show the same number? Approve only then, and confirm it there too. It gets your synced data and keys.`,
                                `Zeigt ${request.deviceName} dieselbe Zahl? Gib nur dann frei und bestätige sie dort auch. Das Gerät bekommt deine synchronisierten Daten und Schlüssel.`)}
                        </Text>
                    </>
                    : <Muted className="text-[15px] leading-[23px]">{t("Getting the number…", "Zahl wird geholt …")}</Muted>}
        </View>
    </Sheet>
}

function endedText(t: ReturnType<typeof useTr>, ended: string): string {
    if (ended === "approved") return t("This request was approved already.", "Diese Anfrage wurde schon freigegeben.")
    if (ended === "denied") return t("This request was denied.", "Diese Anfrage wurde abgelehnt.")
    if (ended === "expired") return t("This request expired. The other device can ask again.", "Diese Anfrage ist abgelaufen. Das andere Gerät kann neu fragen.")
    return ended
}
