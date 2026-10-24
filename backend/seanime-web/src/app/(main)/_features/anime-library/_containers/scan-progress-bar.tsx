import { __scanner_isScanningAtom } from "@/app/(main)/_features/anime-library/_containers/scanner-modal"
import { LibraryPhoneStatus } from "@/app/(main)/_features/anime-library/_screens/library-phone"

import { useWebsocketMessageListener } from "@/app/(main)/_hooks/handle-websockets"
import { WSEvents } from "@/lib/server/ws-events"
import { useAtom } from "jotai/react"
import React, { useState } from "react"

export function ScanProgressBar() {

    const [isScanning] = useAtom(__scanner_isScanningAtom)

    const [progress, setProgress] = useState(0)
    const [status, setStatus] = useState("Scanning...")

    React.useEffect(() => {
        if (!isScanning) {
            setProgress(0)
            setStatus("Scanning...")
        }
    }, [isScanning])

    useWebsocketMessageListener<number>({
        type: WSEvents.SCAN_PROGRESS,
        onMessage: data => {
            setProgress(data)
        },
    })

    useWebsocketMessageListener<string>({
        type: WSEvents.SCAN_STATUS,
        onMessage: data => {
            setStatus(data)
        },
    })

    if (!isScanning) return null

    // Phones: one status above the bottom bar, not a card over it
    return <LibraryPhoneStatus progress={progress} status={status} />
}
