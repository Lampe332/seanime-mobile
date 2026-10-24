import { logger } from "@/lib/helpers/debug"
import { useEffect, useState } from "react"

const log = logger("TAB")
const CHANNEL_NAME = "main-tab-election"
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** True for the tab that was visible or focused last; other tabs of the same browser yield. */
export function useMainTab(): boolean {
    const [isMainTab, setIsMainTab] = useState(false)

    useEffect(() => {
        const channel = new BroadcastChannel(CHANNEL_NAME)

        const claimMainTab = () => {
            if (document.visibilityState !== "visible") return
            channel.postMessage({ type: "claim", tabId: TAB_ID })
            log.info("Claimed main tab")
            setIsMainTab(true)
        }

        const handleMessage = (event: MessageEvent) => {
            if (event.data.type === "claim" && event.data.tabId !== TAB_ID) {
                setIsMainTab(false)
                log.warn("Yielded")
            }
        }

        channel.addEventListener("message", handleMessage)
        document.addEventListener("visibilitychange", claimMainTab)
        window.addEventListener("focus", claimMainTab)
        claimMainTab()

        return () => {
            document.removeEventListener("visibilitychange", claimMainTab)
            window.removeEventListener("focus", claimMainTab)
            channel.close()
        }
    }, [])

    return isMainTab
}
