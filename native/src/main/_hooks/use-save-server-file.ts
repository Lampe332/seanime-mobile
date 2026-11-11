import { getServerBaseUrl } from "@/api/client/server-url"
import { saveExport } from "@/lib/file-transfer"
import { getClientId, getClientIdProof } from "@/lib/server/client-id"
import { serverAuthTokenAtom } from "@/main/_atoms/server-status.atoms"
import { __clientPlatform__ } from "@/types/constants"
import { useAtomValue } from "jotai"
import React from "react"

/** "2026-10-21_23-05-12", for file names */
export function fileTimestamp(date = new Date()) {
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/**
 * Saves a server response as a file (web _hooks/use-save-server-file.ts). `text: true` saves the `data` string of a JSON
 * answer (a log) instead of the raw body. The file goes through E4's file module (lib/file-transfer.ts: cache file →
 * Android's share sheet, 25 MiB limit). Rejects when the server does not answer with 2xx, so callers show their own error.
 */
export function useSaveServerFile() {
    const password = useAtomValue(serverAuthTokenAtom)
    return React.useCallback(async (endpoint: string, filename: string, options?: { text?: boolean, mime?: string }) => {
        const headers: Record<string, string> = { "X-Seanime-Client-Platform": __clientPlatform__, "Origin": getServerBaseUrl() }
        if (password) headers["X-Seanime-Token"] = password
        const clientId = getClientId()
        const clientIdProof = getClientIdProof()
        if (clientId) headers["X-Seanime-Client-Id"] = clientId
        if (clientIdProof) headers["X-Seanime-Client-Id-Proof"] = clientIdProof

        const response = await fetch(getServerBaseUrl() + endpoint, { headers })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (options?.text) {
            const body = await response.json() as { data?: string }
            await saveExport(String(body?.data ?? ""), filename, "text/plain")
            return
        }
        await saveExport(new Uint8Array(await response.arrayBuffer()), filename, options?.mime ?? response.headers.get("content-type") ?? undefined)
    }, [password])
}
