import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useAtom } from "jotai/react"
import { atomWithStorage } from "@/lib/storage"
import React from "react"

const __mediastream_filePath = atomWithStorage<string | undefined>("sea-mediastream-filepath", undefined)

export function useMediastreamCurrentFile() {
    const [filePath, setFilePath] = useAtom(__mediastream_filePath)

    return {
        filePath,
        setFilePath,
    }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Whether media streaming should be done on this device
 */
const __mediastream_activeOnDevice = atomWithStorage<boolean | null>("sea-mediastream-active-on-device", null)

export function useMediastreamActiveOnDevice() {
    const serverStatus = useServerStatus()
    const [activeOnDevice, setActiveOnDevice] = useAtom(__mediastream_activeOnDevice)

    // Set default behavior
    React.useLayoutEffect(() => {
        if (!!serverStatus) {

            if (activeOnDevice === null) {

                if (serverStatus?.clientDevice !== "desktop") {
                    setActiveOnDevice(true) // Always active on mobile devices
                } else {
                    setActiveOnDevice(false) // Always inactive on desktop devices
                }

            }
        }
    }, [serverStatus?.clientUserAgent, activeOnDevice])

    return {
        activeOnDevice,
        setActiveOnDevice,
    }
}
