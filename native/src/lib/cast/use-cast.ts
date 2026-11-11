import { useDlnaCastEvents } from "@/api/hooks/dlna_cast.hooks"
import { player_castingAtom } from "@/main/_features/player/player.atoms"
import { useSetAtom } from "jotai"
import React from "react"
import { castController } from "./cast-controller"
import { CastState, initialCastState, reduceCast } from "./cast-state"

/**
 * At the app root, once: the Go server's "dlna-cast" WebSocket events go to the shared cast controller,
 * and the player learns whether a TV plays (no picture-in-picture while casting, PiPManager.kt).
 */
export function useCastEventsBridge() {
    useDlnaCastEvents(event => castController.onDlnaEvent(event))
    const setCasting = useSetAtom(player_castingAtom)
    React.useEffect(() => {
        setCasting(castController.casting)
        return castController.subscribe(() => setCasting(castController.casting))
    }, [setCasting])
}

/** The cast panel's state and actions (player, E3). The state starts fresh per panel; current() restores a running session. */
export function useCast(): { state: CastState, cast: typeof castController } {
    const [state, dispatch] = React.useReducer(reduceCast, initialCastState)
    React.useEffect(() => castController.subscribe(dispatch), [])
    React.useEffect(() => {
        void castController.current().then(current => {
            if (current) dispatch({ state: "started", device: current.device, kind: current.kind })
        })
    }, [])
    return { state, cast: castController }
}

/** No picture-in-picture while a TV plays (PiPManager.kt, E3). */
export function isCasting(): boolean {
    return castController.casting
}
