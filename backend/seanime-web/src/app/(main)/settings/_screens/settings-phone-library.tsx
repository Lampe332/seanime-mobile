import { fileTimestamp, useSaveServerFile } from "@/app/(main)/_hooks/use-save-server-file"
import { folderPickProblem } from "@/app/(main)/settings/_components/android-folder-button"
import {
    ConfirmSheet,
    LinkRow,
    SelectRow,
    SettingsGroup,
    SettingSwitch,
    TextSettingRow,
    useSaveSetting,
    useSettingValue,
} from "@/app/(main)/settings/_screens/settings-phone-kit"
import { canPickAndroidFolder, pickAndroidFolder } from "@/lib/android-folder-picker"
import { Translate } from "@/lib/app-language"
import React from "react"
import { LuFolderOpen } from "react-icons/lu"
import { toast } from "sonner"

/** Opens the system folder picker; the path or the reason goes to the caller and a toast. */
function usePickFolder(t: Translate) {
    const [picking, setPicking] = React.useState(false)
    const pick = React.useCallback(async (): Promise<string | null> => {
        setPicking(true)
        try {
            return await pickAndroidFolder()
        }
        catch (error) {
            const problem = folderPickProblem(t, error)
            if (problem) toast.error(problem)
            return null
        }
        finally {
            setPicking(false)
        }
    }, [t])
    return { pick, picking, available: canPickAndroidFolder() }
}

/** "Choose folder" inside a path sheet: fills the field with the picked folder. */
export function PickFolderButton({ t, onPicked }: { t: Translate, onPicked: (path: string) => void }) {
    const { pick, picking, available } = usePickFolder(t)
    if (!available) return null
    return <button type="button" className="ps-secondary pst-wide" disabled={picking} data-settings-pick-folder
        onClick={async () => { const path = await pick(); if (path) onPicked(path) }}>
        <LuFolderOpen aria-hidden />{picking ? t("Choosing…", "Wird gewählt …") : t("Choose folder", "Ordner wählen")}
    </button>
}

