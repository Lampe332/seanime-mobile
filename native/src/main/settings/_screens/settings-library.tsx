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
import { readScannerConfig } from "@/core/library/scanner-config"
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
            <TextSettingRow label={t("Library folder", "Bibliotheksordner")} value={libraryPath} empty={t("Not set", "Nicht gesetzt")} placeholder="/storage/emulated/0/Anime" path
                note={t("Pick it, or type the path as this device shows it.", "Wähle ihn aus oder tippe den Pfad, wie dieses Gerät ihn zeigt.")}
                extra={setDraft => <PickFolderButton t={t} onPicked={setDraft} />}
                onApply={value => void save("library.libraryPath", value.trim())} />
            {libraryPaths.map(path => <LinkRow key={path} label={t("Additional folder", "Weiterer Ordner")} value={path} path onPress={() => {
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
                note={t("Checks your folders when you come back to the app, at most every 10 minutes, and scans only when files changed.",
                    "Prüft deine Ordner, wenn du zur App zurückkehrst, höchstens alle 10 Minuten, und scannt nur, wenn sich Dateien geändert haben.")} />
            <SettingSwitch path="library.refreshLibraryOnStart" label={t("Refresh the library when the app starts", "Bibliothek beim App-Start aktualisieren")}
                defaultChecked={false} note={t("Scans your folders each time the app opens.", "Scannt deine Ordner bei jedem App-Start.")} />
        </SettingsGroup>

        <SettingsGroup title={t("Matching", "Zuordnung")} note={t("How the scanner matches files to AniList entries.", "Wie der Scanner Dateien AniList-Einträgen zuordnet.")}>
            {/* no "Legacy matching": the core's scanner has one way of matching (core/library/scan.ts) */}
            <ScannerConfigRow t={t} />
        </SettingsGroup>
    </>
}

/** An example of the rules, in the original's form (core/library/scanner-config.ts) */
const SCANNER_EXAMPLE = `{
  "matching": { "rules": [
    { "pattern": "(?i)/Frieren/", "mediaId": 154587 }
  ] },
  "hydration": { "rules": [
    { "pattern": "(?i)frieren", "mediaId": 154587, "files": [
      { "filename": "E([0-9]+)", "isRegex": true, "episode": "$1-12" }
    ] }
  ] }
}`

/** Scanner rules as JSON; empty means none. Checked with the core's own reader, which names the broken rule. */
function ScannerConfigRow({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const config = useSettingValue("library.scannerConfig", "")
    return <TextSettingRow label={t("Scanner rules", "Scanner-Regeln")} value={config} empty={t("None", "Keine")} multiline
        display={() => t("Set", "Gesetzt")} placeholder={SCANNER_EXAMPLE}
        note={t("Matching rules give a file an anime by a regex on its full path; hydration rules set the episode by a regex on its name ($1 is the first group, sums like \"$1-12\" work). Start a pattern with (?i) to ignore case. Leave empty for none.",
            "Zuordnungsregeln geben einer Datei per Regex auf ihren vollen Pfad einen Anime; Ergänzungsregeln setzen die Folge per Regex auf ihren Namen ($1 ist die erste Gruppe, Rechnungen wie \"$1-12\" gehen). Beginnt ein Muster mit (?i), zählt Groß/klein nicht. Leer lassen für keine.")}
        validate={value => {
            const problems = readScannerConfig(value).problems
            if (problems.length === 0) return null
            const more = problems.length > 3 ? t(` (and ${problems.length - 3} more)`, ` (und ${problems.length - 3} weitere)`) : ""
            return t("Fix the rules: ", "Regeln korrigieren: ") + problems.slice(0, 3).join("; ") + more
        }}
        onApply={value => void save("library.scannerConfig", value.trim())} />
}
