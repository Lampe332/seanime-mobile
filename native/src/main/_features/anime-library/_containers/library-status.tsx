import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { WSEvents } from "@/lib/server/ws-events"
import { LibraryPhoneSheet, LibraryPhoneStatus } from "@/main/_features/anime-library/_screens/library-phone"
import { __scanner_isScanningAtom, __scanner_modalIsOpen } from "@/main/_features/anime-library/library-phone.atoms"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useQueryClient } from "@tanstack/react-query"
import { useAtomValue, useSetAtom } from "jotai"
import React from "react"

/*
 * The local library's app-wide parts (main-layout.tsx of the web app): the "Local library" sheet, the running scan
 * (scan-progress-bar.tsx) and the library watcher's "folder changed" (library-watcher.tsx), both as one status above the
 * bottom bar.
 */
export function LibraryStatus() {
    return (
        <>
            <LibraryPhoneSheet />
            <ScanProgress />
            <LibraryWatcher />
        </>
    )
}

function ScanProgress() {
    const scanning = useAtomValue(__scanner_isScanningAtom)
    const [progress, setProgress] = React.useState(0)
    const [status, setStatus] = React.useState("Scanning...")
    const [wasScanning, setWasScanning] = React.useState(scanning)
    if (wasScanning !== scanning) {
        setWasScanning(scanning)
        if (!scanning) {
            setProgress(0)
            setStatus("Scanning...")
        }
    }
    useWebsocketMessageListener<number>({ type: WSEvents.SCAN_PROGRESS, onMessage: setProgress })
    useWebsocketMessageListener<string>({ type: WSEvents.SCAN_STATUS, onMessage: setStatus })
    if (!scanning) return null
    // Phones: one status above the bottom bar, not a card over it
    return <LibraryPhoneStatus progress={progress} status={status} />
}

function LibraryWatcher() {
    const t = useTr()
    const qc = useQueryClient()
    const serverStatus = useServerStatus()
    const [fileEvent, setFileEvent] = React.useState<string | null>(null)
    const [autoScanning, setAutoScanning] = React.useState(false)
    const [progress, setProgress] = React.useState(0)
    const setScannerOpen = useSetAtom(__scanner_modalIsOpen)
    const autoScan = !!serverStatus?.settings?.library?.autoScan

    // Only show the notice when auto scan is off (with it on the server rescans by itself)
    useWebsocketMessageListener<string>({ type: WSEvents.LIBRARY_WATCHER_FILE_ADDED, onMessage: data => { if (!autoScan) setFileEvent(data) } })
    useWebsocketMessageListener<string>({ type: WSEvents.LIBRARY_WATCHER_FILE_REMOVED, onMessage: data => { if (!autoScan) setFileEvent(data) } })
    useWebsocketMessageListener<number>({
        type: WSEvents.SCAN_PROGRESS,
        onMessage: data => {
            // a scan replaces the notice; the progress resets 2 s after 100 %
            setFileEvent(null)
            setProgress(data)
            if (data === 100) setTimeout(() => setProgress(0), 2000)
        },
    })
    useWebsocketMessageListener<string>({ type: WSEvents.AUTO_SCAN_STARTED, onMessage: () => setAutoScanning(true) })
    useWebsocketMessageListener<string>({
        type: WSEvents.AUTO_SCAN_COMPLETED,
        onMessage: () => {
            setAutoScanning(false)
            toast.success(t("Library scanned", "Bibliothek gescannt"))
            void qc.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
            void qc.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key] })
        },
    })

    return <LibraryPhoneStatus progress={autoScanning && progress > 0 ? progress : undefined} autoScanning changed={!!fileEvent}
        onRefresh={() => {
            setFileEvent(null)
            setScannerOpen(true)
        }}
        onDismiss={() => setFileEvent(null)} />
}
