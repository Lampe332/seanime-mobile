import { toast } from "@/components/ui/toast/toast-store"
import { type Translate } from "@/lib/app-language"
import { fileTimestamp, useSaveServerFile } from "@/main/_hooks/use-save-server-file"
import {
    ConfirmSheet,
    LinkRow,
    SelectRow,
    SettingsGroup,
    SettingSwitch,
    TextSettingRow,
    useSaveSetting,
    useSettingValue,
} from "@/main/settings/_components/settings-kit"
import { PickFolderButton, usePickFolder } from "@/main/settings/_components/pick-folder"
import React from "react"

/*
 * Local library (settings-phone-library.tsx): folders, scanning, matching, export (E4 file module, share sheet). Folders
 * come from the system folder picker ("Choose folder", "Add another folder"; lib/folder-picker checks "All files access"
 * through the server and turns the tree URI into a path) or are typed as this device shows them. No import: it reads a
 * path on the server.
 */
export function SettingsLibrarySection({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const libraryPath = useSettingValue("library.libraryPath", "")
    const libraryPaths = useSettingValue<string[] | null>("library.libraryPaths", []) ?? []
    const legacy = useSettingValue("library.scannerUseLegacyMatching", false)
    const { pick, picking, available } = usePickFolder(t)
    const [removing, setRemoving] = React.useState<string | null>(null)

    return <>
        <SettingsGroup title={t("Folders", "Ordner")}
            note={t("Where your anime files are. The app needs \"All files access\" to read them.", "Wo deine Anime-Dateien liegen. Die App braucht dafür Zugriff auf alle Dateien.")}>
            <TextSettingRow label={t("Library folder", "Bibliotheksordner")} value={libraryPath} empty={t("Not set", "Nicht gesetzt")} placeholder="/storage/emulated/0/Anime"
                note={t("Pick it, or type the path as this device shows it.", "Wähle ihn aus oder tippe den Pfad, wie dieses Gerät ihn zeigt.")}
                extra={setDraft => <PickFolderButton t={t} onPicked={setDraft} />}
                onApply={value => void save("library.libraryPath", value.trim())} />
            {libraryPaths.map(path => <LinkRow key={path} label={t("Additional folder", "Weiterer Ordner")} value={path} onPress={() => setRemoving(path)}
                note={t("Tap to remove it from the library.", "Antippen, um ihn aus der Bibliothek zu entfernen.")} />)}
            {available && <LinkRow label={picking ? t("Choosing…", "Wird gewählt …") : t("Add another folder", "Weiteren Ordner hinzufügen")} disabled={picking}
                onPress={async () => {
                    const path = await pick()
                    if (path && path !== libraryPath && !libraryPaths.includes(path)) void save("library.libraryPaths", [...libraryPaths, path])
                }} />}
        </SettingsGroup>
        <ConfirmSheet open={removing !== null} onOpenChange={open => {
            if (!open) setRemoving(null)
        }} title={t("Remove folder?", "Ordner entfernen?")}
            text={t(`${removing} will no longer be part of your library. The files stay on this device.`,
                `${removing} gehört dann nicht mehr zu deiner Bibliothek. Die Dateien bleiben auf dem Gerät.`)}
            action={t("Remove", "Entfernen")} danger onConfirm={() => void save("library.libraryPaths", libraryPaths.filter(path => path !== removing))} />

        <SettingsGroup title={t("Scanning", "Scannen")}>
            <SettingSwitch path="library.autoScan" label={t("Refresh the library automatically", "Bibliothek automatisch aktualisieren")}
                note={t("Scans when files change. Large batches may not all be picked up.", "Scannt, wenn sich Dateien ändern. Große Mengen werden evtl. nicht alle erkannt.")} />
            <SettingSwitch path="library.refreshLibraryOnStart" label={t("Refresh the library when the app starts", "Bibliothek beim App-Start aktualisieren")} />
        </SettingsGroup>

        <SettingsGroup title={t("Matching", "Zuordnung")} note={t("How the scanner matches files to AniList entries.", "Wie der Scanner Dateien AniList-Einträgen zuordnet.")}>
            <SettingSwitch path="library.scannerUseLegacyMatching" label={t("Legacy matching", "Alte Zuordnung")}
                note={t("The simpler matching of Seanime 3.4 and older.", "Die einfachere Zuordnung von Seanime 3.4 und älter.")} />
            {legacy ? <LegacyMatching t={t} /> : <ScannerConfigRow t={t} />}
        </SettingsGroup>

        <SettingsGroup title={t("Library data", "Bibliotheksdaten")}>
            <ExportRow t={t} />
        </SettingsGroup>
    </>
}

/** Export: the library's file data as JSON through Android's share sheet (E4 file module). */
function ExportRow({ t }: { t: Translate }) {
    const saveServerFile = useSaveServerFile()
    const [exporting, setExporting] = React.useState(false)
    return <LinkRow label={exporting ? t("Exporting…", "Wird exportiert …") : t("Export library data", "Bibliotheksdaten exportieren")} disabled={exporting}
        note={t("Saves the scanned file data as a JSON file.", "Speichert die gescannten Dateidaten als JSON-Datei.")}
        onPress={async () => {
            setExporting(true)
            try {
                await saveServerFile("/api/v1/library/local-files/dump", `seanime-localfiles-${fileTimestamp()}.json`, { mime: "application/json" })
            }
            catch {
                toast.error(t("The library data could not be exported.", "Die Bibliotheksdaten konnten nicht exportiert werden."))
            }
            finally {
                setExporting(false)
            }
        }} />
}

function LegacyMatching({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const algorithm = useSettingValue("library.scannerMatchingAlgorithm", "")
    const threshold = useSettingValue("library.scannerMatchingThreshold", 0)
    const shownThreshold = threshold > 0 ? threshold : 0.5
    return <>
        <SelectRow label={t("Matching algorithm", "Zuordnungsverfahren")} value={algorithm || "-"}
            onChange={value => void save("library.scannerMatchingAlgorithm", value === "-" ? "" : value)}
            options={[
                { value: "-", label: t("Levenshtein + Sorensen-Dice (default)", "Levenshtein + Sorensen-Dice (Standard)") },
                { value: "sorensen-dice", label: "Sorensen-Dice" },
                { value: "jaccard", label: "Jaccard" },
            ]} />
        <SelectRow label={t("Matching threshold", "Zuordnungsschwelle")} value={shownThreshold.toFixed(1)}
            note={t("The lowest score a file needs to be matched. Default 0.5.", "Die niedrigste Punktzahl, mit der eine Datei zugeordnet wird. Standard 0,5.")}
            onChange={value => void save("library.scannerMatchingThreshold", Number(value))}
            options={Array.from({ length: 10 }, (_, i) => ((i + 1) / 10).toFixed(1)).map(value => ({ value, label: value }))} />
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
