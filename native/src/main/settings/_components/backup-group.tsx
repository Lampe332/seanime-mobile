// geschrieben nach: Auftrag „Sichern + Wiederherstellen“ (15.11.2026), settings-kit.tsx (Zeilen, Sheet) und lib/app-backup.ts; kein Server-Quelltext

import { Button } from "@/components/ui/button/button"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type BackupFile, type BackupSummary, type RestoreMode, backupFileName } from "@/core"
import { hasSafetyBackup, lastSafetyBackup, pickBackup, restoreBackupFile, saveBackupToDevice, shareBackup } from "@/lib/app-backup"
import type { Translate } from "@/lib/app-language"
import { LinkRow, SettingsGroup } from "@/main/settings/_components/settings-kit"
import { reloadAppAsync } from "expo"
import { markAppReload } from "@/lib/reload-mark"
import React from "react"
import { View } from "react-native"

/*
 * Back up / Restore (Settings → App): all of the app's data as one file for a new phone or a new install. Restore shows
 * what the file holds and asks how: replace the current data, or only add what is missing. The state before is kept, so
 * "Undo last restore" brings it back. The app starts anew afterwards.
 */

/** "6 extensions · 12 playlists · …": only the parts the file has */
function summaryLines(t: Translate, summary: BackupSummary): string[] {
    const parts: [number, string, string][] = [
        [summary.extensions, "extensions", "Erweiterungen"],
        [summary.playlists, "playlists", "Playlists"],
        [summary.watchPositions, "watch positions", "Wiedergabe-Stände"],
        [summary.settings, "settings groups", "Einstellungs-Bereiche"],
        [summary.homeItems, "home screen rows", "Startseiten-Reihen"],
        [summary.localListEntries, "local list entries", "Einträge lokaler Listen"],
        [summary.waitingChanges, "changes waiting for AniList", "wartende AniList-Änderungen"],
        [summary.mangaPreferences, "manga choices", "Manga-Vorlieben"],
        [summary.preferences, "app preferences", "App-Vorlieben"],
    ]
    return parts.filter(([count]) => count > 0).map(([count, en, de]) => `${count} ${t(en, de)}`)
}

function madeOn(t: Translate, summary: BackupSummary): string {
    const date = summary.createdAt ? new Date(summary.createdAt) : null
    const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleString(t("en-US", "de-DE")) : "?"
    return t(`Made ${when} with version ${summary.appVersion || "?"}.`, `Erstellt ${when} mit Version ${summary.appVersion || "?"}.`)
}

