import * as React from "react"

/* -------------------------------------------------------------------------------------------------
 * useIsomorphicLayoutEffect
 * -----------------------------------------------------------------------------------------------*/

export const useIsomorphicLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect

/* -------------------------------------------------------------------------------------------------
 * useUpdateEffect
 * -----------------------------------------------------------------------------------------------*/

export function useUpdateEffect(effect: React.EffectCallback, deps?: React.DependencyList) {
    const isInitialMount = React.useRef(true)

    React.useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false
        } else {
            return effect()
        }
    }, deps)
}
