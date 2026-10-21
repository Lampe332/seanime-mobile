import { getServerBaseUrl } from "@/api/client/server-url"
import { serverAuthTokenAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { useAtomValue } from "jotai"
import React from "react"

/** Hands a file to the browser's download; in the Android app a blob a[download] opens the system "Save as" dialog (WebFileTransfer). */
export function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.style.display = "none"
    document.body.appendChild(link)
    link.click()
    link.remove()
    // The app's click listener fetches the blob during the click; a browser may still be reading it a moment later
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** "2026-10-21_23-05-12", for file names */
export function fileTimestamp(date = new Date()) {
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/**
 * Saves a server response as a file. `text: true` saves the `data` string of a JSON answer (a log) instead of the raw body.
 * Opening the URL instead does nothing in the Android app: its WebView has no tabs and a server page is no download.
 */
export function useSaveServerFile() {
    const password = useAtomValue(serverAuthTokenAtom)
    return React.useCallback(async (endpoint: string, filename: string, options?: { text?: boolean }) => {
        const response = await fetch(getServerBaseUrl() + endpoint, { headers: password ? { "X-Seanime-Token": password } : undefined })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = options?.text
            ? new Blob([String((await response.json() as { data?: string })?.data ?? "")], { type: "text/plain" })
            : await response.blob()
        saveBlob(blob, filename)
    }, [password])
}
