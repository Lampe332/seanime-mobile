import React from "react"
import { BackHandler } from "react-native"

/**
 * Android back closes the open sheet, dialog or menu first (AndroidNavigation.kt did this for the WebView: "an open menu
 * closes before the page goes back"). The newest open layer registers last, so it answers first.
 */
export function useCloseOnBack(open: boolean, close: () => void) {
    // always the latest `close`, without re-registering the listener (that would change the answer order)
    const onBack = React.useEffectEvent(() => close())
    React.useEffect(() => {
        if (!open) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            onBack()
            return true
        })
        return () => sub.remove()
    }, [open])
}
