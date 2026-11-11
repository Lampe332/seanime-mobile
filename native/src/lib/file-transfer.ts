import { toast } from "@/components/ui/toast/toast-store"
import { tr } from "@/lib/app-language"
import * as DocumentPicker from "expo-document-picker"
import { Directory, File, Paths } from "expo-file-system"
import * as Sharing from "expo-sharing"

/*
 * Import/export files (WebFileTransfer.kt, bridge SeanimeFileExport): the system document picker for imports, and for
 * exports the file is written to the app's cache and handed to Android's share sheet (save to Files/Drive, send).
 * The 25 MiB limit of the old export bridge stays.
 */
export const MAX_EXPORT_BYTES = 25 * 1024 * 1024

/**
 * Last path segment, at most 180 characters, never empty (askSave) and never "." or "..": as a file name those are the
 * export folder itself and the cache folder above it, which exportFile would then look at (and delete, if it "exists").
 */
export function exportFileName(filename: string): string {
    const name = filename.split("/").pop()!.split("\\").pop()!.slice(0, 180).trim()
    return name && name !== "." && name !== ".." ? name : "seanime-export"
}

export type PickedFile = { uri: string, name: string, mimeType?: string, size?: number }

/** Lets the user pick files to import; [] when cancelled. type: MIME type(s), e.g. "application/json". */
export async function pickFiles({ type = "*/*", multiple = false }: { type?: string | string[], multiple?: boolean } = {}): Promise<PickedFile[]> {
    try {
        const result = await DocumentPicker.getDocumentAsync({ type, multiple, copyToCacheDirectory: true })
        if (result.canceled) return []
        return result.assets.map(asset => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size }))
    }
    catch {
        toast.error(tr("No file picker is available", "Keine Dateiauswahl verfügbar"))
        return []
    }
}

let pending = false

async function share(file: File, mime: string) {
    if (!(await Sharing.isAvailableAsync())) throw new Error("sharing unavailable")
    await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: file.name })
}

function exportFile(filename: string): File {
    const folder = new Directory(Paths.cache, "exports")
    if (!folder.exists) folder.create({ intermediates: true })
    const file = new File(folder, exportFileName(filename))
    if (file.exists) file.delete()
    return file
}

async function once(run: () => Promise<void>) {
    if (pending) {
        toast.error(tr("Finish or cancel the current file export first", "Aktuellen Export zuerst abschließen oder abbrechen"))
        return
    }
    pending = true
    try {
        await run()
    }
    finally {
        pending = false
    }
}

/** Exports data the app made (JSON, text, bytes) as a file. */
export function saveExport(data: string | Uint8Array, filename: string, mime: string = "application/octet-stream") {
    const size = typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength
    if (size > MAX_EXPORT_BYTES) {
        toast.error(tr("Export failed or exceeds the 25 MiB mobile export limit.", "Export fehlgeschlagen oder größer als das Limit von 25 MiB."))
        return Promise.resolve()
    }
    return once(async () => {
        try {
            const file = exportFile(filename)
            await file.write(data)
            await share(file, mime || "application/octet-stream")
        }
        catch {
            toast.error(tr("Could not save this file", "Datei konnte nicht gespeichert werden"))
        }
    })
}

/** Exports a file the server offers for download (http/https only), e.g. logs. */
export function saveExportFromUrl(url: string, filename: string, mime: string = "application/octet-stream", headers?: Record<string, string>) {
    if (!/^https?:\/\//i.test(url)) return Promise.resolve()
    return once(async () => {
        try {
            const file = exportFile(filename)
            await File.downloadFileAsync(url, file, { headers, idempotent: true })
            if ((file.size ?? 0) > MAX_EXPORT_BYTES) {
                file.delete()
                toast.error(tr("Export failed or exceeds the 25 MiB mobile export limit.", "Export fehlgeschlagen oder größer als das Limit von 25 MiB."))
                return
            }
            await share(file, mime || "application/octet-stream")
        }
        catch {
            toast.error(tr("Download failed. Please try again.", "Download fehlgeschlagen. Bitte erneut versuchen."))
        }
    })
}
