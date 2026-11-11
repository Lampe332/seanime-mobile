import React from "react"
import { Keyboard } from "react-native"

/** The open keyboard's height in dp, 0 while it is closed (lib/keyboard-room.ts uses it). */
export function useKeyboardHeight(): number {
    const [height, setHeight] = React.useState(0)
    React.useEffect(() => {
        const show = Keyboard.addListener("keyboardDidShow", event => setHeight(event.endCoordinates.height))
        const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0))
        return () => {
            show.remove()
            hide.remove()
        }
    }, [])
    return height
}
