import { type Translate } from "@/lib/app-language"
import {
    ConfirmSheet,
    LinkRow,
    SettingsGroup,
    SettingSwitch,
    TextSettingRow,
    useSaveSetting,
    useSettingValue,
} from "@/main/settings/_components/settings-kit"
import { PickFolderButton, usePickFolder } from "@/main/settings/_components/pick-folder"
import React from "react"

/*
 * Local library (settings-phone-library.tsx): folders, scanning, matching. The old JSON export left with the server;
 * Settings → App → Backup saves all app data instead. Folders
 * come from the system folder picker ("Choose folder", "Add another folder"; lib/folder-picker checks "All files access"
 * through the server and turns the tree URI into a path) or are typed as this device shows them. No import: it reads a
 * path on the server.
 */
export function SettingsLibrarySection({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const libraryPath = useSettingValue("library.libraryPath", "")
    const libraryPaths = useSettingValue<string[] | null>("library.libraryPaths", []) ?? []
    const { pick, picking, available } = usePickFolder(t)
    // the folder stays set while the sheet closes, so its text does not turn into "null" on the way out
    const [removing, setRemoving] = React.useState("")
    const [confirmRemove, setConfirmRemove] = React.useState(false)

    return <>
        <SettingsGroup title={t("Folders", "Ordner")}
            note={t("Where your anime files are. The app needs \"All files access\" to read them.", "Wo deine Anime-Dateien liegen. Die App braucht dafür Zugriff auf alle Dateien.")}>
            <TextSettingRow label={t("Library folder", "Bibliotheksordner")} value={libraryPath} empty={t("Not set", "Nicht gesetzt")} placeholder="/storage/emulated/0/Anime"
                note={t("Pick it, or type the path as this device shows it.", "Wähle ihn aus oder tippe den Pfad, wie dieses Gerät ihn zeigt.")}
                extra={setDraft => <PickFolderButton t={t} onPicked={setDraft} />}
                onApply={value => void save("library.libraryPath", value.trim())} />
            {libraryPaths.map(path => <LinkRow key={path} label={t("Additional folder", "Weiterer Ordner")} value={path} onPress={() => {
                setRemoving(path)
                setConfirmRemove(true)
            }}
                note={t("Tap to remove it from the library.", "Antippen, um ihn aus der Bibliothek zu entfernen.")} />)}
            {available && <LinkRow label={picking ? t("Choosing…", "Wird gewählt …") : t("Add another folder", "Weiteren Ordner hinzufügen")} disabled={picking}
                note={t("Files in more than one folder all count as your library.", "Dateien in mehreren Ordnern zählen alle zu deiner Bibliothek.")}
                onPress={async () => {
                    const path = await pick()
                    if (path && path !== libraryPath && !libraryPaths.includes(path)) void save("library.libraryPaths", [...libraryPaths, path])
                }} />}
        </SettingsGroup>
        <ConfirmSheet open={confirmRemove} onOpenChange={setConfirmRemove} title={t("Remove folder?", "Ordner entfernen?")}
            text={t(`${removing} will no longer be part of your library. The files stay on this device.`,
                `${removing} gehört dann nicht mehr zu deiner Bibliothek. Die Dateien bleiben auf dem Gerät.`)}
            action={t("Remove", "Entfernen")} danger onConfirm={() => void save("library.libraryPaths", libraryPaths.filter(path => path !== removing))} />

        <SettingsGroup title={t("Scanning", "Scannen")}>
            <SettingSwitch path="library.autoScan" label={t("Refresh the library automatically", "Bibliothek automatisch aktualisieren")} defaultChecked={false}
                note={t("Scans when files change. Large batches may not all be picked up.", "Scannt, wenn sich Dateien ändern. Große Mengen werden evtl. nicht alle erkannt.")} />
            <SettingSwitch path="library.refreshLibraryOnStart" label={t("Refresh the library when the app starts", "Bibliothek beim App-Start aktualisieren")}
                defaultChecked={false} note={t("Scans your folders each time the app opens.", "Scannt deine Ordner bei jedem App-Start.")} />
        </SettingsGroup>

        <SettingsGroup title={t("Matching", "Zuordnung")} note={t("How the scanner matches files to AniList entries.", "Wie der Scanner Dateien AniList-Einträgen zuordnet.")}>
            {/* no "Legacy matching": the core's scanner has one way of matching (core/library/scan.ts) */}
            <ScannerConfigRow t={t} />
        </SettingsGroup>
    </>
}

/** Scanner rules as JSON; empty means none. */
function ScannerConfigRow({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const config = useSettingValue("library.scannerConfig", "")
    return <TextSettingRow label={t("Scanner rules", "Scanner-Regeln")} value={config} empty={t("None", "Keine")} multiline
        display={() => t("Set", "Gesetzt")} placeholder={"{\n  \"matching\": { \"rules\": [] }\n}"}
        note={t("Matching and hydration rules in JSON. Leave empty for none.", "Regeln für Zuordnung und Ergänzung als JSON. Leer lassen für keine.")}
        validate={value => {
            if (!value.trim()) return null
            try {
                JSON.parse(value)
                return null
            }
            catch {
                return t("This is not valid JSON.", "Das ist kein gültiges JSON.")
            }
        }}
        onApply={value => void save("library.scannerConfig", value.trim())} />
}
