import { useNavigation } from "expo-router"
import React from "react"

/**
 * setParams on this screen's own route, through the screen's navigation object instead of expo-router's global
 * `router.setParams`. The global one goes through a navigation ref shared by every React tree of the process; when a
 * replaced Activity's tree unmounts it empties that ref and the call throws "Attempted to navigate before mounting the
 * Root Layout component" (docs/NATIVE-UMBAU.md §9 09.11.2026). The screen's own navigation belongs to its tree only.
 */
export function useSetRouteParams() {
    const navigation = useNavigation()
    return React.useCallback((params: Record<string, string | undefined>) => {
        navigation.setParams(params as never)
    }, [navigation])
}