export function BackupGroup({ t }: { t: Translate }) {
    const [busy, setBusy] = React.useState<"backup" | "restore" | null>(null)
    const [picked, setPicked] = React.useState<{ file: BackupFile, summary: BackupSummary, undo: boolean } | null>(null)
    const [canUndo, setCanUndo] = React.useState(() => {
        try {
            return hasSafetyBackup()
        }
        catch {
            return false
        }
    })

    async function backUp(share: boolean) {
        setBusy("backup")
        try {
            const name = backupFileName(new Date())
            if (share) await shareBackup(name)
            else {
                const saved = await saveBackupToDevice(name)
                if (saved) toast.success(t(`Saved as ${saved.file} in ${saved.folder}.`, `Gespeichert als ${saved.file} in ${saved.folder}.`))
            }
        }
        catch {
            toast.error(t("The backup could not be made.", "Die Sicherung konnte nicht erstellt werden."))
        }
        finally {
            setBusy(null)
        }
    }

    async function choose(undo: boolean) {
        try {
            const found = undo ? await lastSafetyBackup() : await pickBackup()
            if (found) setPicked({ ...found, undo })
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : ""
            toast.error(t(`This file cannot be restored: ${reason}`, `Diese Datei kann nicht wiederhergestellt werden: ${reason}`))
        }
    }

    async function restore(mode: RestoreMode) {
        if (!picked) return
        const { file } = picked
        setPicked(null)
        setBusy("restore")
        try {
            await restoreBackupFile(file, mode)
            toast.success(t("Restored. The app starts again.", "Wiederhergestellt. Die App startet neu."))
            setTimeout(() => {
                markAppReload()
                void reloadAppAsync("backup restored")
            }, 800)
        }
        catch {
            setBusy(null)
            setCanUndo(true)
            toast.error(t("The backup could not be restored. The state before is kept under Undo last restore.",
                "Die Sicherung konnte nicht wiederhergestellt werden. Der vorige Stand liegt unter „Letzte Wiederherstellung rückgängig“."))
        }
    }

    const lines = picked ? summaryLines(t, picked.summary) : []

    return <SettingsGroup title={t("Backup", "Sicherung")}
        note={t("Settings, extensions, marketplaces, playlists, watch history, home screen, local lists and waiting AniList changes in one file. Sign-ins, passwords and keys are never included, nor downloaded videos.",
            "Einstellungen, Erweiterungen, Marktplätze, Playlists, Verlauf, Startseite, lokale Listen und wartende AniList-Änderungen in einer Datei. Anmeldungen, Passwörter und Schlüssel sind nie dabei, heruntergeladene Videos auch nicht.")}>
        <LinkRow label={busy === "backup" ? t("Backing up…", "Wird gesichert …") : t("Back up", "Sichern")} disabled={busy !== null}
            note={t("Saves one file on this device, in a folder you choose (e.g. one in Downloads).", "Speichert eine Datei auf diesem Gerät, in einem Ordner deiner Wahl (z. B. einem in Downloads).")}
            onPress={() => void backUp(false)} />
        <LinkRow label={t("Share…", "Teilen …")} disabled={busy !== null}
            note={t("Sends the backup file to another app, e.g. Drive or mail.", "Schickt die Sicherungsdatei an eine andere App, z. B. Drive oder Mail.")}
            onPress={() => void backUp(true)} />
        <LinkRow label={busy === "restore" ? t("Restoring…", "Wird wiederhergestellt …") : t("Restore", "Wiederherstellen")} disabled={busy !== null}
            note={t("From a backup file. The current state is kept first.", "Aus einer Sicherungsdatei. Der aktuelle Stand wird vorher gesichert.")}
            onPress={() => void choose(false)} />
        {canUndo && <LinkRow label={t("Undo last restore", "Letzte Wiederherstellung rückgängig")} disabled={busy !== null}
            note={t("Brings back the state from before the last restore.", "Holt den Stand von vor der letzten Wiederherstellung zurück.")}
            onPress={() => void choose(true)} />}

        <Sheet title={picked?.undo ? t("Undo last restore?", "Letzte Wiederherstellung rückgängig machen?") : t("Restore backup?", "Sicherung wiederherstellen?")}
            open={picked !== null} onOpenChange={open => !open && setPicked(null)}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => void restore("merge")}>{t("Merge", "Zusammenführen")}</Button>
                <Button intent="primary" wrapperClassName="flex-1" onPress={() => void restore("replace")}>{t("Replace", "Ersetzen")}</Button>
            </>}>
            <View className="gap-3">
                <View className="gap-1">
                    <Text className="text-[15px] font-semibold">{t("Contains", "Enthält")}</Text>
                    {lines.length > 0
                        ? lines.map(line => <Text key={line} className="text-[15px] leading-[22px] text-sm-text-muted">{`• ${line}`}</Text>)
                        : <Text className="text-[15px] text-sm-text-muted">{t("Nothing", "Nichts")}</Text>}
                </View>
                {picked && <Muted className="text-[13px] leading-[19px]">{madeOn(t, picked.summary)}</Muted>}
                <Text className="text-[15px] leading-[23px] text-sm-text-muted">
                    {t("Replace: the backup's data takes the place of the current data. Merge: everything here stays, only what is missing is added. Your sign-ins and passwords stay as they are. The app starts again afterwards.",
                        "Ersetzen: die Daten der Sicherung treten an die Stelle der aktuellen. Zusammenführen: alles hier bleibt, nur Fehlendes kommt dazu. Anmeldungen und Passwörter bleiben, wie sie sind. Die App startet danach neu.")}
                </Text>
            </View>
        </Sheet>
    </SettingsGroup>
}
