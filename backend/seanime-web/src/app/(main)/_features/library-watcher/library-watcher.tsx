import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { __scanner_modalIsOpen } from "@/app/(main)/_features/anime-library/_containers/scanner-modal"
import { LibraryPhoneStatus } from "@/app/(main)/_features/anime-library/_screens/library-phone"

import { useWebsocketMessageListener } from "@/app/(main)/_hooks/handle-websockets"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { useBoolean } from "@/hooks/use-disclosure"
import { WSEvents } from "@/lib/server/ws-events"
import { useQueryClient } from "@tanstack/react-query"
import { useSetAtom } from "jotai/react"
import React, { useState } from "react"
import { toast } from "sonner"

type LibraryWatcherProps = {
    children?: React.ReactNode
}

export function LibraryWatcher(props: LibraryWatcherProps) {

    const {
        children,
        ...rest
    } = props

    const qc = useQueryClient()
    const serverStatus = useServerStatus()
    const [fileEvent, setFileEvent] = useState<string | null>(null)
    const fileAdded = useBoolean(false)
    const fileRemoved = useBoolean(false)
    const autoScanning = useBoolean(false)
    const [progress, setProgress] = useState(0)

    const setScannerModalOpen = useSetAtom(__scanner_modalIsOpen)

    useWebsocketMessageListener<string>({
        type: WSEvents.LIBRARY_WATCHER_FILE_ADDED,
        onMessage: data => {
            console.log("Library watcher", data)
            if (!serverStatus?.settings?.library?.autoScan) { // Only show the notification if auto scan is disabled
                fileAdded.on()
                setFileEvent(data)
            }
        },
    })

    useWebsocketMessageListener<string>({
        type: WSEvents.LIBRARY_WATCHER_FILE_REMOVED,
        onMessage: data => {
            console.log("Library watcher", data)
            if (!serverStatus?.settings?.library?.autoScan) { // Only show the notification if auto scan is disabled
                fileRemoved.on()
                setFileEvent(data)
            }
        },
    })

    // Scan progress event
    useWebsocketMessageListener<number>({
        type: WSEvents.SCAN_PROGRESS,
        onMessage: data => {
            // Remove notification of file added or removed
            setFileEvent(null)
            fileAdded.off()
            fileRemoved.off()
            setProgress(data)
            // reset progress
            if (data === 100) {
                setTimeout(() => {
                    setProgress(0)
                }, 2000)
            }
        },
    })

    // Auto scan event started
    useWebsocketMessageListener<string>({
        type: WSEvents.AUTO_SCAN_STARTED,
        onMessage: _ => {
            autoScanning.on()
        },
    })
    // Auto scan event completed
    useWebsocketMessageListener<string>({
        type: WSEvents.AUTO_SCAN_COMPLETED,
        onMessage: _ => {
            autoScanning.off()
            toast.success("Library scanned")
            qc.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
            qc.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key] })
            qc.invalidateQueries({ queryKey: [API_ENDPOINTS.AUTO_DOWNLOADER.GetAutoDownloaderItems.key] })
        },
    })

    function handleCancel() {
        setFileEvent(null)
        fileAdded.off()
        fileRemoved.off()
    }

    // Phones: one status above the bottom bar, not a card over it
    return <LibraryPhoneStatus progress={autoScanning.active && progress > 0 ? progress : undefined} autoScanning changed={!!fileEvent}
        onRefresh={() => {
            handleCancel()
            setScannerModalOpen(true)
        }} onDismiss={handleCancel} />
}