/** Local library: folders, scanning, matching, export (no import: it reads a path on the server). */
export function SettingsLibrarySection({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const libraryPath = useSettingValue("library.libraryPath", "")
    const libraryPaths = useSettingValue<string[] | null>("library.libraryPaths", []) ?? []
    const legacy = useSettingValue("library.scannerUseLegacyMatching", false)
    const { pick, picking, available } = usePickFolder(t)
    const [removing, setRemoving] = React.useState<string | null>(null)
    const notSet = t("Not set", "Nicht gesetzt")

    return <>
        <SettingsGroup id="library-folders" title={t("Folders", "Ordner")}
            note={t("Where your anime files are. The app needs \"All files access\" to read them.", "Wo deine Anime-Dateien liegen. Die App braucht dafür Zugriff auf alle Dateien.")}>
            <TextSettingRow t={t} label={t("Library folder", "Bibliotheksordner")} value={libraryPath} empty={notSet} placeholder="/storage/emulated/0/Anime"
                note={t("Pick it, or type the path as the phone shows it.", "Wähle ihn aus oder tippe den Pfad, wie das Handy ihn zeigt.")}
                extra={setDraft => <PickFolderButton t={t} onPicked={setDraft} />}
                onApply={value => void save("library.libraryPath", value.trim())} data-setting="library.libraryPath" />
            {libraryPaths.map(path => <LinkRow key={path} label={t("Additional folder", "Weiterer Ordner")} value={path} onClick={() => setRemoving(path)}
                note={t("Tap to remove it from the library.", "Antippen, um ihn aus der Bibliothek zu entfernen.")} data-settings-extra-folder={path} />)}
            {available && <LinkRow label={picking ? t("Choosing…", "Wird gewählt …") : t("Add another folder", "Weiteren Ordner hinzufügen")} disabled={picking}
                data-settings-add-folder onClick={async () => {
                    const path = await pick()
                    if (path && path !== libraryPath && !libraryPaths.includes(path)) void save("library.libraryPaths", [...libraryPaths, path])
                }} />}
        </SettingsGroup>
        <ConfirmSheet t={t} open={removing !== null} onOpenChange={open => { if (!open) setRemoving(null) }} title={t("Remove folder?", "Ordner entfernen?")}
            text={t(`${removing} will no longer be part of your library. The files stay on this device.`,
                `${removing} gehört dann nicht mehr zu deiner Bibliothek. Die Dateien bleiben auf dem Gerät.`)}
            action={t("Remove", "Entfernen")} danger onConfirm={() => void save("library.libraryPaths", libraryPaths.filter(path => path !== removing))}
            data-settings-remove-folder />

        <SettingsGroup id="library-scanning" title={t("Scanning", "Scannen")}>
            <SettingSwitch path="library.autoScan" label={t("Refresh the library automatically", "Bibliothek automatisch aktualisieren")}
                note={t("Scans when files change. Large batches may not all be picked up.", "Scannt, wenn sich Dateien ändern. Große Mengen werden evtl. nicht alle erkannt.")} />
            <SettingSwitch path="library.refreshLibraryOnStart" label={t("Refresh the library when the app starts", "Bibliothek beim App-Start aktualisieren")} />
        </SettingsGroup>

        <SettingsGroup id="library-matching" title={t("Matching", "Zuordnung")}
            note={t("How the scanner matches files to AniList entries.", "Wie der Scanner Dateien AniList-Einträgen zuordnet.")}>
            <SettingSwitch path="library.scannerUseLegacyMatching" label={t("Legacy matching", "Alte Zuordnung")}
                note={t("The simpler matching of Seanime 3.4 and older.", "Die einfachere Zuordnung von Seanime 3.4 und älter.")} />
            {legacy ? <LegacyMatching t={t} /> : <ScannerConfigRow t={t} />}
        </SettingsGroup>

        <SettingsGroup id="library-data" title={t("Library data", "Bibliotheksdaten")}>
            <ExportRow t={t} />
        </SettingsGroup>
    </>
}

function LegacyMatching({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const algorithm = useSettingValue("library.scannerMatchingAlgorithm", "")
    const threshold = useSettingValue("library.scannerMatchingThreshold", 0)
    const shownThreshold = threshold > 0 ? threshold : 0.5
    return <>
        <SelectRow id="pst-matching-algorithm" label={t("Matching algorithm", "Zuordnungsverfahren")} value={algorithm || "-"}
            data-setting="library.scannerMatchingAlgorithm" onChange={value => void save("library.scannerMatchingAlgorithm", value === "-" ? "" : value)}
            options={[
                { value: "-", label: t("Levenshtein + Sorensen-Dice (default)", "Levenshtein + Sorensen-Dice (Standard)") },
                { value: "sorensen-dice", label: "Sorensen-Dice" },
                { value: "jaccard", label: "Jaccard" },
            ]} />
        <SelectRow id="pst-matching-threshold" label={t("Matching threshold", "Zuordnungsschwelle")} value={shownThreshold.toFixed(1)}
            note={t("The lowest score a file needs to be matched. Default 0.5.", "Die niedrigste Punktzahl, mit der eine Datei zugeordnet wird. Standard 0,5.")}
            data-setting="library.scannerMatchingThreshold" onChange={value => void save("library.scannerMatchingThreshold", Number(value))}
            options={Array.from({ length: 10 }, (_, i) => ((i + 1) / 10).toFixed(1)).map(value => ({ value, label: value }))} />
    </>
}

/** Scanner rules as JSON; empty means none. */
function ScannerConfigRow({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const config = useSettingValue("library.scannerConfig", "")
    return <TextSettingRow t={t} label={t("Scanner rules", "Scanner-Regeln")} value={config} empty={t("None", "Keine")} multiline
        display={() => t("Set", "Gesetzt")} placeholder={"{\n  \"matching\": { \"rules\": [] }\n}"}
        note={t("Matching and hydration rules in JSON. Leave empty for none.", "Regeln für Zuordnung und Ergänzung als JSON. Leer lassen für keine.")}
        validate={value => {
            if (!value.trim()) return null
            try { JSON.parse(value); return null }
            catch { return t("This is not valid JSON.", "Das ist kein gültiges JSON.") }
        }}
        onApply={value => void save("library.scannerConfig", value.trim())} data-setting="library.scannerConfig" />
}

/** Export: the library's file data as JSON through Android's "Save as" dialog. */
function ExportRow({ t }: { t: Translate }) {
    const saveServerFile = useSaveServerFile()
    const [exporting, setExporting] = React.useState(false)
    return <LinkRow label={exporting ? t("Exporting…", "Wird exportiert …") : t("Export library data", "Bibliotheksdaten exportieren")} disabled={exporting}
        note={t("Saves the scanned file data as a JSON file.", "Speichert die gescannten Dateidaten als JSON-Datei.")} data-settings-export
        onClick={async () => {
            setExporting(true)
            try {
                await saveServerFile("/api/v1/library/local-files/dump", `seanime-localfiles-${fileTimestamp()}.json`)
            }
            catch {
                toast.error(t("The library data could not be exported.", "Die Bibliotheksdaten konnten nicht exportiert werden."))
            }
            finally {
                setExporting(false)
            }
        }} />
}
